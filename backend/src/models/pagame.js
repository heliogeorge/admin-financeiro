const { erpDb } = require('../config/database');

const PAGAME_TABLE = 'PAGAME';
const CADFOR_TABLE = 'CADFOR';
const COL_FORNECEDOR = 'fornclie';

const PagameModel = {
  async list({
    codiloja = null,
    dataInicio = null,
    dataFim = null,
    status = null,
    fornecedor = null,
    page = 1,
    perPage = 50,
    orderBy = 'datavenc',
    orderDir = 'DESC',
  } = {}) {
    function applyFilters(q) {
      if (codiloja) q = q.where(`${PAGAME_TABLE}.codiloja`, codiloja);
      if (dataInicio) q = q.where(`${PAGAME_TABLE}.datavenc`, '>=', dataInicio);
      if (dataFim) q = q.where(`${PAGAME_TABLE}.datavenc`, '<=', dataFim);
      if (status === 'pago') q = q.whereNotNull(`${PAGAME_TABLE}.databaix`);
      else if (status === 'pendente') q = q.whereNull(`${PAGAME_TABLE}.databaix`).where(`${PAGAME_TABLE}.datavenc`, '>=', erpDb.fn.now());
      else if (status === 'vencido') q = q.whereNull(`${PAGAME_TABLE}.databaix`).where(`${PAGAME_TABLE}.datavenc`, '<', erpDb.fn.now());
      if (fornecedor) q = q.where(function () {
        this.where(`${PAGAME_TABLE}.${COL_FORNECEDOR}`, 'like', `%${fornecedor}%`)
          .orWhere(`${CADFOR_TABLE}.nomeforn`, 'like', `%${fornecedor}%`);
      });
      return q;
    }

    // Contagem
    const countResult = await applyFilters(
      erpDb(PAGAME_TABLE)
        .leftJoin(CADFOR_TABLE, `${PAGAME_TABLE}.${COL_FORNECEDOR}`, `${CADFOR_TABLE}.codiforn`)
    )
      .count('* as total')
      .first();
    const total = countResult.total;

    // Dados paginados com nome do fornecedor
    const offset = (page - 1) * perPage;
    const allowedOrderBy = new Set([
      'datavenc', 'dataemis', 'databaix', 'valorent',
      'fornclie', 'document', 'lancamen', 'codiloja',
    ]);
    const safeOrderBy = allowedOrderBy.has(orderBy) ? orderBy : 'datavenc';
    const safeOrderDir = String(orderDir).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const data = await applyFilters(
      erpDb(PAGAME_TABLE)
        .select(`${PAGAME_TABLE}.*`, `${CADFOR_TABLE}.nomeforn`)
        .leftJoin(CADFOR_TABLE, `${PAGAME_TABLE}.${COL_FORNECEDOR}`, `${CADFOR_TABLE}.codiforn`)
    )
      .orderBy(`${PAGAME_TABLE}.${safeOrderBy}`, safeOrderDir)
      .limit(perPage)
      .offset(offset);

    return {
      data,
      pagination: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    };
  },

  async findByLancamento(lancamen, codiempr = null) {
    let query = erpDb(PAGAME_TABLE)
      .select(`${PAGAME_TABLE}.*`, `${CADFOR_TABLE}.nomeforn`)
      .leftJoin(CADFOR_TABLE, `${PAGAME_TABLE}.${COL_FORNECEDOR}`, `${CADFOR_TABLE}.codiforn`)
      .where(`${PAGAME_TABLE}.lancamen`, lancamen);
    if (codiempr) query = query.where(`${PAGAME_TABLE}.codiempr`, codiempr);
    return query.first();
  },

  async resumo({ codiloja = null, dataInicio = null, dataFim = null } = {}) {
    function applyBase(q) {
      if (codiloja) q = q.where('codiloja', codiloja);
      if (dataInicio) q = q.where('datavenc', '>=', dataInicio);
      if (dataFim) q = q.where('datavenc', '<=', dataFim);
      return q;
    }

    const pendente = await applyBase(erpDb(PAGAME_TABLE))
      .whereNull('databaix')
      .where('datavenc', '>=', erpDb.fn.now())
      .sum('valorent as total')
      .count('* as qtd')
      .first();

    const vencido = await applyBase(erpDb(PAGAME_TABLE))
      .whereNull('databaix')
      .where('datavenc', '<', erpDb.fn.now())
      .sum('valorent as total')
      .count('* as qtd')
      .first();

    const pago = await applyBase(erpDb(PAGAME_TABLE))
      .whereNotNull('databaix')
      .sum('valorent as total')
      .count('* as qtd')
      .first();

    return {
      pendente: { total: pendente.total || 0, qtd: pendente.qtd || 0 },
      vencido: { total: vencido.total || 0, qtd: vencido.qtd || 0 },
      pago: { total: pago.total || 0, qtd: pago.qtd || 0 },
    };
  },

  async fluxoPorDia({ codiloja = null, dataInicio, dataFim } = {}) {
    let query = erpDb(PAGAME_TABLE)
      .select('datavenc')
      .sum('valorent as total')
      .count('* as qtd')
      .whereNull('databaix')
      .whereBetween('datavenc', [dataInicio, dataFim])
      .groupBy('datavenc')
      .orderBy('datavenc', 'ASC');

    if (codiloja) query = query.where('codiloja', codiloja);
    return query;
  },

  async topFornecedores({ codiloja = null, dataInicio = null, dataFim = null, limit = 10 } = {}) {
    let query = erpDb(PAGAME_TABLE)
      .select(`${PAGAME_TABLE}.${COL_FORNECEDOR}`, `${CADFOR_TABLE}.nomeforn`)
      .sum('valorent as total')
      .count('* as qtd')
      .leftJoin(CADFOR_TABLE, `${PAGAME_TABLE}.${COL_FORNECEDOR}`, `${CADFOR_TABLE}.codiforn`)
      .groupBy(`${PAGAME_TABLE}.${COL_FORNECEDOR}`, `${CADFOR_TABLE}.nomeforn`)
      .orderBy('total', 'DESC')
      .limit(limit);

    if (codiloja) query = query.where(`${PAGAME_TABLE}.codiloja`, codiloja);
    if (dataInicio) query = query.where(`${PAGAME_TABLE}.datavenc`, '>=', dataInicio);
    if (dataFim) query = query.where(`${PAGAME_TABLE}.datavenc`, '<=', dataFim);
    return query;
  },
};

module.exports = PagameModel;
