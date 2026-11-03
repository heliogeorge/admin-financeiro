const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { adminDb } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const FORNECEDORES = 'compras_fornecedores';
const PEDIDOS = 'compras_pedidos';
const ITENS = 'compras_itens';
const ANEXOS = 'compras_anexos';
const STATUS_LOG = 'compras_status_log';
const VINCULOS_SAS = 'compras_item_vinculos_sas';

const STATUS = new Set([
  'rascunho',
  'aguardando_aprovacao',
  'aprovado',
  'enviado_fornecedor',
  'confirmado_fornecedor',
  'parcialmente_recebido',
  'recebido',
  'cancelado',
  'fechado',
]);

const EDITABLE_STATUS = new Set(['rascunho', 'aguardando_aprovacao']);
const LOJAS = new Set(['embalatti', 'vivenda', 'ambas']);
const ORIGENS = new Set(['visita', 'whatsapp', 'telefone', 'email', 'feira', 'sugestao_interna']);
const STATUS_ITEM = new Set(['pendente', 'confirmado', 'parcialmente_recebido', 'recebido', 'cancelado']);
const TIPOS_ANEXO = new Set(['foto', 'pdf', 'whatsapp', 'catalogo', 'outro']);

const uploadRoot = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../uploads'));
fs.mkdirSync(uploadRoot, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadRoot, 'compras', new Date().toISOString().slice(0, 7));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safeExt = path.extname(file.originalname).toLowerCase();
    cb(null, `compra-${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
  },
});

const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const ALLOWED_EXTS = /\.(jpeg|jpg|png|gif|webp|pdf|txt|csv|xls|xlsx|doc|docx)$/i;

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const extOk = ALLOWED_EXTS.test(path.extname(file.originalname));
    const mimeOk = ALLOWED_MIMES.has(file.mimetype) || file.mimetype === 'application/octet-stream';
    if (extOk && mimeOk) return cb(null, true);
    cb(new Error('Formato nao permitido para anexo de compras.'));
  },
});

function today() {
  return new Date().toISOString().slice(0, 10);
}

function asNull(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str === '' ? null : str;
}

function toNumber(value) {
  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round((parsed + Number.EPSILON) * 10000) / 10000;
}

function toMoney(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function assertEnum(value, allowed, fieldName) {
  if (value !== undefined && value !== null && value !== '' && !allowed.has(value)) {
    const err = new Error(`${fieldName} invalido.`);
    err.status = 400;
    throw err;
  }
}

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(value) {
  if (!value) return '';
  return String(value).slice(0, 10).split('-').reverse().join('/');
}

function formatMoney(value) {
  const n = Number(value || 0);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function normalizePdfText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pdfEscape(value) {
  return normalizePdfText(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrapText(value, max = 88) {
  const words = normalizePdfText(value).split(' ');
  const lines = [];
  let current = '';
  words.forEach((word) => {
    if (!word) return;
    if ((current + ' ' + word).trim().length > max) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`.trim();
    }
  });
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function buildSimplePdf(title, lines) {
  const pages = [[]];
  let y = 800;

  function addLine(text, size = 10, gap = 14) {
    if (y < 50) {
      pages.push([]);
      y = 800;
    }
    pages[pages.length - 1].push({ text: normalizePdfText(text), size, y });
    y -= gap;
  }

  addLine(title, 16, 22);
  lines.forEach((line) => {
    if (line === '') {
      y -= 8;
      return;
    }
    wrapText(line, 96).forEach((wrapped) => addLine(wrapped, 10, 14));
  });

  const objects = [];
  const addObject = (body) => {
    objects.push(body);
    return objects.length;
  };

  const catalogRef = addObject('<< /Type /Catalog /Pages 2 0 R >>');
  const pagesRef = addObject('');
  const fontRef = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageRefs = [];

  pages.forEach((page) => {
    const content = page.map((entry) => (
      `BT /F1 ${entry.size} Tf 50 ${entry.y} Td (${pdfEscape(entry.text)}) Tj ET`
    )).join('\n');
    const contentRef = addObject(`<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`);
    const pageRef = addObject(`<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontRef} 0 R >> >> /Contents ${contentRef} 0 R >>`);
    pageRefs.push(pageRef);
  });

  objects[pagesRef - 1] = `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`;
  objects[catalogRef - 1] = `<< /Type /Catalog /Pages ${pagesRef} 0 R >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogRef} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'utf8');
}

async function resolveFornecedor(trx, payload, username) {
  const fornecedorId = payload.fornecedor_id ? parseInt(payload.fornecedor_id, 10) : null;
  if (fornecedorId) {
    const fornecedor = await trx(FORNECEDORES).where('id', fornecedorId).first();
    if (!fornecedor) {
      const err = new Error('Fornecedor nao encontrado.');
      err.status = 400;
      throw err;
    }
    return fornecedor;
  }

  const nome = asNull(payload.fornecedor_nome || payload.fornecedor);
  if (!nome) {
    const err = new Error('Informe ou selecione um fornecedor.');
    err.status = 400;
    throw err;
  }

  const existing = await trx(FORNECEDORES).where('nome', nome).first();
  if (existing) return existing;

  const [id] = await trx(FORNECEDORES).insert({
    nome,
    cnpj_cpf: asNull(payload.fornecedor_cnpj_cpf),
    telefone: asNull(payload.fornecedor_telefone),
    email: asNull(payload.fornecedor_email),
    contato: asNull(payload.fornecedor_contato),
    criado_por: username,
    atualizado_por: username,
  });
  return trx(FORNECEDORES).where('id', id).first();
}

function normalizePedidoPayload(payload, username) {
  assertEnum(payload.loja_destino, LOJAS, 'loja_destino');
  assertEnum(payload.origem, ORIGENS, 'origem');
  assertEnum(payload.status, STATUS, 'status');

  return {
    loja_destino: payload.loja_destino || 'embalatti',
    comprador: asNull(payload.comprador),
    data_pedido: payload.data_pedido || today(),
    previsao_entrega: asNull(payload.previsao_entrega),
    previsao_pagamento: asNull(payload.previsao_pagamento),
    origem: asNull(payload.origem),
    status: payload.status || 'rascunho',
    observacoes: asNull(payload.observacoes),
    atualizado_por: username,
  };
}

function normalizeItemPayload(item, pedidoId = null) {
  assertEnum(item.status_item, STATUS_ITEM, 'status_item');
  const produtoSasId = asNull(item.produto_sas_id);
  const descricao = asNull(item.descricao_livre);

  if (!produtoSasId && !descricao) {
    const err = new Error('Item livre precisa de descricao quando nao houver produto_sas_id.');
    err.status = 400;
    throw err;
  }

  const quantidade = toNumber(item.quantidade);
  const custoUnitario = toNumber(item.custo_unitario_estimado);
  const total = item.total_estimado !== undefined && item.total_estimado !== null && item.total_estimado !== ''
    ? toMoney(item.total_estimado)
    : toMoney(quantidade * custoUnitario);

  return {
    ...(pedidoId ? { pedido_id: pedidoId } : {}),
    produto_sas_id: produtoSasId,
    descricao_livre: descricao,
    familia: asNull(item.familia),
    marca: asNull(item.marca),
    cor: asNull(item.cor),
    medida: asNull(item.medida),
    quantidade,
    unidade: asNull(item.unidade) || 'un',
    custo_unitario_estimado: custoUnitario,
    total_estimado: total,
    preco_venda_sugerido: item.preco_venda_sugerido === '' ? null : toMoney(item.preco_venda_sugerido),
    observacoes: asNull(item.observacoes),
    status_item: item.status_item || 'pendente',
  };
}

async function recalcPedidoTotal(trx, pedidoId) {
  const total = await trx(ITENS).where('pedido_id', pedidoId).sum('total_estimado as total').first();
  const valor = toMoney(total?.total || 0);
  await trx(PEDIDOS).where('id', pedidoId).update({ valor_total_estimado: valor });
  return valor;
}

async function addStatusLog(trx, pedidoId, anterior, novo, usuario, motivo = null) {
  await trx(STATUS_LOG).insert({
    pedido_id: pedidoId,
    status_anterior: anterior || null,
    status_novo: novo,
    usuario: usuario || null,
    motivo: asNull(motivo),
  });
}

async function assignNumeroInterno(trx, pedidoId, dataPedido) {
  const year = String(dataPedido || today()).slice(0, 4);
  const numero = `CP-${year}-${String(pedidoId).padStart(5, '0')}`;
  await trx(PEDIDOS).where('id', pedidoId).update({ numero_interno: numero });
  return numero;
}

async function buildPedidoDetalhe(pedidoId) {
  const pedido = await adminDb(PEDIDOS)
    .select(
      `${PEDIDOS}.*`,
      `${FORNECEDORES}.nome as fornecedor_nome`,
      `${FORNECEDORES}.cnpj_cpf as fornecedor_cnpj_cpf`,
      `${FORNECEDORES}.telefone as fornecedor_telefone`,
      `${FORNECEDORES}.email as fornecedor_email`,
      `${FORNECEDORES}.contato as fornecedor_contato`,
    )
    .leftJoin(FORNECEDORES, `${PEDIDOS}.fornecedor_id`, `${FORNECEDORES}.id`)
    .where(`${PEDIDOS}.id`, pedidoId)
    .first();

  if (!pedido) return null;

  const [itens, anexos, statusLog] = await Promise.all([
    adminDb(ITENS).where('pedido_id', pedidoId).orderBy('id', 'asc'),
    adminDb(ANEXOS).where('pedido_id', pedidoId).orderBy('id', 'asc'),
    adminDb(STATUS_LOG).where('pedido_id', pedidoId).orderBy('id', 'desc'),
  ]);

  const anexosPedido = anexos.filter((anexo) => !anexo.item_id);
  const itensComAnexos = itens.map((item) => ({
    ...item,
    anexos: anexos.filter((anexo) => String(anexo.item_id) === String(item.id)),
  }));

  return {
    ...pedido,
    fornecedor_nome: pedido.fornecedor_nome || pedido.fornecedor_nome_snapshot,
    fornecedor: pedido.fornecedor_id ? {
      id: pedido.fornecedor_id,
      nome: pedido.fornecedor_nome || pedido.fornecedor_nome_snapshot,
      cnpj_cpf: pedido.fornecedor_cnpj_cpf,
      telefone: pedido.fornecedor_telefone,
      email: pedido.fornecedor_email,
      contato: pedido.fornecedor_contato,
    } : null,
    itens: itensComAnexos,
    anexos: anexosPedido,
    status_log: statusLog,
  };
}

function pedidoExportLines(pedido) {
  const lines = [
    `Numero: ${pedido.numero_interno}`,
    `Fornecedor: ${pedido.fornecedor_nome || ''}`,
    `Loja destino: ${pedido.loja_destino}`,
    `Comprador: ${pedido.comprador || ''}`,
    `Data do pedido: ${formatDate(pedido.data_pedido)}`,
    `Previsao de entrega: ${formatDate(pedido.previsao_entrega) || '-'}`,
    `Previsao de pagamento: ${formatDate(pedido.previsao_pagamento) || '-'}`,
    `Origem: ${pedido.origem || '-'}`,
    `Status: ${pedido.status}`,
    `Valor total estimado: ${formatMoney(pedido.valor_total_estimado)}`,
    '',
    'Itens:',
  ];

  (pedido.itens || []).forEach((item, index) => {
    lines.push(`${index + 1}. ${item.descricao_livre || item.produto_sas_id || 'Item'} | ${item.quantidade || 0} ${item.unidade || ''} | custo ${formatMoney(item.custo_unitario_estimado)} | total ${formatMoney(item.total_estimado)} | venda sugerida ${formatMoney(item.preco_venda_sugerido)}`);
    const detalhes = [item.familia, item.marca, item.cor, item.medida].filter(Boolean).join(' / ');
    if (detalhes) lines.push(`   ${detalhes}`);
    if (item.observacoes) lines.push(`   Obs: ${item.observacoes}`);
  });

  if (pedido.observacoes) {
    lines.push('', `Observacoes: ${pedido.observacoes}`);
  }
  return lines;
}

router.get('/fornecedores', async (req, res, next) => {
  try {
    const { search = '', ativo = 'true', page = 1, perPage = 30 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(perPage, 10) || 30));

    let query = adminDb(FORNECEDORES);
    if (ativo !== '') query = query.where('ativo', ativo !== 'false');
    if (search) {
      query = query.where(function () {
        this.where('nome', 'like', `%${search}%`)
          .orWhere('nome_fantasia', 'like', `%${search}%`)
          .orWhere('cnpj_cpf', 'like', `%${search}%`);
      });
    }

    const countResult = await query.clone().count('* as total').first();
    const data = await query
      .select('*')
      .orderBy('nome', 'asc')
      .limit(pageSize)
      .offset((pageNum - 1) * pageSize);

    res.json({
      data,
      pagination: {
        page: pageNum,
        perPage: pageSize,
        total: countResult.total,
        totalPages: Math.ceil(countResult.total / pageSize),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/fornecedores', authMiddleware, async (req, res, next) => {
  try {
    const nome = asNull(req.body.nome);
    if (!nome) return res.status(400).json({ error: 'Nome do fornecedor e obrigatorio.' });

    const [id] = await adminDb(FORNECEDORES).insert({
      nome,
      nome_fantasia: asNull(req.body.nome_fantasia),
      cnpj_cpf: asNull(req.body.cnpj_cpf),
      telefone: asNull(req.body.telefone),
      email: asNull(req.body.email),
      contato: asNull(req.body.contato),
      observacoes: asNull(req.body.observacoes),
      ativo: req.body.ativo !== false,
      criado_por: req.user.username,
      atualizado_por: req.user.username,
    });

    const fornecedor = await adminDb(FORNECEDORES).where('id', id).first();
    res.status(201).json(fornecedor);
  } catch (err) {
    next(err);
  }
});

router.get('/pedidos/resumo', async (req, res, next) => {
  try {
    const rows = await adminDb(PEDIDOS)
      .select('status')
      .count('* as qtd')
      .sum('valor_total_estimado as total')
      .groupBy('status');

    const porStatus = rows.reduce((acc, row) => {
      acc[row.status] = { qtd: Number(row.qtd || 0), total: Number(row.total || 0) };
      return acc;
    }, {});

    const aprovados = await adminDb(PEDIDOS)
      .whereIn('status', ['aprovado', 'enviado_fornecedor', 'confirmado_fornecedor', 'parcialmente_recebido'])
      .sum('valor_total_estimado as total')
      .count('* as qtd')
      .first();

    res.json({
      porStatus,
      compromisso_previsto: {
        qtd: Number(aprovados.qtd || 0),
        total: Number(aprovados.total || 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/pedidos', async (req, res, next) => {
  try {
    const {
      fornecedor,
      loja,
      status,
      comprador,
      dataInicio,
      dataFim,
      abertos,
      page = 1,
      perPage = 30,
      orderBy = 'data_pedido',
      orderDir = 'DESC',
    } = req.query;

    function applyFilters(q) {
      if (fornecedor) {
        q = q.where(function () {
          this.where(`${FORNECEDORES}.nome`, 'like', `%${fornecedor}%`)
            .orWhere(`${PEDIDOS}.fornecedor_nome_snapshot`, 'like', `%${fornecedor}%`);
        });
      }
      if (loja) q = q.where(`${PEDIDOS}.loja_destino`, loja);
      if (status) q = q.where(`${PEDIDOS}.status`, status);
      if (comprador) q = q.where(`${PEDIDOS}.comprador`, 'like', `%${comprador}%`);
      if (dataInicio) q = q.where(`${PEDIDOS}.data_pedido`, '>=', dataInicio);
      if (dataFim) q = q.where(`${PEDIDOS}.data_pedido`, '<=', dataFim);
      if (abertos === 'true') {
        q = q.whereNotIn(`${PEDIDOS}.status`, ['recebido', 'cancelado', 'fechado']);
      }
      return q;
    }

    const base = adminDb(PEDIDOS).leftJoin(FORNECEDORES, `${PEDIDOS}.fornecedor_id`, `${FORNECEDORES}.id`);
    const countResult = await applyFilters(base.clone()).count(`${PEDIDOS}.id as total`).first();
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(perPage, 10) || 30));

    const safeOrder = ['data_pedido', 'previsao_entrega', 'previsao_pagamento', 'valor_total_estimado', 'status', 'id']
      .includes(orderBy) ? orderBy : 'data_pedido';
    const safeDir = String(orderDir).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    let data = await applyFilters(base.clone())
      .select(`${PEDIDOS}.*`, `${FORNECEDORES}.nome as fornecedor_nome`)
      .orderBy(`${PEDIDOS}.${safeOrder}`, safeDir)
      .orderBy(`${PEDIDOS}.id`, 'DESC')
      .limit(pageSize)
      .offset((pageNum - 1) * pageSize);

    if (data.length) {
      const ids = data.map((pedido) => pedido.id);
      const [itensCounts, anexosCounts] = await Promise.all([
        adminDb(ITENS).select('pedido_id').count('* as total').whereIn('pedido_id', ids).groupBy('pedido_id'),
        adminDb(ANEXOS).select('pedido_id').count('* as total').whereIn('pedido_id', ids).groupBy('pedido_id'),
      ]);
      const itensMap = itensCounts.reduce((acc, row) => ({ ...acc, [row.pedido_id]: Number(row.total || 0) }), {});
      const anexosMap = anexosCounts.reduce((acc, row) => ({ ...acc, [row.pedido_id]: Number(row.total || 0) }), {});
      data = data.map((pedido) => ({
        ...pedido,
        fornecedor_nome: pedido.fornecedor_nome || pedido.fornecedor_nome_snapshot,
        total_itens: itensMap[pedido.id] || 0,
        total_anexos: anexosMap[pedido.id] || 0,
      }));
    }

    res.json({
      data,
      pagination: {
        page: pageNum,
        perPage: pageSize,
        total: countResult.total,
        totalPages: Math.ceil(countResult.total / pageSize),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/pedidos', authMiddleware, async (req, res, next) => {
  try {
    const pedidoId = await adminDb.transaction(async (trx) => {
      const fornecedor = await resolveFornecedor(trx, req.body, req.user.username);
      const pedidoPayload = normalizePedidoPayload(req.body, req.user.username);

      const [id] = await trx(PEDIDOS).insert({
        ...pedidoPayload,
        fornecedor_id: fornecedor.id,
        fornecedor_nome_snapshot: fornecedor.nome,
        criado_por: req.user.username,
      });

      await assignNumeroInterno(trx, id, pedidoPayload.data_pedido);

      const itens = Array.isArray(req.body.itens) ? req.body.itens : [];
      if (itens.length > 0) {
        await trx(ITENS).insert(itens.map((item) => normalizeItemPayload(item, id)));
      }

      await recalcPedidoTotal(trx, id);
      await addStatusLog(trx, id, null, pedidoPayload.status, req.user.username, 'Pedido criado');
      return id;
    });

    const pedido = await buildPedidoDetalhe(pedidoId);
    res.status(201).json(pedido);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/pedidos/:id', async (req, res, next) => {
  try {
    const pedido = await buildPedidoDetalhe(req.params.id);
    if (!pedido) return res.status(404).json({ error: 'Pedido nao encontrado.' });
    res.json(pedido);
  } catch (err) {
    next(err);
  }
});

router.put('/pedidos/:id', authMiddleware, async (req, res, next) => {
  try {
    await adminDb.transaction(async (trx) => {
      const pedido = await trx(PEDIDOS).where('id', req.params.id).first();
      if (!pedido) {
        const err = new Error('Pedido nao encontrado.');
        err.status = 404;
        throw err;
      }
      if (!EDITABLE_STATUS.has(pedido.status)) {
        const err = new Error('Pedido so pode ser editado em rascunho ou aguardando aprovacao.');
        err.status = 400;
        throw err;
      }

      const fornecedor = await resolveFornecedor(trx, {
        fornecedor_id: req.body.fornecedor_id ?? pedido.fornecedor_id,
        fornecedor_nome: req.body.fornecedor_nome || req.body.fornecedor || pedido.fornecedor_nome_snapshot,
      }, req.user.username);

      const pedidoPayload = normalizePedidoPayload({
        ...pedido,
        ...req.body,
        status: req.body.status || pedido.status,
      }, req.user.username);

      await trx(PEDIDOS).where('id', req.params.id).update({
        ...pedidoPayload,
        fornecedor_id: fornecedor.id,
        fornecedor_nome_snapshot: fornecedor.nome,
      });

      if (Array.isArray(req.body.itens)) {
        const existing = await trx(ITENS).where('pedido_id', req.params.id).select('id');
        const existingIds = new Set(existing.map((row) => Number(row.id)));
        const keptIds = [];

        for (const item of req.body.itens) {
          if (item.id) {
            const itemId = Number(item.id);
            if (!existingIds.has(itemId)) {
              const err = new Error('Item informado nao pertence ao pedido.');
              err.status = 400;
              throw err;
            }
            await trx(ITENS).where('id', itemId).update(normalizeItemPayload(item));
            keptIds.push(itemId);
          } else {
            const [itemId] = await trx(ITENS).insert(normalizeItemPayload(item, req.params.id));
            keptIds.push(itemId);
          }
        }

        if (keptIds.length > 0) {
          await trx(ITENS).where('pedido_id', req.params.id).whereNotIn('id', keptIds).del();
        } else {
          await trx(ITENS).where('pedido_id', req.params.id).del();
        }
      }

      await recalcPedidoTotal(trx, req.params.id);
    });

    const pedido = await buildPedidoDetalhe(req.params.id);
    res.json(pedido);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/pedidos/:id/status', authMiddleware, async (req, res, next) => {
  try {
    const novoStatus = req.body.status;
    assertEnum(novoStatus, STATUS, 'status');

    await adminDb.transaction(async (trx) => {
      const pedido = await trx(PEDIDOS).where('id', req.params.id).first();
      if (!pedido) {
        const err = new Error('Pedido nao encontrado.');
        err.status = 404;
        throw err;
      }
      if (pedido.status === novoStatus) return;
      if (pedido.status === 'cancelado' || pedido.status === 'fechado') {
        const err = new Error('Pedido cancelado ou fechado nao pode mudar de status.');
        err.status = 400;
        throw err;
      }

      await trx(PEDIDOS).where('id', req.params.id).update({
        status: novoStatus,
        atualizado_por: req.user.username,
      });
      await addStatusLog(trx, req.params.id, pedido.status, novoStatus, req.user.username, req.body.motivo);
    });

    const pedido = await buildPedidoDetalhe(req.params.id);
    res.json(pedido);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/pedidos/:id/aprovar', authMiddleware, async (req, res, next) => {
  try {
    await adminDb.transaction(async (trx) => {
      const pedido = await trx(PEDIDOS).where('id', req.params.id).first();
      if (!pedido) {
        const err = new Error('Pedido nao encontrado.');
        err.status = 404;
        throw err;
      }
      if (pedido.status === 'aprovado') return;
      if (pedido.status === 'cancelado' || pedido.status === 'fechado') {
        const err = new Error('Pedido cancelado ou fechado nao pode ser aprovado.');
        err.status = 400;
        throw err;
      }

      await trx(PEDIDOS).where('id', req.params.id).update({
        status: 'aprovado',
        atualizado_por: req.user.username,
      });
      await addStatusLog(trx, req.params.id, pedido.status, 'aprovado', req.user.username, req.body.motivo || 'Pedido aprovado');
    });

    const pedido = await buildPedidoDetalhe(req.params.id);
    res.json(pedido);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/pedidos/:id/cancelar', authMiddleware, async (req, res, next) => {
  try {
    const motivo = asNull(req.body.motivo);
    if (!motivo) return res.status(400).json({ error: 'Informe o motivo do cancelamento.' });

    await adminDb.transaction(async (trx) => {
      const pedido = await trx(PEDIDOS).where('id', req.params.id).first();
      if (!pedido) {
        const err = new Error('Pedido nao encontrado.');
        err.status = 404;
        throw err;
      }
      if (pedido.status === 'cancelado') return;

      await trx(PEDIDOS).where('id', req.params.id).update({
        status: 'cancelado',
        atualizado_por: req.user.username,
      });
      await addStatusLog(trx, req.params.id, pedido.status, 'cancelado', req.user.username, motivo);
    });

    const pedido = await buildPedidoDetalhe(req.params.id);
    res.json(pedido);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/pedidos/:id/anexos', authMiddleware, upload.single('arquivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

    const pedido = await adminDb(PEDIDOS).where('id', req.params.id).first();
    if (!pedido) return res.status(404).json({ error: 'Pedido nao encontrado.' });

    const itemId = req.body.item_id ? parseInt(req.body.item_id, 10) : null;
    if (itemId) {
      const item = await adminDb(ITENS).where('id', itemId).where('pedido_id', req.params.id).first();
      if (!item) return res.status(400).json({ error: 'Item nao pertence ao pedido.' });
    }

    const tipo = TIPOS_ANEXO.has(req.body.tipo) ? req.body.tipo : 'outro';
    const relativePath = path.relative(uploadRoot, req.file.path).replace(/\\/g, '/');
    const arquivoUrl = `/uploads/${relativePath}`;

    const [id] = await adminDb(ANEXOS).insert({
      pedido_id: req.params.id,
      item_id: itemId,
      tipo,
      arquivo_url: arquivoUrl,
      caminho_arquivo: req.file.path.replace(/\\/g, '/'),
      nome_arquivo: req.file.originalname,
      mime_type: req.file.mimetype,
      tamanho_bytes: req.file.size,
      descricao: asNull(req.body.descricao),
      criado_por: req.user.username,
    });

    const anexo = await adminDb(ANEXOS).where('id', id).first();
    res.status(201).json(anexo);
  } catch (err) {
    next(err);
  }
});

router.delete('/anexos/:id', authMiddleware, async (req, res, next) => {
  try {
    const anexo = await adminDb(ANEXOS).where('id', req.params.id).first();
    if (!anexo) return res.status(404).json({ error: 'Anexo nao encontrado.' });
    await adminDb(ANEXOS).where('id', req.params.id).del();
    res.json({ message: 'Anexo removido.' });
  } catch (err) {
    next(err);
  }
});

router.get('/produtos-livres', async (req, res, next) => {
  try {
    const { search = '', fornecedor = '', page = 1, perPage = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(perPage, 10) || 50));

    function applyFilters(q) {
      q = q.whereNull(`${ITENS}.produto_sas_id`);
      if (search) {
        q = q.where(function () {
          this.where(`${ITENS}.descricao_livre`, 'like', `%${search}%`)
            .orWhere(`${ITENS}.familia`, 'like', `%${search}%`)
            .orWhere(`${ITENS}.marca`, 'like', `%${search}%`);
        });
      }
      if (fornecedor) {
        q = q.where(function () {
          this.where(`${FORNECEDORES}.nome`, 'like', `%${fornecedor}%`)
            .orWhere(`${PEDIDOS}.fornecedor_nome_snapshot`, 'like', `%${fornecedor}%`);
        });
      }
      return q;
    }

    const base = adminDb(ITENS)
      .leftJoin(PEDIDOS, `${ITENS}.pedido_id`, `${PEDIDOS}.id`)
      .leftJoin(FORNECEDORES, `${PEDIDOS}.fornecedor_id`, `${FORNECEDORES}.id`);

    const countResult = await applyFilters(base.clone()).count(`${ITENS}.id as total`).first();
    const data = await applyFilters(base.clone())
      .select(
        `${ITENS}.*`,
        `${PEDIDOS}.numero_interno`,
        `${PEDIDOS}.status as pedido_status`,
        `${PEDIDOS}.data_pedido`,
        `${PEDIDOS}.loja_destino`,
        `${FORNECEDORES}.nome as fornecedor_nome`,
      )
      .orderBy(`${ITENS}.id`, 'desc')
      .limit(pageSize)
      .offset((pageNum - 1) * pageSize);

    res.json({
      data,
      pagination: {
        page: pageNum,
        perPage: pageSize,
        total: countResult.total,
        totalPages: Math.ceil(countResult.total / pageSize),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/itens/:id/vincular-sas', authMiddleware, async (req, res, next) => {
  try {
    const produtoSasId = asNull(req.body.produto_sas_id);
    if (!produtoSasId) return res.status(400).json({ error: 'Informe produto_sas_id.' });

    const item = await adminDb(ITENS).where('id', req.params.id).first();
    if (!item) return res.status(404).json({ error: 'Item nao encontrado.' });

    await adminDb.transaction(async (trx) => {
      await trx(ITENS).where('id', req.params.id).update({ produto_sas_id: produtoSasId });
      await trx(VINCULOS_SAS).insert({
        item_id: req.params.id,
        produto_sas_id: produtoSasId,
        usuario: req.user.username,
        observacao: asNull(req.body.observacao),
      });
    });

    const updated = await adminDb(ITENS).where('id', req.params.id).first();
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.get('/pedidos/:id/export/excel', async (req, res, next) => {
  try {
    const pedido = await buildPedidoDetalhe(req.params.id);
    if (!pedido) return res.status(404).json({ error: 'Pedido nao encontrado.' });

    const rows = (pedido.itens || []).map((item, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${htmlEscape(item.produto_sas_id || '')}</td>
        <td>${htmlEscape(item.descricao_livre || '')}</td>
        <td>${htmlEscape(item.familia || '')}</td>
        <td>${htmlEscape(item.marca || '')}</td>
        <td>${htmlEscape(item.cor || '')}</td>
        <td>${htmlEscape(item.medida || '')}</td>
        <td>${htmlEscape(item.quantidade || 0)}</td>
        <td>${htmlEscape(item.unidade || '')}</td>
        <td>${htmlEscape(item.custo_unitario_estimado || 0)}</td>
        <td>${htmlEscape(item.total_estimado || 0)}</td>
        <td>${htmlEscape(item.preco_venda_sugerido || '')}</td>
        <td>${htmlEscape(item.observacoes || '')}</td>
      </tr>
    `).join('');

    const html = `
      <html>
        <head><meta charset="utf-8" /></head>
        <body>
          <h1>Pedido de compra ${htmlEscape(pedido.numero_interno)}</h1>
          <p><strong>Fornecedor:</strong> ${htmlEscape(pedido.fornecedor_nome || '')}</p>
          <p><strong>Loja:</strong> ${htmlEscape(pedido.loja_destino)} | <strong>Comprador:</strong> ${htmlEscape(pedido.comprador || '')}</p>
          <p><strong>Data:</strong> ${htmlEscape(formatDate(pedido.data_pedido))} | <strong>Entrega:</strong> ${htmlEscape(formatDate(pedido.previsao_entrega))} | <strong>Pagamento:</strong> ${htmlEscape(formatDate(pedido.previsao_pagamento))}</p>
          <p><strong>Valor total estimado:</strong> ${htmlEscape(formatMoney(pedido.valor_total_estimado))}</p>
          <table border="1">
            <thead>
              <tr>
                <th>#</th><th>Produto SAS</th><th>Descricao</th><th>Familia</th><th>Marca</th>
                <th>Cor</th><th>Medida</th><th>Qtd</th><th>Unidade</th><th>Custo estimado</th>
                <th>Total estimado</th><th>Venda sugerida</th><th>Obs</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <p><strong>Observacoes:</strong> ${htmlEscape(pedido.observacoes || '')}</p>
        </body>
      </html>
    `;

    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${pedido.numero_interno || 'pedido'}.xls"`);
    res.send(html);
  } catch (err) {
    next(err);
  }
});

router.get('/pedidos/:id/export/pdf', async (req, res, next) => {
  try {
    const pedido = await buildPedidoDetalhe(req.params.id);
    if (!pedido) return res.status(404).json({ error: 'Pedido nao encontrado.' });

    const buffer = buildSimplePdf(`Pedido de compra ${pedido.numero_interno}`, pedidoExportLines(pedido));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pedido.numero_interno || 'pedido'}.pdf"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
