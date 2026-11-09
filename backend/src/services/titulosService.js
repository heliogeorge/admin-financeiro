/**
 * Visão por TÍTULO do Contas a Pagar (plano de remodelagem, F1).
 *
 * Um "título" agrupa as parcelas (linhas de contas_pagar) de uma mesma compra:
 *  - chave preferida: a entrada de mercadoria vinculada via contas_pagar_itens;
 *  - fallback: fornecedor + documento + loja (parcelas do ERP ainda não vinculadas);
 *  - conta sem documento e sem entrada fica como título de parcela única.
 *
 * Nada é persistido — é tudo agregação em cima do modelo atual.
 */
const { adminDb } = require('../config/database');
const { toNumber } = require('./reconciliationService');

const TABLE = 'contas_pagar';
const ITENS = 'contas_pagar_itens';
const ENTRADAS = 'entradas_mercadoria';
const DDA = 'dda_documentos';
const BAIXAS = 'contas_pagar_baixas';

const CHAVE_SQL = `COALESCE(
  CONCAT('E', mapa.entrada_id),
  CONCAT('D|', COALESCE(NULLIF(${TABLE}.erp_fornecedor_id, ''), ${TABLE}.fornecedor), '|',
    COALESCE(NULLIF(${TABLE}.documento, ''), CONCAT('#', ${TABLE}.id)), '|',
    COALESCE(${TABLE}.codiloja, ''))
)`;

function statusDoGrupo(grupo) {
  const saldo = toNumber(grupo.saldo_aberto);
  if (saldo <= 0.01 && toNumber(grupo.valor_total) > 0) return 'pago';
  if (Number(grupo.qtd_vencidas) > 0) return 'vencido';
  return 'pendente';
}

function buildGrouped(trx, filters = {}) {
  const mapa = trx(ITENS)
    .select('conta_pagar_id')
    .min('entrada_id as entrada_id')
    .whereNotNull('entrada_id')
    .groupBy('conta_pagar_id')
    .as('mapa');

  let q = trx(TABLE)
    .leftJoin(mapa, 'mapa.conta_pagar_id', `${TABLE}.id`)
    .where(`${TABLE}.status`, '!=', 'cancelado');

  if (filters.codiloja) q = q.where(`${TABLE}.codiloja`, filters.codiloja);
  if (filters.fornecedor) q = q.where(`${TABLE}.fornecedor`, 'like', `%${filters.fornecedor}%`);
  if (filters.origem) q = q.where(`${TABLE}.origem`, filters.origem);

  q = q
    .select(trx.raw(`${CHAVE_SQL} as chave`))
    .select(trx.raw('MAX(mapa.entrada_id) as entrada_id'))
    .select(trx.raw(`MAX(${TABLE}.fornecedor) as fornecedor`))
    .select(trx.raw(`MAX(${TABLE}.erp_fornecedor_id) as erp_fornecedor_id`))
    .select(trx.raw(`MAX(${TABLE}.documento) as documento`))
    .select(trx.raw(`MAX(${TABLE}.codiloja) as codiloja`))
    .select(trx.raw('COUNT(*) as qtd_parcelas'))
    .select(trx.raw(`SUM(${TABLE}.status = 'pago') as qtd_pagas`))
    .select(trx.raw(`SUM(${TABLE}.status = 'vencido') as qtd_vencidas`))
    .select(trx.raw(`SUM(${TABLE}.valor) as valor_total`))
    .select(trx.raw(`SUM(${TABLE}.valor_pago) as valor_pago`))
    .select(trx.raw(`SUM(${TABLE}.valor_desconto) as valor_desconto`))
    .select(trx.raw(`SUM(${TABLE}.saldo_aberto) as saldo_aberto`))
    .select(trx.raw(
      `MIN(CASE WHEN ${TABLE}.status IN ('pendente','vencido') THEN ${TABLE}.data_vencimento END) as proxima_vencimento`
    ))
    .select(trx.raw(`MIN(${TABLE}.data_vencimento) as primeira_vencimento`))
    .select(trx.raw(`MAX(${TABLE}.data_vencimento) as ultima_vencimento`))
    .select(trx.raw(`GROUP_CONCAT(DISTINCT ${TABLE}.origem) as origens`))
    .select(trx.raw(`GROUP_CONCAT(${TABLE}.id) as conta_ids`))
    .groupByRaw(CHAVE_SQL);

  // Período: o título entra se QUALQUER parcela vence no intervalo
  // (os totais continuam somando todas as parcelas do título).
  if (filters.dataInicio && filters.dataFim) {
    q = q.havingRaw(
      `SUM(CASE WHEN ${TABLE}.data_vencimento BETWEEN ? AND ? THEN 1 ELSE 0 END) > 0`,
      [filters.dataInicio, filters.dataFim]
    );
  } else if (filters.dataInicio) {
    q = q.havingRaw(
      `SUM(CASE WHEN ${TABLE}.data_vencimento >= ? THEN 1 ELSE 0 END) > 0`,
      [filters.dataInicio]
    );
  } else if (filters.dataFim) {
    q = q.havingRaw(
      `SUM(CASE WHEN ${TABLE}.data_vencimento <= ? THEN 1 ELSE 0 END) > 0`,
      [filters.dataFim]
    );
  }

  // Status no nível do título
  if (filters.status === 'pago') {
    q = q.havingRaw(`SUM(${TABLE}.saldo_aberto) <= 0.01`);
  } else if (filters.status === 'vencido') {
    q = q.havingRaw(`SUM(${TABLE}.status = 'vencido') > 0`);
  } else if (filters.status === 'pendente') {
    q = q.havingRaw(`SUM(${TABLE}.saldo_aberto) > 0.01 AND SUM(${TABLE}.status = 'vencido') = 0`);
  }

  return q;
}

async function listTitulos(filters = {}) {
  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(filters.perPage, 10) || 30));

  return adminDb.transaction(async (trx) => {
    // listas de ids por grupo podem passar do limite default de 1024 chars
    await trx.raw('SET SESSION group_concat_max_len = 1000000');

    const countRow = await trx
      .from(buildGrouped(trx, filters).as('t'))
      .count('* as total')
      .first();
    const total = Number(countRow?.total || 0);

    const grupos = await buildGrouped(trx, filters)
      .orderByRaw('(proxima_vencimento IS NULL) ASC, proxima_vencimento ASC, ultima_vencimento DESC')
      .limit(perPage)
      .offset((page - 1) * perPage);

    const contaIds = grupos.flatMap((g) => String(g.conta_ids || '')
      .split(',').filter(Boolean).map(Number));

    let parcelas = [];
    let ddaCounts = [];
    let baixaCounts = [];
    if (contaIds.length > 0) {
      parcelas = await trx(TABLE)
        .whereIn('id', contaIds)
        .select(
          'id', 'fornecedor', 'erp_fornecedor_id', 'documento', 'referencia',
          'codiloja', 'origem', 'erp_lancamento', 'descricao', 'historico',
          'data_emissao', 'data_vencimento', 'data_pagamento',
          'valor', 'valor_pago', 'valor_desconto', 'saldo_aberto',
          'status', 'status_conciliacao', 'forma_pagamento', 'comprovante_path'
        )
        .orderBy('data_vencimento', 'asc')
        .orderBy('id', 'asc');

      ddaCounts = await trx(DDA)
        .select('conta_pagar_id')
        .count('* as n')
        .whereIn('conta_pagar_id', contaIds)
        .groupBy('conta_pagar_id');

      baixaCounts = await trx(BAIXAS)
        .select('conta_pagar_id')
        .count('* as n')
        .whereIn('conta_pagar_id', contaIds)
        .where('estornada', false)
        .groupBy('conta_pagar_id');
    }

    const entradaIds = grupos.map((g) => g.entrada_id).filter(Boolean);
    const entradas = entradaIds.length > 0
      ? await trx(ENTRADAS)
        .whereIn('id', entradaIds)
        .select(
          'id', 'numerorr', 'numeronf', 'fornecedor', 'codiforn',
          'data_emissao', 'total_faturado', 'status_titulacao', 'status_pagamento'
        )
      : [];

    const ddaMap = ddaCounts.reduce((acc, r) => { acc[r.conta_pagar_id] = Number(r.n); return acc; }, {});
    const baixaMap = baixaCounts.reduce((acc, r) => { acc[r.conta_pagar_id] = Number(r.n); return acc; }, {});
    const parcelaMap = parcelas.reduce((acc, p) => {
      acc[p.id] = {
        ...p,
        dda_count: ddaMap[p.id] || 0,
        total_baixas: baixaMap[p.id] || 0,
      };
      return acc;
    }, {});
    const entradaMap = entradas.reduce((acc, e) => { acc[e.id] = e; return acc; }, {});

    const data = grupos.map((g) => {
      const ids = String(g.conta_ids || '').split(',').filter(Boolean).map(Number);
      const membros = ids.map((id) => parcelaMap[id]).filter(Boolean)
        .sort((a, b) => (new Date(a.data_vencimento) - new Date(b.data_vencimento)) || (a.id - b.id));
      const valorPago = toNumber(g.valor_pago);
      return {
        chave: g.chave,
        tipo: g.entrada_id ? 'entrada' : 'documento',
        entrada: g.entrada_id ? (entradaMap[g.entrada_id] || { id: g.entrada_id }) : null,
        fornecedor: g.fornecedor,
        erp_fornecedor_id: g.erp_fornecedor_id,
        documento: g.documento,
        codiloja: g.codiloja,
        qtd_parcelas: Number(g.qtd_parcelas),
        qtd_pagas: Number(g.qtd_pagas),
        qtd_vencidas: Number(g.qtd_vencidas),
        valor_total: toNumber(g.valor_total),
        valor_pago: valorPago,
        valor_desconto: toNumber(g.valor_desconto),
        saldo_aberto: toNumber(g.saldo_aberto),
        proxima_vencimento: g.proxima_vencimento,
        primeira_vencimento: g.primeira_vencimento,
        ultima_vencimento: g.ultima_vencimento,
        origens: String(g.origens || '').split(',').filter(Boolean),
        status: statusDoGrupo(g),
        parcial: valorPago > 0 && toNumber(g.saldo_aberto) > 0.01,
        parcelas: membros,
      };
    });

    return {
      data,
      pagination: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage) || 1,
      },
    };
  });
}

/**
 * Título de UMA conta (para o bloco "Título" no detalhe):
 * devolve as parcelas irmãs (inclusive a própria) + resumo + entrada vinculada.
 */
async function buildTituloDaConta(conta) {
  if (!conta) return null;

  let entrada = null;
  let irmaIds = [];

  const item = await adminDb(ITENS)
    .where('conta_pagar_id', conta.id)
    .whereNotNull('entrada_id')
    .orderBy('entrada_id', 'asc')
    .first('entrada_id');

  if (item) {
    const rows = await adminDb(ITENS)
      .where('entrada_id', item.entrada_id)
      .whereNotNull('conta_pagar_id')
      .distinct('conta_pagar_id');
    irmaIds = rows.map((r) => r.conta_pagar_id);
    entrada = await adminDb(ENTRADAS)
      .where('id', item.entrada_id)
      .first(
        'id', 'numerorr', 'numeronf', 'fornecedor', 'codiforn',
        'data_emissao', 'total_faturado', 'status_titulacao', 'status_pagamento'
      );
  } else if (conta.documento) {
    let q = adminDb(TABLE)
      .where('documento', conta.documento)
      .where('status', '!=', 'cancelado')
      .whereRaw('codiloja <=> ?', [conta.codiloja]);
    if (conta.erp_fornecedor_id) q = q.where('erp_fornecedor_id', conta.erp_fornecedor_id);
    else q = q.where('fornecedor', conta.fornecedor);
    const rows = await q.select('id');
    irmaIds = rows.map((r) => r.id);
  } else {
    irmaIds = [conta.id];
  }

  if (!irmaIds.includes(conta.id)) irmaIds.push(conta.id);

  const parcelas = await adminDb(TABLE)
    .whereIn('id', irmaIds)
    .where('status', '!=', 'cancelado')
    .select(
      'id', 'documento', 'referencia', 'data_vencimento', 'data_pagamento',
      'valor', 'valor_pago', 'saldo_aberto', 'status', 'status_conciliacao', 'origem'
    )
    .orderBy('data_vencimento', 'asc')
    .orderBy('id', 'asc');

  const resumo = parcelas.reduce((acc, p) => {
    acc.valor_total += toNumber(p.valor);
    acc.valor_pago += toNumber(p.valor_pago);
    acc.saldo_aberto += toNumber(p.saldo_aberto);
    if (p.status === 'pago') acc.qtd_pagas += 1;
    return acc;
  }, { valor_total: 0, valor_pago: 0, saldo_aberto: 0, qtd_pagas: 0 });

  return {
    tipo: entrada ? 'entrada' : 'documento',
    entrada,
    qtd_parcelas: parcelas.length,
    qtd_pagas: resumo.qtd_pagas,
    valor_total: Number(resumo.valor_total.toFixed(2)),
    valor_pago: Number(resumo.valor_pago.toFixed(2)),
    saldo_aberto: Number(resumo.saldo_aberto.toFixed(2)),
    parcelas,
  };
}

module.exports = { listTitulos, buildTituloDaConta };
