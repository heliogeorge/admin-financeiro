const { erpDb } = require('../config/database');

const RELREC_TABLE = 'RELREC';
const CADFOR_TABLE = 'CADFOR';

const RelrecModel = {
  async list({
    codiloja = null,
    dataInicio = null,
    dataFim = null,
    fornecedor = null,
    numeroNf = null,
    chaveNfe = null,
    page = 1,
    perPage = 50,
    orderBy = 'dataemis',
    orderDir = 'DESC',
  } = {}) {
    function applyFilters(q) {
      if (codiloja) q = q.where(`${RELREC_TABLE}.codiloja`, codiloja);
      if (dataInicio) q = q.where(`${RELREC_TABLE}.dataemis`, '>=', dataInicio);
      if (dataFim) q = q.where(`${RELREC_TABLE}.dataemis`, '<=', dataFim);
      if (fornecedor) q = q.where(function () {
        this.where(`${RELREC_TABLE}.codiforn`, 'like', `%${fornecedor}%`)
          .orWhere(`${CADFOR_TABLE}.nomeforn`, 'like', `%${fornecedor}%`);
      });
      if (numeroNf) q = q.where(`${RELREC_TABLE}.numeronf`, 'like', `%${numeroNf}%`);
      if (chaveNfe) q = q.where(`${RELREC_TABLE}.nfe_chav`, 'like', `%${chaveNfe}%`);
      return q;
    }

    // Contagem separada
    const countResult = await applyFilters(
      erpDb(RELREC_TABLE)
        .leftJoin(CADFOR_TABLE, `${RELREC_TABLE}.codiforn`, `${CADFOR_TABLE}.codiforn`)
    )
      .count('* as total')
      .first();
    const total = countResult.total;

    // Dados paginados com nome do fornecedor
    const offset = (page - 1) * perPage;
    const allowedOrderBy = new Set([
      'dataemis', 'recebinf', 'totalfat', 'totalpro',
      'codiforn', 'numeronf', 'numerorr', 'codiloja',
    ]);
    const safeOrderBy = allowedOrderBy.has(orderBy) ? orderBy : 'dataemis';
    const safeOrderDir = String(orderDir).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const data = await applyFilters(
      erpDb(RELREC_TABLE)
        .select(`${RELREC_TABLE}.*`, `${CADFOR_TABLE}.nomeforn`)
        .leftJoin(CADFOR_TABLE, `${RELREC_TABLE}.codiforn`, `${CADFOR_TABLE}.codiforn`)
    )
      .orderBy(`${RELREC_TABLE}.${safeOrderBy}`, safeOrderDir)
      .limit(perPage)
      .offset(offset);

    return {
      data,
      pagination: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    };
  },

  async findByNumero(numerorr, codiempr = null) {
    let query = erpDb(RELREC_TABLE)
      .select(`${RELREC_TABLE}.*`, `${CADFOR_TABLE}.nomeforn`)
      .leftJoin(CADFOR_TABLE, `${RELREC_TABLE}.codiforn`, `${CADFOR_TABLE}.codiforn`)
      .where(`${RELREC_TABLE}.numerorr`, numerorr);
    if (codiempr) query = query.where(`${RELREC_TABLE}.codiempr`, codiempr);
    return query.first();
  },

  async findByChaveNfe(nfe_chav) {
    return erpDb(RELREC_TABLE)
      .select(`${RELREC_TABLE}.*`, `${CADFOR_TABLE}.nomeforn`)
      .leftJoin(CADFOR_TABLE, `${RELREC_TABLE}.codiforn`, `${CADFOR_TABLE}.codiforn`)
      .where(`${RELREC_TABLE}.nfe_chav`, nfe_chav)
      .first();
  },

  async findByNfFornecedor(numeronf, codiforn) {
    return erpDb(RELREC_TABLE)
      .select(`${RELREC_TABLE}.*`, `${CADFOR_TABLE}.nomeforn`)
      .leftJoin(CADFOR_TABLE, `${RELREC_TABLE}.codiforn`, `${CADFOR_TABLE}.codiforn`)
      .where(`${RELREC_TABLE}.numeronf`, numeronf)
      .where(`${RELREC_TABLE}.codiforn`, codiforn)
      .first();
  },

  async listByFornecedor(codiforn, { dataInicio = null, dataFim = null } = {}) {
    let query = erpDb(RELREC_TABLE)
      .select(`${RELREC_TABLE}.*`, `${CADFOR_TABLE}.nomeforn`)
      .leftJoin(CADFOR_TABLE, `${RELREC_TABLE}.codiforn`, `${CADFOR_TABLE}.codiforn`)
      .where(`${RELREC_TABLE}.codiforn`, codiforn)
      .orderBy(`${RELREC_TABLE}.dataemis`, 'DESC');

    if (dataInicio) query = query.where(`${RELREC_TABLE}.dataemis`, '>=', dataInicio);
    if (dataFim) query = query.where(`${RELREC_TABLE}.dataemis`, '<=', dataFim);
    return query;
  },

  async resumo({ codiloja = null, dataInicio = null, dataFim = null } = {}) {
    let query = erpDb(RELREC_TABLE);

    if (codiloja) query = query.where('codiloja', codiloja);
    if (dataInicio) query = query.where('dataemis', '>=', dataInicio);
    if (dataFim) query = query.where('dataemis', '<=', dataFim);

    const result = await query
      .sum('totalpro as totalProdutos')
      .sum('totalfat as totalFaturado')
      .sum('totaicms as totalIcms')
      .sum('totalipi as totalIpi')
      .sum('valorfre as totalFrete')
      .sum('desconto as totalDesconto')
      .count('* as qtdEntradas')
      .first();

    return result;
  },

  async entradasSemVinculo({ codiloja = null, dataInicio = null, dataFim = null, page = 1, perPage = 50 } = {}) {
    function applyFilters(q) {
      q = q.whereNotNull(`${RELREC_TABLE}.numeronf`).where(`${RELREC_TABLE}.numeronf`, '!=', '');
      if (codiloja) q = q.where(`${RELREC_TABLE}.codiloja`, codiloja);
      if (dataInicio) q = q.where(`${RELREC_TABLE}.dataemis`, '>=', dataInicio);
      if (dataFim) q = q.where(`${RELREC_TABLE}.dataemis`, '<=', dataFim);
      return q;
    }

    const countResult = await applyFilters(erpDb(RELREC_TABLE))
      .count('* as total')
      .first();
    const total = countResult.total;

    const offset = (page - 1) * perPage;
    const data = await applyFilters(
      erpDb(RELREC_TABLE)
        .select(`${RELREC_TABLE}.*`, `${CADFOR_TABLE}.nomeforn`)
        .leftJoin(CADFOR_TABLE, `${RELREC_TABLE}.codiforn`, `${CADFOR_TABLE}.codiforn`)
    )
      .orderBy(`${RELREC_TABLE}.dataemis`, 'DESC')
      .limit(perPage)
      .offset(offset);

    return {
      data,
      pagination: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    };
  },
};

module.exports = RelrecModel;
