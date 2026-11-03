const express = require('express');
const multer = require('multer');
const router = express.Router();
const { adminDb } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const {
  isTsvFormat,
  splitAndParseTsv,
  splitAndParseTsvDetailed,
  parseXlsxBoletosDetailed,
  splitBlocks,
  parseBlock,
  toNumber,
} = require('../services/ddaService');

const uploadXlsx = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});
const {
  recalcConta,
  recalcContaDependencies,
} = require('../services/reconciliationService');

const DDA = 'dda_documentos';
const CONTAS = 'contas_pagar';
const ITENS = 'contas_pagar_itens';

async function loadDdaById(id) {
  return adminDb(DDA)
    .select(
      `${DDA}.*`,
      `${CONTAS}.fornecedor as conta_fornecedor`,
      `${CONTAS}.valor as conta_valor`,
      `${CONTAS}.data_vencimento as conta_vencimento`,
      `${CONTAS}.status as conta_status`,
      `${CONTAS}.status_conciliacao as conta_status_conciliacao`,
      `${CONTAS}.origem as conta_origem`
    )
    .leftJoin(CONTAS, `${DDA}.conta_pagar_id`, `${CONTAS}.id`)
    .where(`${DDA}.id`, id)
    .first();
}

function inferContaStatus(dataVencimento) {
  if (!dataVencimento) return 'pendente';
  const hoje = new Date().toISOString().slice(0, 10);
  return dataVencimento < hoje ? 'vencido' : 'pendente';
}

function isValidParsedDda(parsed) {
  if (!parsed?.hash_documento) return false;
  const hasIdentity = !!(
    parsed.linha_digitavel
    || parsed.codigo_barras
    || parsed.cedente_nome
    || parsed.cedente_documento
    || parsed.nosso_numero
  );
  return hasIdentity && parsed.valor_documento !== null && parsed.valor_documento !== undefined;
}

function buildDdaInsertPayload(parsed, username) {
  return {
    linha_digitavel: parsed.linha_digitavel || null,
    codigo_barras: parsed.codigo_barras || null,
    nosso_numero: parsed.nosso_numero || null,
    banco: parsed.banco || null,
    cedente_nome: parsed.cedente_nome || null,
    cedente_documento: parsed.cedente_documento || null,
    valor_documento: toNumber(parsed.valor_documento),
    data_vencimento: parsed.data_vencimento || null,
    texto_original: parsed.texto_original || null,
    hash_documento: parsed.hash_documento,
    status: parsed.status || 'novo',
    criado_por: username,
    atualizado_por: username,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const {
      status,
      search,
      page = 1,
      perPage = 30,
      orderBy = 'data_vencimento',
      orderDir = 'ASC',
    } = req.query;

    function applyFilters(query) {
      if (status) query = query.where(`${DDA}.status`, status);
      if (search) {
        query = query.where(function () {
          this.where(`${DDA}.cedente_nome`, 'like', `%${search}%`)
            .orWhere(`${DDA}.linha_digitavel`, 'like', `%${search}%`)
            .orWhere(`${DDA}.codigo_barras`, 'like', `%${search}%`);
        });
      }
      return query;
    }

    const countResult = await applyFilters(adminDb(DDA)).count('* as total').first();
    const total = countResult.total;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(perPage, 10) || 30));
    const offset = (pageNum - 1) * pageSize;
    const allowedOrderBy = new Set([
      'data_vencimento', 'valor_documento', 'data_importacao',
      'cedente_nome', 'banco', 'status', 'created_at', 'updated_at',
    ]);
    const safeOrderBy = allowedOrderBy.has(orderBy) ? orderBy : 'data_vencimento';
    const safeOrderDir = String(orderDir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    const data = await applyFilters(
      adminDb(DDA)
        .select(
          `${DDA}.*`,
          `${CONTAS}.fornecedor as conta_fornecedor`,
          `${CONTAS}.status as conta_status`,
          `${CONTAS}.status_conciliacao as conta_status_conciliacao`
        )
        .leftJoin(CONTAS, `${DDA}.conta_pagar_id`, `${CONTAS}.id`)
    )
      .orderBy(`${DDA}.${safeOrderBy}`, safeOrderDir)
      .limit(pageSize)
      .offset(offset);

    res.json({
      data,
      pagination: {
        page: pageNum,
        perPage: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/resumo', async (req, res, next) => {
  try {
    const porStatus = await adminDb(DDA)
      .select('status')
      .count('* as total')
      .sum('valor_documento as valor')
      .groupBy('status');

    const linked = await adminDb(DDA)
      .whereNotNull('conta_pagar_id')
      .count('* as total')
      .first();

    res.json({
      porStatus: porStatus.reduce((acc, row) => {
        acc[row.status] = { total: row.total, valor: row.valor || 0 };
        return acc;
      }, {}),
      vinculados: linked.total || 0,
    });
  } catch (err) {
    next(err);
  }
});

async function insertParsedItems(parsedItems, username) {
  let inserted = 0;
  let duplicated = 0;
  let ignored = 0;
  const createdIds = [];
  const seenHashes = new Set();

  for (const parsed of parsedItems) {
    if (!isValidParsedDda(parsed)) {
      ignored++;
      continue;
    }

    if (seenHashes.has(parsed.hash_documento)) {
      duplicated++;
      continue;
    }
    seenHashes.add(parsed.hash_documento);

    const dupQuery = adminDb(DDA).where('hash_documento', parsed.hash_documento);
    if (parsed.hash_legado) dupQuery.orWhere('hash_documento', parsed.hash_legado);
    if (parsed.codigo_barras) dupQuery.orWhere('codigo_barras', parsed.codigo_barras);
    const exists = await dupQuery.first();
    if (exists) {
      duplicated++;
      continue;
    }

    const [id] = await adminDb(DDA).insert(buildDdaInsertPayload(parsed, username));

    inserted++;
    createdIds.push(id);
  }

  return { inserted, duplicated, ignored, createdIds };
}

function buildImportResponse(res, { inserted, duplicated, ignored, createdIds }, ignoredDetails) {
  if (inserted === 0 && duplicated === 0 && ignored > 0) {
    return res.status(400).json({
      error: 'Nenhuma linha valida foi encontrada para importar. Confira se cada boleto tem cedente, vencimento e valor.',
    });
  }

  return res.status(201).json({
    message: `${inserted} documentos importados`,
    inserted,
    duplicated,
    ignored,
    ignoredReasons: ignoredDetails.reduce((acc, item) => {
      acc[item.reason] = (acc[item.reason] || 0) + 1;
      return acc;
    }, {}),
    ignoredSamples: ignoredDetails.slice(0, 5),
    createdIds,
  });
}

router.post('/importar-texto', authMiddleware, async (req, res, next) => {
  try {
    const { texto } = req.body;
    if (!texto || !texto.trim()) {
      return res.status(400).json({ error: 'Cole o texto do internet banking para importar.' });
    }

    // Detect format: TSV (internet banking table) vs traditional DDA block text
    const useTsv = isTsvFormat(texto);
    let parsedItems = [];
    let ignoredDetails = [];

    if (useTsv) {
      const parsed = splitAndParseTsvDetailed(texto);
      parsedItems = parsed.results;
      ignoredDetails = parsed.ignored;
    } else {
      const blocks = splitBlocks(texto);
      parsedItems = blocks
        .map((b) => parseBlock(b))
        .filter((p) => p.linha_digitavel || p.codigo_barras || p.cedente_nome);
    }

    if (parsedItems.length === 0) {
      return res.status(400).json({ error: 'Nenhum documento DDA foi identificado no texto informado.' });
    }

    const totals = await insertParsedItems(parsedItems, req.user.username);
    return buildImportResponse(res, totals, ignoredDetails);
  } catch (err) {
    next(err);
  }
});

router.post('/importar-arquivo', authMiddleware, uploadXlsx.single('arquivo'), async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Envie o arquivo xlsx exportado do internet banking.' });
    }
    if (!/\.xlsx$/i.test(req.file.originalname || '')) {
      return res.status(400).json({ error: 'Formato não suportado. Envie o arquivo .xlsx exportado do Itaú.' });
    }

    let parsed;
    try {
      parsed = await parseXlsxBoletosDetailed(req.file.buffer);
    } catch (parseErr) {
      return res.status(400).json({ error: 'Não foi possível ler o arquivo xlsx. Confira se é o export original do banco.' });
    }

    if (parsed.results.length === 0) {
      const semCabecalho = parsed.ignored.some((item) => item.reason === 'cabecalho_nao_encontrado');
      return res.status(400).json({
        error: semCabecalho
          ? 'Não encontrei a tabela de boletos no arquivo (cabeçalho "Beneficiário/Venc." ausente).'
          : 'Nenhum boleto válido foi identificado no arquivo.',
      });
    }

    const totals = await insertParsedItems(parsed.results, req.user.username);
    return buildImportResponse(res, totals, parsed.ignored);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const dda = await loadDdaById(req.params.id);
    if (!dda) return res.status(404).json({ error: 'Documento DDA não encontrado' });
    res.json(dda);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authMiddleware, async (req, res, next) => {
  try {
    const dda = await adminDb(DDA).where('id', req.params.id).first();
    if (!dda) return res.status(404).json({ error: 'Documento DDA não encontrado' });
    await adminDb(DDA).where('id', req.params.id).delete();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/vincular-conta', authMiddleware, async (req, res, next) => {
  try {
    const { conta_pagar_id } = req.body;
    if (!conta_pagar_id) {
      return res.status(400).json({ error: 'Informe a conta a pagar para o vínculo.' });
    }

    const dda = await adminDb(DDA).where('id', req.params.id).first();
    if (!dda) return res.status(404).json({ error: 'Documento DDA não encontrado' });

    const conta = await adminDb(CONTAS).where('id', conta_pagar_id).first();
    if (!conta) return res.status(404).json({ error: 'Conta a pagar não encontrada' });

    await adminDb(DDA)
      .where('id', req.params.id)
      .update({
        conta_pagar_id,
        status: 'confirmado',
        score_match: dda.score_match || 100,
        atualizado_por: req.user.username,
      });

    await adminDb(CONTAS)
      .where('id', conta_pagar_id)
      .update({
        linha_digitavel: conta.linha_digitavel || dda.linha_digitavel || null,
        codigo_barras: conta.codigo_barras || dda.codigo_barras || null,
        nosso_numero: conta.nosso_numero || dda.nosso_numero || null,
        forma_pagamento: conta.forma_pagamento || 'boleto',
        atualizado_por: req.user.username,
      });

    await recalcConta(conta_pagar_id);

    const updated = await loadDdaById(req.params.id);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/criar-conta', authMiddleware, async (req, res, next) => {
  try {
    const {
      fornecedor,
      descricao,
      codiloja,
      natureza = 'despesa_geral',
      plano_conta_id = null,
      entrada_id = null,
      observacoes,
    } = req.body;

    const dda = await adminDb(DDA).where('id', req.params.id).first();
    if (!dda) return res.status(404).json({ error: 'Documento DDA não encontrado' });

    const fornecedorFinal = fornecedor || dda.cedente_nome;
    if (!fornecedorFinal) {
      return res.status(400).json({ error: 'Informe o fornecedor para criar a conta.' });
    }
    if (natureza === 'mercadoria' && !entrada_id) {
      return res.status(400).json({ error: 'Selecione a entrada de mercadoria para criar uma conta dessa natureza.' });
    }

    const valor = toNumber(dda.valor_documento);
    const dataVencimento = dda.data_vencimento || new Date().toISOString().slice(0, 10);

    const [contaId] = await adminDb(CONTAS).insert({
      origem: 'manual',
      natureza,
      fornecedor: fornecedorFinal,
      descricao: descricao || `Conta criada a partir do DDA ${dda.id}`,
      valor,
      data_vencimento: dataVencimento,
      status: inferContaStatus(dataVencimento),
      forma_pagamento: 'boleto',
      observacoes: observacoes || `Criada a partir do documento DDA ${dda.id}`,
      codiloja: codiloja || null,
      plano_conta_id: plano_conta_id || null,
      linha_digitavel: dda.linha_digitavel || null,
      codigo_barras: dda.codigo_barras || null,
      nosso_numero: dda.nosso_numero || null,
      valor_pago: 0,
      saldo_aberto: valor,
      status_conciliacao: 'sem_itens',
      criado_por: req.user.username,
      atualizado_por: req.user.username,
    });

    await adminDb(ITENS).insert({
      conta_pagar_id: contaId,
      tipo_origem: entrada_id ? 'entrada_mercadoria' : 'despesa_avulsa',
      entrada_id: entrada_id || null,
      plano_conta_id: plano_conta_id || null,
      descricao_item: descricao || `Origem criada com o DDA ${dda.id}`,
      documento_referencia: dda.nosso_numero || dda.linha_digitavel || null,
      valor_item: valor,
      origem_match: 'confirmado',
      score_match: 100,
      observacoes: 'Conta criada automaticamente a partir do DDA.',
      criado_por: req.user.username,
      atualizado_por: req.user.username,
    });

    await adminDb(DDA)
      .where('id', req.params.id)
      .update({
        conta_pagar_id: contaId,
        status: 'confirmado',
        score_match: 100,
        atualizado_por: req.user.username,
      });

    await recalcContaDependencies(contaId);

    const updated = await loadDdaById(req.params.id);
    res.status(201).json(updated);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
