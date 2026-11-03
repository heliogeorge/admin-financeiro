const express = require('express');
const router = express.Router();
const { erpDb } = require('../config/database');

const SCHEMA = 'RELAT';
const DEFAULT_TABLE = 'TB240010101';
const ORDER_COLUMNS = {
  codiprod: 'p.codiprod',
  descprod: 'p.descprod',
  codifabr: 'p.codifabr',
  codimarc: 'p.codimarc',
  nomemarc: 'm.nomemarc',
  custouni: 'p.custouni',
  estoquef: 'p.estoquef',
  precoven: 'p.precoven',
  percentu: 'p.percentu',
};

function clean(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function parsePage(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function baseQuery(table) {
  return erpDb
    .from({ p: `${SCHEMA}.${table}` })
    .leftJoin({ m: 'SAS.CADMAR' }, 'm.codimarc', 'p.codimarc');
}

function applyFilters(query, filters) {
  const search = clean(filters.search);
  const codiprod = clean(filters.codiprod);
  const codifabr = clean(filters.codifabr);
  const codimarc = clean(filters.codimarc);
  const somenteComEstoque = clean(filters.somenteComEstoque);

  if (search) {
    query.where(function applySearch() {
      this.where('p.codiprod', 'like', `%${search}%`)
        .orWhere('p.descprod', 'like', `%${search}%`)
        .orWhere('p.codifabr', 'like', `%${search}%`)
        .orWhere('p.codimarc', 'like', `%${search}%`)
        .orWhere('m.nomemarc', 'like', `%${search}%`);
    });
  }

  if (codiprod) query.where('p.codiprod', codiprod);
  if (codifabr) query.where('p.codifabr', 'like', `%${codifabr}%`);
  if (codimarc) query.where('p.codimarc', 'like', `%${codimarc}%`);
  if (somenteComEstoque === 'true') query.where('p.estoquef', '>', 0);

  return query;
}

function selectColumns(query) {
  return query.select(
    'p.codiprod as codiprod',
    'p.descprod as descprod',
    'p.codifabr as codifabr',
    'p.codimarc as codimarc',
    'm.nomemarc as nomemarc',
    'p.custouni as custouni',
    'p.estoquef as estoquef',
    'p.precoven as precoven',
    'p.percentu as percentu',
  );
}

router.get('/', async (req, res, next) => {
  try {
    const {
      page = 1,
      perPage = 50,
      orderBy = 'descprod',
      orderDir = 'ASC',
    } = req.query;

    const table = DEFAULT_TABLE;
    const pageNum = parsePage(page, 1);
    const pageSize = Math.min(500, parsePage(perPage, 50));
    const safeOrderBy = ORDER_COLUMNS[orderBy] || ORDER_COLUMNS.descprod;
    const safeOrderDir = String(orderDir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    const countResult = await applyFilters(baseQuery(table), req.query).count('* as total').first();
    const data = await selectColumns(applyFilters(baseQuery(table), req.query))
      .orderBy(safeOrderBy, safeOrderDir)
      .limit(pageSize)
      .offset((pageNum - 1) * pageSize);

    const total = Number(countResult?.total || 0);
    res.json({
      data,
      tabela: `${SCHEMA}.${table}`,
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
    const table = DEFAULT_TABLE;
    const row = await applyFilters(baseQuery(table), req.query)
      .count('* as total_produtos')
      .sum('p.estoquef as estoque_total')
      .avg('p.percentu as margem_media')
      .first();

    res.json({
      tabela: `${SCHEMA}.${table}`,
      total_produtos: Number(row?.total_produtos || 0),
      estoque_total: Number(row?.estoque_total || 0),
      margem_media: Number(row?.margem_media || 0),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/produtos/:codiprod/ultimas-entradas', async (req, res, next) => {
  try {
    const codiprod = clean(req.params.codiprod);

    if (!codiprod) {
      return res.status(400).json({ error: 'Codigo do produto nao informado.' });
    }

    const data = await erpDb
      .from({ i: 'SAS.RELRIT' })
      .leftJoin({ r: 'SAS.RELREC' }, function joinRelrec() {
        this.on('r.numerorr', '=', 'i.numerorr')
          .andOn('r.codiloja', '=', 'i.codiloja');
      })
      .where('i.codiprod', codiprod)
      .select(
        'i.codiloja as codiloja',
        'i.numerorr as numerorr',
        'r.dataemis as dataemis',
        'i.pr_cheio as pr_cheio',
        'i.unitario as unitario',
        'i.quantite as quantidade',
      )
      .orderBy('r.dataemis', 'DESC')
      .orderBy('i.numerorr', 'DESC')
      .limit(3);

    res.json({ codiprod, data });
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE' || err?.code === 'ER_BAD_FIELD_ERROR') {
      return res.status(400).json({
        error: `Erro ao consultar ultimas entradas no ERP: ${err.sqlMessage || err.message}`,
      });
    }

    next(err);
  }
});

module.exports = router;
