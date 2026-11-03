const express = require('express');
const router = express.Router();
const { erpDb, erpLoja2Db } = require('../config/database');

const TABLE = 'PV_COM';
const VENDEDORES_TABLE = 'CADVEN';
const ALLOWED_ORDER = new Set(['dataemis', 'codiloja', 'codivend', 'valorbas']);
const LOJA_2_ALIASES = ['2', '02', 2];
const ORDER_COLUMNS = {
  dataemis: 'pv.dataemis',
  codiloja: 'pv.codiloja',
  codivend: 'pv.codivend',
  valorbas: 'pv.valorbas',
};

function clean(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function parsePage(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isLoja2(value) {
  const normalized = clean(value).replace(/^0+/, '') || '0';
  return normalized === '2';
}

function lojaAliases(value) {
  const normalized = clean(value);
  if (!normalized) return [];
  if (isLoja2(normalized)) return LOJA_2_ALIASES;
  if ((normalized.replace(/^0+/, '') || '0') === '1') return ['1', '01', 1];
  return [normalized];
}

function getSources(filters) {
  const codiloja = clean(filters.codiloja);

  if (codiloja && isLoja2(codiloja)) {
    return [{
      name: erpLoja2Db ? 'loja2' : 'principal',
      db: erpLoja2Db || erpDb,
      codilojaAliases: LOJA_2_ALIASES,
    }];
  }

  if (codiloja) {
    return [{
      name: 'principal',
      db: erpDb,
      codilojaAliases: lojaAliases(codiloja),
    }];
  }

  const sources = [{ name: 'principal', db: erpDb, codilojaAliases: null }];
  if (erpLoja2Db) {
    sources.push({ name: 'loja2', db: erpLoja2Db, codilojaAliases: LOJA_2_ALIASES });
  }
  return sources;
}

function pvQuery(source) {
  return source.db({ pv: TABLE });
}

function vendasQuery(source) {
  return pvQuery(source).leftJoin({ cv: VENDEDORES_TABLE }, function joinVendedor() {
    this.on('pv.codivend', '=', 'cv.codivend')
      .andOn('pv.codiloja', '=', 'cv.codiloja');
  });
}

function applyFilters(query, filters, source = {}) {
  const codiloja = clean(filters.codiloja);
  const codivend = clean(filters.codivend);
  const dataInicio = clean(filters.dataInicio);
  const dataFim = clean(filters.dataFim);

  if (source.codilojaAliases?.length) query.whereIn('pv.codiloja', source.codilojaAliases);
  else if (codiloja) query.whereIn('pv.codiloja', lojaAliases(codiloja));
  if (codivend) query.where('pv.codivend', codivend);
  if (dataInicio) query.where('pv.dataemis', '>=', dataInicio);
  if (dataFim) query.where('pv.dataemis', '<=', dataFim);

  return query;
}

function rowValue(row, field) {
  if (field === 'valorbas') return Number(row.valorbas || 0);
  return row[field] ?? '';
}

function sortRows(rows, orderBy, orderDir) {
  const direction = orderDir === 'ASC' ? 1 : -1;
  return rows.sort((a, b) => {
    const av = rowValue(a, orderBy);
    const bv = rowValue(b, orderBy);
    if (av > bv) return direction;
    if (av < bv) return -direction;
    if (a.codiloja > b.codiloja) return 1;
    if (a.codiloja < b.codiloja) return -1;
    return 0;
  });
}

async function countSource(source, filters) {
  const row = await applyFilters(pvQuery(source), filters, source).count('* as total').first();
  return Number(row?.total || 0);
}

async function listSource(source, filters, orderBy, orderDir, limit, offset = 0) {
  const rows = await applyFilters(vendasQuery(source), filters, source)
    .select(
      'pv.codiloja as codiloja',
      'pv.dataemis as dataemis',
      'pv.valorbas as valorbas',
      'pv.codivend as codivend',
      'cv.nomevend as nomevend',
    )
    .orderBy(ORDER_COLUMNS[orderBy], orderDir)
    .orderBy('pv.codiloja', 'asc')
    .limit(limit)
    .offset(offset);

  return rows.map((row) => ({ ...row, fonte: source.name }));
}

async function vendedorGroups(source, filters) {
  return applyFilters(vendasQuery(source), filters, source)
    .select('pv.codivend as codivend', 'cv.nomevend as nomevend')
    .count('* as qtd_pedidos')
    .sum('pv.valorbas as total_vendas')
    .groupBy('pv.codivend', 'cv.nomevend');
}

async function sourceStats(source, filters) {
  const query = source.db(TABLE)
    .select('codiloja')
    .count('* as qtd_pedidos')
    .min('dataemis as primeira_data')
    .max('dataemis as ultima_data')
    .sum('valorbas as total_vendas')
    .groupBy('codiloja')
    .orderBy('codiloja', 'asc');

  const dataInicio = clean(filters.dataInicio);
  const dataFim = clean(filters.dataFim);
  if (dataInicio) query.where('dataemis', '>=', dataInicio);
  if (dataFim) query.where('dataemis', '<=', dataFim);

  const rows = await query;
  return rows.map((row) => ({
    codiloja: row.codiloja,
    qtd_pedidos: Number(row.qtd_pedidos || 0),
    primeira_data: row.primeira_data,
    ultima_data: row.ultima_data,
    total_vendas: Number(row.total_vendas || 0),
  }));
}

router.get('/diagnostico', async (req, res) => {
  const sources = [
    { name: 'principal', db: erpDb },
    ...(erpLoja2Db ? [{ name: 'loja2', db: erpLoja2Db }] : []),
  ];

  const resultados = [];
  for (const source of sources) {
    try {
      resultados.push({
        fonte: source.name,
        ok: true,
        codiloja: await sourceStats(source, req.query),
      });
    } catch (err) {
      resultados.push({
        fonte: source.name,
        ok: false,
        erro: err.message,
      });
    }
  }

  res.json({
    loja2_configurada: Boolean(erpLoja2Db),
    resultados,
  });
});

router.get('/', async (req, res, next) => {
  try {
    const {
      page = 1,
      perPage = 50,
      orderBy = 'dataemis',
      orderDir = 'DESC',
    } = req.query;

    const pageNum = parsePage(page, 1);
    const pageSize = Math.min(500, parsePage(perPage, 50));
    const safeOrderBy = ALLOWED_ORDER.has(orderBy) ? orderBy : 'dataemis';
    const safeOrderDir = String(orderDir).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const sources = getSources(req.query);

    const total = (await Promise.all(sources.map((source) => countSource(source, req.query))))
      .reduce((sum, value) => sum + value, 0);

    let data;
    if (sources.length === 1) {
      data = await listSource(
        sources[0],
        req.query,
        safeOrderBy,
        safeOrderDir,
        pageSize,
        (pageNum - 1) * pageSize,
      );
    } else {
      const fetchLimit = Math.min(pageNum * pageSize, 2500);
      const rowsBySource = await Promise.all(
        sources.map((source) => listSource(source, req.query, safeOrderBy, safeOrderDir, fetchLimit)),
      );
      const merged = sortRows(rowsBySource.flat(), safeOrderBy, safeOrderDir);
      data = merged.slice((pageNum - 1) * pageSize, pageNum * pageSize);
    }

    res.json({
      data,
      fontes: sources.map((source) => source.name),
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
    const sources = getSources(req.query);
    const groupsBySource = await Promise.all(sources.map((source) => vendedorGroups(source, req.query)));
    const vendedorMap = new Map();

    groupsBySource.flat().forEach((row) => {
      const key = String(row.codivend ?? '');
      const current = vendedorMap.get(key) || {
        codivend: row.codivend,
        nomevend: row.nomevend,
        qtd_pedidos: 0,
        total_vendas: 0,
      };
      if (!current.nomevend && row.nomevend) current.nomevend = row.nomevend;
      current.qtd_pedidos += Number(row.qtd_pedidos || 0);
      current.total_vendas += Number(row.total_vendas || 0);
      vendedorMap.set(key, current);
    });

    const todosVendedores = [...vendedorMap.values()]
      .sort((a, b) => b.total_vendas - a.total_vendas);
    const porVendedor = todosVendedores.slice(0, 20);

    res.json({
      qtd_pedidos: todosVendedores.reduce((sum, row) => sum + row.qtd_pedidos, 0),
      total_vendas: todosVendedores.reduce((sum, row) => sum + row.total_vendas, 0),
      qtd_vendedores: vendedorMap.size,
      fontes: sources.map((source) => source.name),
      por_vendedor: porVendedor,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
