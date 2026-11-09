const express = require('express');
const router = express.Router();
const { adminDb } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { recalcContaDependencies, toNumber } = require('../services/reconciliationService');
const { listBaixas, calcJurosMultaAuto } = require('../services/baixasService');
const {
  getBaixaDocumento,
  createBaixaDocumento,
  updateBaixaDocumento,
  estornarBaixaDocumento,
  getSaldoAbertoConta,
} = require('../services/baixaDocumentosService');
const { hasTable, getExistingColumns, pickExistingFields } = require('../services/schemaCompatService');
const { listTitulos, buildTituloDaConta } = require('../services/titulosService');

const TABLE = 'contas_pagar';
const ITENS = 'contas_pagar_itens';
const BAIXAS = 'contas_pagar_baixas';
const ENTRADAS = 'entradas_mercadoria';
const DDA = 'dda_documentos';
const CHEQUES = 'cheques';
const CHEQUES_CONTAS = 'cheques_contas';
const PLANO_CONTAS = 'plano_contas_erp';
const BANCOS = 'contas_bancarias';
const RECORRENTES = 'contas_recorrentes';

function inferContaStatus(dataVencimento) {
  const hoje = new Date().toISOString().slice(0, 10);
  return dataVencimento < hoje ? 'vencido' : 'pendente';
}

function addMonthsKeepingDay(dateValue, months, preferredDay = null) {
  const base = new Date(`${dateValue}T12:00:00`);
  const day = preferredDay || base.getDate();
  const target = new Date(base.getFullYear(), base.getMonth() + months, 1, 12, 0, 0);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

// Upload config
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadDir, 'comprovantes', new Date().toISOString().slice(0, 7));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `comp-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`);
  },
});

const ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf',
]);
const ALLOWED_EXTS = /\.(jpeg|jpg|png|gif|pdf|webp)$/i;

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const extOk = ALLOWED_EXTS.test(path.extname(file.originalname));
    const mimeOk = ALLOWED_MIMES.has(file.mimetype);
    if (extOk && mimeOk) return cb(null, true);
    cb(new Error('Formato não permitido. Envie JPEG, PNG, GIF, WEBP ou PDF.'));
  },
});

async function buildContaDetalhe(contaId) {
  const conta = await adminDb(TABLE)
    .select(
      `${TABLE}.*`,
      `${PLANO_CONTAS}.codigo_erp as plano_codigo`,
      `${PLANO_CONTAS}.descricao as plano_descricao`
    )
    .leftJoin(PLANO_CONTAS, `${TABLE}.plano_conta_id`, `${PLANO_CONTAS}.id`)
    .where(`${TABLE}.id`, contaId)
    .first();
  if (!conta) return null;

  const itens = await adminDb(ITENS)
    .select(
      `${ITENS}.*`,
      `${ENTRADAS}.numeronf`,
      `${ENTRADAS}.numerorr`,
      `${ENTRADAS}.fornecedor as entrada_fornecedor`,
      `${ENTRADAS}.data_emissao as entrada_data_emissao`,
      `${PLANO_CONTAS}.codigo_erp as plano_codigo`,
      `${PLANO_CONTAS}.descricao as plano_descricao`
    )
    .leftJoin(ENTRADAS, `${ITENS}.entrada_id`, `${ENTRADAS}.id`)
    .leftJoin(PLANO_CONTAS, `${ITENS}.plano_conta_id`, `${PLANO_CONTAS}.id`)
    .where(`${ITENS}.conta_pagar_id`, contaId)
    .orderBy(`${ITENS}.id`, 'asc');

  const ddaDocs = await adminDb(DDA)
    .select('id', 'linha_digitavel', 'codigo_barras', 'valor_documento', 'data_vencimento', 'status')
    .where('conta_pagar_id', contaId)
    .orderBy('id', 'desc');

  const cheques = await adminDb(CHEQUES_CONTAS)
    .select(
      `${CHEQUES}.id`,
      `${CHEQUES}.numero_cheque`,
      `${CHEQUES}.valor`,
      `${CHEQUES}.data_bom_para`,
      `${CHEQUES}.status`
    )
    .leftJoin(CHEQUES, `${CHEQUES_CONTAS}.cheque_id`, `${CHEQUES}.id`)
    .where(`${CHEQUES_CONTAS}.conta_pagar_id`, contaId);

  let baixas = [];
  const hasBaixasTable = await hasTable(BAIXAS);
  if (hasBaixasTable) baixas = await listBaixas(contaId);

  const titulo = await buildTituloDaConta(conta);

  return {
    ...conta,
    itens,
    dda_documentos: ddaDocs,
    cheques,
    baixas,
    titulo,
  };
}

/**
 * GET /api/contas-pagar
 * Listar contas (ERP + manual, tudo junto)
 */
router.get('/', async (req, res, next) => {
  try {
    const {
      status, origem, categoria_id, codiloja,
      dataInicio, dataFim, fornecedor,
      page = 1, perPage = 50,
      orderBy = 'data_vencimento', orderDir = 'ASC',
    } = req.query;

    function applyFilters(q) {
      if (status) q = q.where(`${TABLE}.status`, status);
      if (origem) q = q.where(`${TABLE}.origem`, origem);
      if (categoria_id) q = q.where(`${TABLE}.categoria_id`, categoria_id);
      if (codiloja) q = q.where(`${TABLE}.codiloja`, codiloja);
      if (dataInicio) q = q.where(`${TABLE}.data_vencimento`, '>=', dataInicio);
      if (dataFim) q = q.where(`${TABLE}.data_vencimento`, '<=', dataFim);
      if (fornecedor) q = q.where(`${TABLE}.fornecedor`, 'like', `%${fornecedor}%`);
      // Não mostrar cancelados por padrão
      if (!status) q = q.where(`${TABLE}.status`, '!=', 'cancelado');
      return q;
    }

    const countResult = await applyFilters(adminDb(TABLE)).count('* as total').first();
    const total = countResult.total;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(perPage, 10) || 50));
    const offset = (pageNum - 1) * pageSize;
    const allowedOrderBy = new Set([
      'data_vencimento', 'data_emissao', 'fornecedor', 'valor',
      'saldo_aberto', 'valor_pago', 'status', 'origem', 'codiloja',
      'created_at', 'updated_at',
    ]);
    const safeOrderBy = allowedOrderBy.has(orderBy) ? orderBy : 'data_vencimento';
    const safeOrderDir = String(orderDir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    // Enriquecer com contagem de baixas e saldo (para deixar "parcial" explícito na lista)
    const hasBaixasTable = await hasTable(BAIXAS);
    const baixaCols = hasBaixasTable
      ? await getExistingColumns(BAIXAS, ['conta_pagar_id', 'estornada'])
      : {};

    let data = await applyFilters(adminDb(TABLE)
      .select(
        `${TABLE}.*`,
        `${PLANO_CONTAS}.codigo_erp as plano_codigo`,
        `${PLANO_CONTAS}.descricao as plano_descricao`
      )
      .leftJoin(PLANO_CONTAS, `${TABLE}.plano_conta_id`, `${PLANO_CONTAS}.id`))
      .orderBy(`${TABLE}.${safeOrderBy}`, safeOrderDir)
      .limit(pageSize)
      .offset(offset);

    if (hasBaixasTable && baixaCols.conta_pagar_id && data.length > 0) {
      const ids = data.map((c) => c.id);
      let countsQuery = adminDb(BAIXAS)
        .select('conta_pagar_id')
        .count('* as total')
        .whereIn('conta_pagar_id', ids)
        .groupBy('conta_pagar_id');
      if (baixaCols.estornada) {
        countsQuery = countsQuery.where('estornada', false);
      }
      const counts = await countsQuery;
      const map = counts.reduce((acc, r) => {
        acc[r.conta_pagar_id] = r.total;
        return acc;
      }, {});
      data = data.map((c) => ({ ...c, total_baixas: map[c.id] || 0 }));
    }

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
    if (
      err.message.includes('Informe')
      || err.message.includes('excede')
      || err.message.includes('quitada')
      || err.message.includes('cancelada')
      || err.message.includes('Forma de pagamento')
      || err.message.includes('não encontrada')
      || err.message.includes('nÃ£o encontrada')
    ) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * GET /api/contas-pagar/resumo
 * Resumo consolidado (pendente, vencido, pago)
 */
router.get('/resumo', async (req, res, next) => {
  try {
    const { codiloja, dataInicio, dataFim } = req.query;

    function applyBase(q) {
      if (codiloja) q = q.where('codiloja', codiloja);
      if (dataInicio) q = q.where('data_vencimento', '>=', dataInicio);
      if (dataFim) q = q.where('data_vencimento', '<=', dataFim);
      q = q.where('status', '!=', 'cancelado');
      return q;
    }

    const pendente = await applyBase(adminDb(TABLE))
      .where('status', 'pendente')
      .sum('valor as total').count('* as qtd').first();

    const vencido = await applyBase(adminDb(TABLE))
      .where('status', 'vencido')
      .sum('valor as total').count('* as qtd').first();

    const pago = await applyBase(adminDb(TABLE))
      .where('status', 'pago')
      .sum('valor as total').count('* as qtd').first();

    // Contas em pagamento parcial (pendente ou vencido, mas com valor_pago > 0)
    const parcial = await applyBase(adminDb(TABLE))
      .whereIn('status', ['pendente', 'vencido'])
      .andWhere('valor_pago', '>', 0)
      .sum('saldo_aberto as total').count('* as qtd').first();

    const porOrigem = await adminDb(TABLE)
      .select('origem').count('* as total')
      .where('status', '!=', 'cancelado')
      .groupBy('origem');

    const porConciliacao = await adminDb(TABLE)
      .select('status_conciliacao')
      .count('* as total')
      .where('status', '!=', 'cancelado')
      .groupBy('status_conciliacao');

    res.json({
      pendente: { total: pendente.total || 0, qtd: pendente.qtd || 0 },
      vencido: { total: vencido.total || 0, qtd: vencido.qtd || 0 },
      pago: { total: pago.total || 0, qtd: pago.qtd || 0 },
      parcial: { total: parcial.total || 0, qtd: parcial.qtd || 0 },
      porOrigem: porOrigem.reduce((acc, r) => { acc[r.origem] = r.total; return acc; }, {}),
      porConciliacao: porConciliacao.reduce((acc, r) => { acc[r.status_conciliacao] = r.total; return acc; }, {}),
    });
  } catch (err) {
    if (
      err.message.includes('Informe')
      || err.message.includes('excede')
      || err.message.includes('quitada')
      || err.message.includes('cancelada')
      || err.message.includes('Forma de pagamento')
      || err.message.includes('não encontrada')
      || err.message.includes('nÃ£o encontrada')
    ) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * GET /api/contas-pagar/titulos
 * Visão agrupada por título (entrada de mercadoria ou fornecedor+documento).
 * Filtros: status (pendente|vencido|pago), codiloja, fornecedor, origem,
 * dataInicio/dataFim (título entra se alguma parcela vence no período).
 */
router.get('/titulos', async (req, res, next) => {
  try {
    const {
      status, codiloja, fornecedor, origem,
      dataInicio, dataFim, page, perPage,
    } = req.query;
    const result = await listTitulos({
      status, codiloja, fornecedor, origem, dataInicio, dataFim, page, perPage,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/recorrentes', async (req, res, next) => {
  try {
    const { ativo = 'true', fornecedor } = req.query;
    let query = adminDb(RECORRENTES)
      .select(`${RECORRENTES}.*`, `${PLANO_CONTAS}.codigo_erp as plano_codigo`, `${PLANO_CONTAS}.descricao as plano_descricao`)
      .leftJoin(PLANO_CONTAS, `${RECORRENTES}.plano_conta_id`, `${PLANO_CONTAS}.id`);

    if (ativo !== 'all') query = query.where(`${RECORRENTES}.ativo`, ativo === 'true');
    if (fornecedor) query = query.where(`${RECORRENTES}.fornecedor`, 'like', `%${fornecedor}%`);

    const data = await query.orderBy(`${RECORRENTES}.fornecedor`, 'asc');
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/contas-pagar/:id
 */
router.get('/:id', async (req, res, next) => {
  try {
    const conta = await buildContaDetalhe(req.params.id);
    if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });
    res.json(conta);
  } catch (err) {
    if (err.message.includes('Estrutura de documentos de baixa')) {
      return res.status(503).json({ error: err.message });
    }
    next(err);
  }
});

router.get('/:id/rastreio', async (req, res, next) => {
  try {
    const conta = await buildContaDetalhe(req.params.id);
    if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });
    res.json(conta);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/itens', authMiddleware, async (req, res, next) => {
  try {
    const conta = await adminDb(TABLE).where('id', req.params.id).first();
    if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });

    const payload = Array.isArray(req.body.itens) ? req.body.itens : [req.body];
    const inserts = [];

    for (const item of payload) {
      const valorItem = toNumber(item.valor_item);
      if (!valorItem || valorItem <= 0) {
        return res.status(400).json({ error: 'valor_item deve ser maior que zero.' });
      }

      if (item.tipo_origem === 'entrada_mercadoria' && !item.entrada_id) {
        return res.status(400).json({ error: 'entrada_id é obrigatório para itens de mercadoria.' });
      }

      inserts.push({
        conta_pagar_id: parseInt(req.params.id, 10),
        tipo_origem: item.tipo_origem || 'despesa_avulsa',
        entrada_id: item.entrada_id || null,
        plano_conta_id: item.plano_conta_id || null,
        descricao_item: item.descricao_item || null,
        documento_referencia: item.documento_referencia || null,
        valor_item: valorItem,
        origem_match: item.origem_match || 'manual',
        score_match: item.score_match || null,
        observacoes: item.observacoes || null,
        criado_por: req.user.username,
        atualizado_por: req.user.username,
      });
    }

    if (inserts.length > 0) {
      await adminDb(ITENS).insert(inserts);
    }

    await recalcContaDependencies(req.params.id);
    const updated = await buildContaDetalhe(req.params.id);
    res.status(201).json(updated);
  } catch (err) {
    next(err);
  }
});

router.put('/:id/itens/:itemId', authMiddleware, async (req, res, next) => {
  try {
    const item = await adminDb(ITENS)
      .where('id', req.params.itemId)
      .where('conta_pagar_id', req.params.id)
      .first();
    if (!item) return res.status(404).json({ error: 'Item não encontrado' });

    const conta = await adminDb(TABLE).where('id', req.params.id).first();
    if (!conta) return res.status(404).json({ error: 'Conta nÃ£o encontrada' });

    const updates = {};
    if (req.body.tipo_origem !== undefined) updates.tipo_origem = req.body.tipo_origem;
    if (req.body.entrada_id !== undefined) updates.entrada_id = req.body.entrada_id || null;
    if (req.body.plano_conta_id !== undefined) updates.plano_conta_id = req.body.plano_conta_id || null;
    if (req.body.descricao_item !== undefined) updates.descricao_item = req.body.descricao_item;
    if (req.body.documento_referencia !== undefined) updates.documento_referencia = req.body.documento_referencia;
    if (req.body.valor_item !== undefined) updates.valor_item = toNumber(req.body.valor_item);
    if (req.body.origem_match !== undefined) updates.origem_match = req.body.origem_match;
    if (req.body.score_match !== undefined) updates.score_match = req.body.score_match;
    if (req.body.observacoes !== undefined) updates.observacoes = req.body.observacoes;
    updates.atualizado_por = req.user.username;

    await adminDb(ITENS).where('id', req.params.itemId).update(updates);
    await recalcContaDependencies(req.params.id);

    const updated = await buildContaDetalhe(req.params.id);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/itens/:itemId', authMiddleware, async (req, res, next) => {
  try {
    const item = await adminDb(ITENS)
      .where('id', req.params.itemId)
      .where('conta_pagar_id', req.params.id)
      .first();
    if (!item) return res.status(404).json({ error: 'Item não encontrado' });

    await adminDb(ITENS).where('id', req.params.itemId).del();
    await recalcContaDependencies(req.params.id);

    const updated = await buildContaDetalhe(req.params.id);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/contas-pagar
 * Criar nova conta MANUAL
 */
router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const {
      fornecedor, descricao, valor, data_vencimento,
      categoria_id, observacoes, forma_pagamento, codiloja,
      natureza = 'despesa_geral', plano_conta_id = null,
      recorrencia = null,
    } = req.body;

    if (!fornecedor || !valor || !data_vencimento) {
      return res.status(400).json({ error: 'fornecedor, valor e data_vencimento são obrigatórios' });
    }

    const valorNumerico = toNumber(valor);
    if (valorNumerico <= 0) {
      return res.status(400).json({ error: 'valor deve ser maior que zero' });
    }

    const quantidadeRecorrente = recorrencia?.ativa
      ? Math.min(60, Math.max(1, parseInt(recorrencia.quantidade, 10) || 12))
      : 1;
    const diaVencimento = recorrencia?.dia_vencimento
      ? Math.min(31, Math.max(1, parseInt(recorrencia.dia_vencimento, 10) || 1))
      : new Date(`${data_vencimento}T12:00:00`).getDate();

    const createdIds = [];
    let recorrenciaId = null;

    await adminDb.transaction(async (trx) => {
      if (recorrencia?.ativa) {
        const [newRecorrenciaId] = await trx(RECORRENTES).insert({
          fornecedor,
          descricao: descricao || null,
          valor: valorNumerico,
          dia_vencimento: diaVencimento,
          frequencia: 'mensal',
          proxima_data: addMonthsKeepingDay(data_vencimento, quantidadeRecorrente, diaVencimento),
          forma_pagamento: forma_pagamento || null,
          codiloja: codiloja || null,
          natureza,
          plano_conta_id: plano_conta_id || null,
          categoria_id: categoria_id || null,
          ativo: true,
          meses_antecedencia: 1,
          observacoes: recorrencia.observacoes || observacoes || null,
          criado_por: req.user.username,
          atualizado_por: req.user.username,
        });
        recorrenciaId = newRecorrenciaId;
      }

      const inserts = [];
      for (let i = 0; i < quantidadeRecorrente; i++) {
        const vencimento = i === 0
          ? data_vencimento
          : addMonthsKeepingDay(data_vencimento, i, diaVencimento);

        inserts.push({
          origem: 'manual',
          natureza,
          fornecedor,
          descricao,
          valor: valorNumerico,
          data_vencimento: vencimento,
          status: inferContaStatus(vencimento),
          categoria_id: categoria_id || null,
          observacoes: observacoes || null,
          forma_pagamento: forma_pagamento || null,
          codiloja: codiloja || null,
          plano_conta_id: plano_conta_id || null,
          recorrencia_id: recorrenciaId,
          valor_pago: 0,
          saldo_aberto: valorNumerico,
          status_conciliacao: 'sem_itens',
          criado_por: req.user.username,
        });
      }

      const ids = await trx(TABLE).insert(inserts);
      const firstId = Array.isArray(ids) ? ids[0] : ids;
      for (let i = 0; i < inserts.length; i++) createdIds.push(firstId + i);
    });

    for (const id of createdIds) {
      await recalcContaDependencies(id);
    }

    const conta = await buildContaDetalhe(createdIds[0]);
    res.status(201).json({
      ...conta,
      recorrencia_id: recorrenciaId,
      contas_geradas: createdIds.length,
      contas_ids: createdIds,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/contas-pagar/:id
 * Atualizar conta (enriquecer com dados manuais)
 */
router.put('/:id', authMiddleware, async (req, res, next) => {
  try {
    const {
      fornecedor, descricao, valor, data_vencimento,
      data_pagamento, status, categoria_id,
      observacoes, forma_pagamento, codiloja,
      natureza, plano_conta_id,
    } = req.body;

    const updates = {};
    if (fornecedor !== undefined) updates.fornecedor = fornecedor;
    if (descricao !== undefined) updates.descricao = descricao;
    if (valor !== undefined) updates.valor = parseFloat(valor);
    if (data_vencimento !== undefined) updates.data_vencimento = data_vencimento;
    if (data_pagamento !== undefined) updates.data_pagamento = data_pagamento;
    if (status !== undefined) updates.status = status;
    if (categoria_id !== undefined) updates.categoria_id = categoria_id;
    if (observacoes !== undefined) updates.observacoes = observacoes;
    if (forma_pagamento !== undefined) updates.forma_pagamento = forma_pagamento;
    if (codiloja !== undefined) updates.codiloja = codiloja;
    if (natureza !== undefined) updates.natureza = natureza;
    if (plano_conta_id !== undefined) updates.plano_conta_id = plano_conta_id || null;
    updates.atualizado_por = req.user.username;

    await adminDb(TABLE).where('id', req.params.id).update(updates);
    await recalcContaDependencies(req.params.id);
    const conta = await buildContaDetalhe(req.params.id);
    if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });
    res.json(conta);
  } catch (err) {
    next(err);
  }
});

// ====================================================================
// BAIXAS — histórico de pagamentos (CRUD completo)
// ====================================================================

/**
 * GET /api/contas-pagar/:id/baixas
 * Lista baixas da conta
 */
router.get('/:id/baixas', async (req, res, next) => {
  try {
    const baixas = await listBaixas(req.params.id);
    res.json({ data: baixas });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/contas-pagar/:id/baixas
 * Cria nova baixa (pagamento). Aceita multipart p/ comprovante.
 */
router.post('/:id/baixas', authMiddleware, upload.single('comprovante'), async (req, res, next) => {
  try {
    const hasBaixasTable = await hasTable(BAIXAS);
    if (!hasBaixasTable) {
      return res.status(503).json({
        error: 'Tabela de baixas não encontrada. Rode as migrations do backend antes de dar baixa.',
      });
    }

    const conta = await adminDb(TABLE).where('id', req.params.id).first();
    if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });

    if (conta.status === 'cancelado') {
      return res.status(400).json({ error: 'Não é possível dar baixa em conta cancelada.' });
    }

    const {
      data_pagamento,
      forma_pagamento,
      valor_pago,
      valor_desconto,
      valor_juros,
      valor_multa,
      banco_baixa,
      conta_bancaria_id,
      origem = 'manual',
      referencia_externa,
      observacoes,
    } = req.body;

    const saldoAtual = getSaldoAbertoConta(conta);
    const valorPago = valor_pago !== undefined && valor_pago !== null && valor_pago !== ''
      ? toNumber(valor_pago)
      : saldoAtual;
    const desconto = toNumber(valor_desconto ?? 0);
    const juros = toNumber(valor_juros ?? 0);
    const multa = toNumber(valor_multa ?? 0);

    if (valorPago <= 0 && desconto <= 0) {
      return res.status(400).json({ error: 'Informe um valor pago ou desconto maior que zero.' });
    }
    if (toNumber(valorPago + desconto) > saldoAtual + 0.05) {
      return res.status(400).json({
        error: `Valor da baixa excede o saldo atual da conta (${saldoAtual.toFixed(2)}).`,
      });
    }

    const comprovantePath = req.file ? req.file.path.replace(/\\/g, '/') : null;

    const baixaCols = await getExistingColumns(BAIXAS, [
      'conta_pagar_id',
      'data_pagamento',
      'valor_pago',
      'valor_desconto',
      'valor_juros',
      'valor_multa',
      'forma_pagamento',
      'conta_bancaria_id',
      'banco_baixa',
      'comprovante_path',
      'origem',
      'referencia_externa',
      'observacoes',
      'criado_por',
      'atualizado_por',
    ]);

    if (!baixaCols.conta_pagar_id || !baixaCols.data_pagamento || !baixaCols.valor_pago) {
      return res.status(503).json({
        error: 'Estrutura da tabela de baixas está incompleta. Rode as migrations pendentes e tente novamente.',
      });
    }

    const baixaPayload = pickExistingFields({
      conta_pagar_id: parseInt(req.params.id, 10),
      data_pagamento: data_pagamento || new Date().toISOString().slice(0, 10),
      valor_pago: valorPago,
      valor_desconto: desconto,
      valor_juros: juros,
      valor_multa: multa,
      forma_pagamento: forma_pagamento || null,
      conta_bancaria_id: conta_bancaria_id ? parseInt(conta_bancaria_id, 10) : null,
      banco_baixa: banco_baixa || null,
      comprovante_path: comprovantePath,
      origem: origem || 'manual',
      referencia_externa: referencia_externa || null,
      observacoes: observacoes || null,
      criado_por: req.user.username,
      atualizado_por: req.user.username,
    }, baixaCols);

    const [baixaId] = await adminDb(BAIXAS).insert(baixaPayload);

    // Se ainda não existe comprovante na conta e essa baixa trouxe um, usa como principal
    if (comprovantePath && !conta.comprovante_path) {
      await adminDb(TABLE).where('id', req.params.id).update({
        comprovante_path: comprovantePath,
        atualizado_por: req.user.username,
      });
    }

    await recalcContaDependencies(req.params.id);
    const updated = await buildContaDetalhe(req.params.id);
    res.status(201).json({ ...updated, baixa_id_criada: baixaId });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/contas-pagar/:id/baixas/:baixaId
 * Edita uma baixa existente (valores, data, observações, etc.).
 */
router.put('/:id/baixas/:baixaId', authMiddleware, upload.single('comprovante'), async (req, res, next) => {
  try {
    const baixa = await adminDb(BAIXAS)
      .where('id', req.params.baixaId)
      .where('conta_pagar_id', req.params.id)
      .first();
    if (!baixa) return res.status(404).json({ error: 'Baixa não encontrada' });
    if (baixa.estornada) {
      return res.status(400).json({ error: 'Baixa está estornada e não pode ser editada.' });
    }

    const conta = await adminDb(TABLE).where('id', req.params.id).first();
    if (!conta) return res.status(404).json({ error: 'Conta nÃ£o encontrada' });

    const updates = {};
    const body = req.body;
    if (body.data_pagamento !== undefined) updates.data_pagamento = body.data_pagamento;
    if (body.valor_pago !== undefined) updates.valor_pago = toNumber(body.valor_pago);
    if (body.valor_desconto !== undefined) updates.valor_desconto = toNumber(body.valor_desconto);
    if (body.valor_juros !== undefined) updates.valor_juros = toNumber(body.valor_juros);
    if (body.valor_multa !== undefined) updates.valor_multa = toNumber(body.valor_multa);
    if (body.forma_pagamento !== undefined) updates.forma_pagamento = body.forma_pagamento || null;
    if (body.conta_bancaria_id !== undefined) {
      updates.conta_bancaria_id = body.conta_bancaria_id ? parseInt(body.conta_bancaria_id, 10) : null;
    }
    if (body.banco_baixa !== undefined) updates.banco_baixa = body.banco_baixa || null;
    if (body.referencia_externa !== undefined) updates.referencia_externa = body.referencia_externa || null;
    if (body.observacoes !== undefined) updates.observacoes = body.observacoes || null;

    if (req.file) {
      updates.comprovante_path = req.file.path.replace(/\\/g, '/');
    }

    const saldoAtual = getSaldoAbertoConta(conta);
    const novoValorPago = updates.valor_pago !== undefined ? updates.valor_pago : toNumber(baixa.valor_pago);
    const novoDesconto = updates.valor_desconto !== undefined ? updates.valor_desconto : toNumber(baixa.valor_desconto);
    const limiteCobertura = toNumber(
      saldoAtual
      + toNumber(baixa.valor_pago || 0)
      + toNumber(baixa.valor_desconto || 0)
    );

    if (novoValorPago <= 0 && novoDesconto <= 0) {
      return res.status(400).json({ error: 'Informe um valor pago ou desconto maior que zero.' });
    }
    if (toNumber(novoValorPago + novoDesconto) > limiteCobertura + 0.05) {
      return res.status(400).json({
        error: `Valor da baixa excede o saldo disponÃ­vel para ediÃ§Ã£o (${limiteCobertura.toFixed(2)}).`,
      });
    }

    updates.atualizado_por = req.user.username;
    await adminDb(BAIXAS).where('id', req.params.baixaId).update(updates);

    await recalcContaDependencies(req.params.id);
    const updated = await buildContaDetalhe(req.params.id);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/contas-pagar/:id/baixas/:baixaId
 * Estorna a baixa (marca como estornada; mantém histórico).
 * ?hard=true apaga de verdade (use com cuidado).
 */
router.delete('/:id/baixas/:baixaId', authMiddleware, async (req, res, next) => {
  try {
    const baixa = await adminDb(BAIXAS)
      .where('id', req.params.baixaId)
      .where('conta_pagar_id', req.params.id)
      .first();
    if (!baixa) return res.status(404).json({ error: 'Baixa não encontrada' });

    if (req.query.hard === 'true') {
      await adminDb(BAIXAS).where('id', req.params.baixaId).del();
    } else {
      await adminDb(BAIXAS)
        .where('id', req.params.baixaId)
        .update({
          estornada: true,
          estornada_em: new Date(),
          estornada_por: req.user.username,
          estorno_motivo: req.body?.motivo || null,
          atualizado_por: req.user.username,
        });
    }

    await recalcContaDependencies(req.params.id);
    const updated = await buildContaDetalhe(req.params.id);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/contas-pagar/:id/preview-juros
 * Calcula juros/multa automáticos baseado em regras do fornecedor + data pgto.
 * Não persiste nada — útil para pré-visualizar no modal de baixa.
 */
router.get('/baixas/documentos/:documentoId', authMiddleware, async (req, res, next) => {
  try {
    const documento = await getBaixaDocumento(req.params.documentoId);
    if (!documento) return res.status(404).json({ error: 'Documento de baixa nÃ£o encontrada' });
    res.json(documento);
  } catch (err) {
    if (err.message.includes('Estrutura de documentos de baixa')) {
      return res.status(503).json({ error: err.message });
    }
    next(err);
  }
});

router.put('/baixas/documentos/:documentoId', authMiddleware, async (req, res, next) => {
  try {
    const documento = await updateBaixaDocumento(req.params.documentoId, {
      payload: req.body,
      username: req.user.username,
    });
    res.json(documento);
  } catch (err) {
    if (err.message === 'Documento de baixa nÃ£o encontrado.') {
      return res.status(404).json({ error: err.message });
    }
    if (
      err.message === 'Documento de baixa estornado nÃ£o pode ser editado.'
      || err.message.includes('Informe')
      || err.message.includes('excede')
      || err.message.includes('quitada')
      || err.message.includes('cancelada')
      || err.message.includes('Forma de pagamento')
    ) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

router.delete('/baixas/documentos/:documentoId', authMiddleware, async (req, res, next) => {
  try {
    const documento = await estornarBaixaDocumento(req.params.documentoId, {
      username: req.user.username,
      motivo: req.body?.motivo || null,
    });
    res.json(documento);
  } catch (err) {
    if (err.message === 'Documento de baixa nÃ£o encontrado.') {
      return res.status(404).json({ error: err.message });
    }
    if (err.message === 'Documento de baixa jÃ¡ estornado.') {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

router.post('/:id/preview-juros', async (req, res, next) => {
  try {
    const conta = await adminDb(TABLE).where('id', req.params.id).first();
    if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });

    const saldo = toNumber(conta.saldo_aberto || conta.valor);
    const preview = await calcJurosMultaAuto({
      fornecedor: conta.fornecedor,
      cnpj: conta.cnpj_fornecedor,
      codiforn: conta.erp_fornecedor_id,
      valor: saldo,
      data_vencimento: conta.data_vencimento,
      data_pagamento: req.body?.data_pagamento || new Date().toISOString().slice(0, 10),
    });

    res.json(preview || { valor_multa: 0, valor_juros: 0, dias_atraso: 0, regra: null });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/contas-pagar/baixas/lote
 * Pagamento em lote de N contas (PIX/TED/etc) — cria uma baixa por conta
 * usando a mesma data, forma e conta bancária. Útil para fechar vários
 * boletos de uma mesma remessa.
 */
router.post('/baixas/lote', authMiddleware, async (req, res, next) => {
  try {
    const documento = await createBaixaDocumento({
      payload: req.body,
      username: req.user.username,
    });

    return res.status(201).json(documento);

    /*

    const {
      contas_ids,
      data_pagamento,
      forma_pagamento,
      conta_bancaria_id,
      banco_baixa,
      observacoes,
      quitar_total = true, // se true, paga o saldo de cada conta; caso contrário, use valores
      valores, // map { contaId: valor } quando quitar_total=false
    } = req.body;

    if (!Array.isArray(contas_ids) || contas_ids.length === 0) {
      return res.status(400).json({ error: 'Informe pelo menos uma conta (contas_ids).' });
    }
    if (!forma_pagamento) return res.status(400).json({ error: 'Informe a forma de pagamento.' });

    const documentoLegado = await createBaixaDocumento({
      payload: req.body,
      username: req.user.username,
    });

    for (const contaId of contas_ids) {
      const conta = await adminDb(TABLE).where('id', contaId).first();
      if (!conta) continue;
      if (conta.status === 'cancelado' || conta.status === 'pago') continue;

      const saldo = toNumber(conta.saldo_aberto || conta.valor);
      let valorPagar = saldo;
      if (!quitar_total && valores && valores[contaId] !== undefined) {
        valorPagar = toNumber(valores[contaId]);
      }
      if (valorPagar <= 0) continue;

      const [baixaId] = await adminDb(BAIXAS).insert({
        conta_pagar_id: contaId,
        data_pagamento: dataPgto,
        valor_pago: valorPagar,
        valor_desconto: 0,
        valor_juros: 0,
        valor_multa: 0,
        forma_pagamento,
        conta_bancaria_id: conta_bancaria_id ? parseInt(conta_bancaria_id, 10) : null,
        banco_baixa: banco_baixa || null,
        origem: 'lote',
        observacoes: observacoes || `Pagamento em lote (${forma_pagamento})`,
        criado_por: req.user.username,
        atualizado_por: req.user.username,
      });

      await recalcContaDependencies(contaId);
      resultados.push({ conta_pagar_id: contaId, baixa_id: baixaId, valor_pago: valorPagar });
    }

    res.status(201).json({
      message: `${resultados.length} baixas criadas`,
      resultados,
    });
    */
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/contas-pagar/:id/baixa  (LEGADO)
 * Mantido para compatibilidade com clientes antigos. Internamente cria
 * um registro em contas_pagar_baixas (tabela de histórico).
 */
router.put('/:id/baixa', authMiddleware, async (req, res, next) => {
  try {
    const {
      data_pagamento,
      forma_pagamento,
      valor_pago,
      valor_desconto,
      valor_juros,
      valor_multa,
      banco_baixa,
      conta_bancaria_id,
      observacoes,
    } = req.body;

    const conta = await adminDb(TABLE).where('id', req.params.id).first();
    if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });

    const valorConta = toNumber(conta.valor);
    const jaPago = toNumber(conta.valor_pago || 0);
    const jaDesconto = toNumber(conta.valor_desconto || 0);
    const saldoAtual = Math.max(0, valorConta - jaPago - jaDesconto);

    const valorPagoAgora = valor_pago !== undefined && valor_pago !== null && valor_pago !== ''
      ? toNumber(valor_pago)
      : saldoAtual;
    const desconto = toNumber(valor_desconto ?? 0);
    const juros = toNumber(valor_juros ?? 0);
    const multa = toNumber(valor_multa ?? 0);

    if (valorPagoAgora <= 0 && desconto <= 0) {
      return res.status(400).json({ error: 'Informe um valor pago ou desconto maior que zero.' });
    }

    await adminDb(BAIXAS).insert({
      conta_pagar_id: parseInt(req.params.id, 10),
      data_pagamento: data_pagamento || new Date().toISOString().slice(0, 10),
      valor_pago: valorPagoAgora,
      valor_desconto: desconto,
      valor_juros: juros,
      valor_multa: multa,
      forma_pagamento: forma_pagamento || null,
      conta_bancaria_id: conta_bancaria_id ? parseInt(conta_bancaria_id, 10) : null,
      banco_baixa: banco_baixa || null,
      origem: 'manual',
      observacoes: observacoes || null,
      criado_por: req.user.username,
      atualizado_por: req.user.username,
    });

    await recalcContaDependencies(req.params.id);
    const updated = await buildContaDetalhe(req.params.id);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/contas-pagar/:id/comprovante
 * Anexa um comprovante à conta (independente de baixa).
 */
router.post('/:id/comprovante', authMiddleware, upload.single('arquivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    const comprovantePath = req.file.path.replace(/\\/g, '/');
    await adminDb(TABLE).where('id', req.params.id).update({
      comprovante_path: comprovantePath,
      atualizado_por: req.user.username,
    });

    // Se existe baixa mais recente sem comprovante, atualiza ela também
    const ultima = await adminDb(BAIXAS)
      .where('conta_pagar_id', req.params.id)
      .where('estornada', false)
      .whereNull('comprovante_path')
      .orderBy('data_pagamento', 'desc')
      .orderBy('id', 'desc')
      .first();
    if (ultima) {
      await adminDb(BAIXAS).where('id', ultima.id).update({ comprovante_path: comprovantePath });
    }

    const conta = await buildContaDetalhe(req.params.id);
    res.json(conta);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/contas-pagar/:id
 */
router.delete('/:id', authMiddleware, async (req, res, next) => {
  try {
    await adminDb(TABLE).where('id', req.params.id).update({
      status: 'cancelado',
      valor_pago: 0,
      saldo_aberto: 0,
      atualizado_por: req.user.username,
    });
    await recalcContaDependencies(req.params.id);
    res.json({ message: 'Conta cancelada' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
