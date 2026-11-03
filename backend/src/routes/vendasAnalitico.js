const express = require('express');
const router = express.Router();
const { erpDb, erpLoja2Db } = require('../config/database');

// Relatório sequencial analítico de vendas, direto do ERP (SAS, MySQL 4.0 — sem
// subqueries/CTE). Réplica do Crystal PDVSEQUENCIALANAL: vendedor → pedido → itens.
// Fontes: retaguarda (192.168.0.2) para as lojas 01/03 e servidor local da loja 2
// (ERP_LOJA2_*) para a Embalatti — mesmo padrão do rankingVendas. Quando as duas
// fontes são consultadas, a loja 2 é excluída da retaguarda para não duplicar.

const PEDIDO = 'PEDIDO';
const ITENS = 'ITEMPI';
const LOJA_2_ALIASES = ['2', '02'];

function clean(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function parsePage(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isLoja2(value) {
  return (clean(value).replace(/^0+/, '') || '0') === '2';
}

function lojaAliases(value) {
  const raw = clean(value);
  if (!raw) return null;
  const num = raw.replace(/^0+/, '') || '0';
  const padded = num.padStart(2, '0');
  return [...new Set([raw, num, padded])];
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
    return [{ name: 'principal', db: erpDb, codilojaAliases: lojaAliases(codiloja) }];
  }

  if (erpLoja2Db) {
    return [
      { name: 'principal', db: erpDb, codilojaAliases: null, excludeLoja2: true },
      { name: 'loja2', db: erpLoja2Db, codilojaAliases: LOJA_2_ALIASES },
    ];
  }
  return [{ name: 'principal', db: erpDb, codilojaAliases: null }];
}

function pedidoKey(row) {
  return `${row.codiempr}|${row.codiloja}|${row.numeropi}`;
}

function applyPedidoFilters(query, filters, source) {
  const { dataInicio, dataFim, codivend } = filters;
  query.where('p.numeropi', 'like', 'PV-%').where('p.cancelad', '');
  if (dataInicio) query.where('p.dataemis', '>=', dataInicio);
  if (dataFim) query.where('p.dataemis', '<=', dataFim);
  if (source.codilojaAliases) query.whereIn('p.codiloja', source.codilojaAliases);
  else if (source.excludeLoja2) query.whereNotIn('p.codiloja', LOJA_2_ALIASES);
  if (clean(codivend)) query.where('p.codivend', clean(codivend));
  return query;
}

async function produtosFiltro(db, produto) {
  const term = clean(produto);
  if (!term) return null;
  const rows = await db('CADPRO')
    .distinct('codiprod')
    .where(function search() {
      this.where('codiprod', 'like', `${term}%`)
        .orWhere('descprod', 'like', `%${term}%`)
        .orWhere('codifabr', 'like', `${term}%`);
    })
    .limit(3000);
  return rows.map((r) => clean(r.codiprod));
}

function buildPedidosQuery(source, filters, codiprods) {
  let query = source.db({ p: PEDIDO });
  if (codiprods) {
    query = query
      .join({ fi: ITENS }, function joinItens() {
        this.on('fi.numeropi', '=', 'p.numeropi')
          .andOn('fi.codiempr', '=', 'p.codiempr')
          .andOn('fi.codiloja', '=', 'p.codiloja');
      })
      .whereIn('fi.codiprod', codiprods);
  }
  return applyPedidoFilters(query, filters, source);
}

// Lookups com fallback: cadastro da própria loja do pedido; se não houver, loja 01.
function lookupMap(rows, codeField, nameField) {
  const map = new Map();
  for (const row of rows) {
    map.set(`${clean(row.codiempr)}|${clean(row.codiloja)}|${clean(row[codeField])}`, clean(row[nameField]));
  }
  return (codiempr, codiloja, code) => {
    const e = clean(codiempr);
    const c = clean(code);
    return map.get(`${e}|${clean(codiloja)}|${c}`)
      || map.get(`${e}|01|${c}`)
      || [...map.entries()].find(([k]) => k.endsWith(`|${c}`) && k.startsWith(`${e}|`))?.[1]
      || '';
  };
}

async function fetchVendedores(db) {
  const rows = await db('CADVEN').select('codiempr', 'codiloja', 'codivend', 'nomevend');
  return lookupMap(rows, 'codivend', 'nomevend');
}

async function fetchPagamentos(db) {
  const rows = await db('CADCPG').select('codiempr', 'codiloja', 'codipaga', 'nomepaga');
  return lookupMap(rows, 'codipaga', 'nomepaga');
}

async function fetchClientes(db, codiclies) {
  if (!codiclies.length) return () => '';
  const rows = await db('CADCLI')
    .select('codiempr', 'codiloja', 'codiclie', 'nomeclie')
    .whereIn('codiclie', codiclies);
  return lookupMap(rows, 'codiclie', 'nomeclie');
}

async function fetchProdutos(db, codiprods) {
  if (!codiprods.length) return () => null;
  const rows = await db('CADPRO')
    .select('codiempr', 'codiloja', 'codiprod', 'descprod', 'codifabr', 'unidprod')
    .whereIn('codiprod', codiprods);
  const map = new Map();
  for (const row of rows) {
    map.set(`${clean(row.codiempr)}|${clean(row.codiloja)}|${clean(row.codiprod)}`, row);
  }
  return (codiempr, codiloja, codiprod) => {
    const e = clean(codiempr);
    const c = clean(codiprod);
    return map.get(`${e}|${clean(codiloja)}|${c}`)
      || map.get(`${e}|01|${c}`)
      || [...map.entries()].find(([k]) => k.endsWith(`|${c}`))?.[1]
      || null;
  };
}

async function fetchItens(db, pedidos, codiprods) {
  // agrupa por empresa+loja para o whereIn de numeropi não misturar lojas
  const grupos = new Map();
  for (const p of pedidos) {
    const key = `${p.codiempr}|${p.codiloja}`;
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key).push(p.numeropi);
  }

  const porPedido = new Map();
  for (const [key, numeros] of grupos) {
    const [codiempr, codiloja] = key.split('|');
    const query = db({ i: ITENS })
      .select('i.numeropi', 'i.itempedi', 'i.codiprod', 'i.quantite', 'i.unitario', 'i.comivend')
      .where('i.codiempr', codiempr)
      .where('i.codiloja', codiloja)
      .whereIn('i.numeropi', numeros)
      .orderBy('i.numeropi', 'asc')
      .orderBy('i.itempedi', 'asc');
    if (codiprods) query.whereIn('i.codiprod', codiprods);

    const rows = await query;
    for (const row of rows) {
      const pk = `${codiempr}|${codiloja}|${clean(row.numeropi)}`;
      if (!porPedido.has(pk)) porPedido.set(pk, []);
      porPedido.get(pk).push(row);
    }
  }
  return porPedido;
}

function comparePedidos(a, b) {
  const av = clean(a.codivend);
  const bv = clean(b.codivend);
  if (av > bv) return 1;
  if (av < bv) return -1;
  const an = clean(a.numeropi);
  const bn = clean(b.numeropi);
  if (an > bn) return 1;
  if (an < bn) return -1;
  return 0;
}

// Busca em uma fonte: filtro de produto (no CADPRO da própria fonte), total e
// os pedidos ordenados por vendedor/numeropi.
async function fetchSourcePedidos(source, filters, limit, offset) {
  const codiprods = await produtosFiltro(source.db, filters.produto);
  if (codiprods && !codiprods.length) {
    return { source, codiprods, total: 0, pedidos: [] };
  }

  const countRow = await buildPedidosQuery(source, filters, codiprods)
    .select(source.db.raw("COUNT(DISTINCT CONCAT(p.codiempr, '|', p.codiloja, '|', p.numeropi)) as total"))
    .first();
  const total = Number(countRow?.total || 0);

  const pedidos = await buildPedidosQuery(source, filters, codiprods)
    .distinct(
      'p.codiempr', 'p.codiloja', 'p.numeropi', 'p.dataemis',
      'p.codiclie', 'p.codivend', 'p.codipaga',
    )
    .orderBy('p.codivend', 'asc')
    .orderBy('p.numeropi', 'asc')
    .limit(limit)
    .offset(offset);

  return {
    source,
    codiprods,
    total,
    pedidos: pedidos.map((p) => ({ ...p, fonte: source.name })),
  };
}

// Itens + cadastros vêm do banco da própria fonte do pedido (os cadastros da
// loja 2 só existem no servidor dela).
async function enrichPedidos(source, pedidos, codiprods) {
  const enriched = new Map();
  if (!pedidos.length) return enriched;

  const itensPorPedido = await fetchItens(source.db, pedidos, codiprods);
  const codiprodsPagina = [...new Set(
    [...itensPorPedido.values()].flat().map((i) => clean(i.codiprod)),
  )];

  const [vendedorDe, pagamentoDe, clienteDe, produtoDe] = await Promise.all([
    fetchVendedores(source.db),
    fetchPagamentos(source.db),
    fetchClientes(source.db, [...new Set(pedidos.map((p) => clean(p.codiclie)))]),
    fetchProdutos(source.db, codiprodsPagina),
  ]);

  for (const p of pedidos) {
    const itens = (itensPorPedido.get(pedidoKey(p)) || []).map((i) => {
      const prod = produtoDe(p.codiempr, p.codiloja, i.codiprod);
      const quantite = Number(i.quantite || 0);
      const unitario = Number(i.unitario || 0);
      return {
        itempedi: Number(i.itempedi || 0),
        codiprod: clean(i.codiprod),
        descprod: prod ? clean(prod.descprod) : '',
        codifabr: prod ? clean(prod.codifabr) : '',
        unidprod: prod ? clean(prod.unidprod) : '',
        quantite,
        unitario,
        total: quantite * unitario,
        comivend: Number(i.comivend || 0),
      };
    });
    enriched.set(pedidoKey(p), {
      codiempr: clean(p.codiempr),
      codiloja: clean(p.codiloja),
      numeropi: clean(p.numeropi),
      dataemis: p.dataemis,
      codiclie: clean(p.codiclie),
      nomeclie: clienteDe(p.codiempr, p.codiloja, p.codiclie),
      codivend: clean(p.codivend),
      nomevend: vendedorDe(p.codiempr, p.codiloja, p.codivend),
      codipaga: clean(p.codipaga),
      nomepaga: pagamentoDe(p.codiempr, p.codiloja, p.codipaga),
      fonte: source.name,
      qtd_itens: itens.reduce((s, i) => s + i.quantite, 0),
      total_pedido: itens.reduce((s, i) => s + i.total, 0),
      itens,
    });
  }
  return enriched;
}

router.get('/', async (req, res, next) => {
  try {
    const { page = 1, perPage = 50 } = req.query;
    const pageNum = parsePage(page, 1);
    const pageSize = Math.min(200, parsePage(perPage, 50));
    const sources = getSources(req.query);

    // Fonte única pagina direto no banco; com duas fontes busca até a página
    // atual em cada uma e intercala em memória (mesmo esquema do rankingVendas).
    const multi = sources.length > 1;
    const fetchLimit = multi ? Math.min(pageNum * pageSize, 2500) : pageSize;
    const fetchOffset = multi ? 0 : (pageNum - 1) * pageSize;

    const perSource = await Promise.all(
      sources.map((source) => fetchSourcePedidos(source, req.query, fetchLimit, fetchOffset)),
    );
    const total = perSource.reduce((sum, r) => sum + r.total, 0);

    let pagina;
    if (multi) {
      const merged = perSource.flatMap((r) => r.pedidos).sort(comparePedidos);
      pagina = merged.slice((pageNum - 1) * pageSize, pageNum * pageSize);
    } else {
      pagina = perSource[0].pedidos;
    }

    const enrichedBySource = new Map(await Promise.all(
      perSource.map(async (r) => {
        const daPagina = pagina.filter((p) => p.fonte === r.source.name);
        return [r.source.name, await enrichPedidos(r.source, daPagina, r.codiprods)];
      }),
    ));
    const data = pagina
      .map((p) => enrichedBySource.get(p.fonte)?.get(pedidoKey(p)))
      .filter(Boolean);

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

async function resumoSource(source, filters) {
  const codiprods = await produtosFiltro(source.db, filters.produto);
  if (codiprods && !codiprods.length) return [];

  let query = source.db({ p: PEDIDO }).join({ i: ITENS }, function joinItens() {
    this.on('i.numeropi', '=', 'p.numeropi')
      .andOn('i.codiempr', '=', 'p.codiempr')
      .andOn('i.codiloja', '=', 'p.codiloja');
  });
  query = applyPedidoFilters(query, filters, source);
  if (codiprods) query.whereIn('i.codiprod', codiprods);

  const rows = await query
    .select(
      'p.codiempr', 'p.codiloja', 'p.codivend',
      source.db.raw("COUNT(DISTINCT CONCAT(p.codiempr, '|', p.codiloja, '|', p.numeropi)) as qtd_pedidos"),
      source.db.raw('SUM(i.quantite) as qtd_itens'),
      source.db.raw('SUM(i.quantite * i.unitario) as total_vendas'),
    )
    .groupBy('p.codiempr', 'p.codiloja', 'p.codivend');

  const vendedorDe = await fetchVendedores(source.db);
  return rows.map((r) => ({
    codiempr: clean(r.codiempr),
    codiloja: clean(r.codiloja),
    codivend: clean(r.codivend),
    nomevend: vendedorDe(r.codiempr, r.codiloja, r.codivend),
    qtd_pedidos: Number(r.qtd_pedidos || 0),
    qtd_itens: Number(r.qtd_itens || 0),
    total_vendas: Number(r.total_vendas || 0),
  }));
}

router.get('/resumo', async (req, res, next) => {
  try {
    const sources = getSources(req.query);
    const groupsBySource = await Promise.all(
      sources.map((source) => resumoSource(source, req.query)),
    );

    const porVendedor = groupsBySource
      .flat()
      .sort((a, b) => b.total_vendas - a.total_vendas);

    res.json({
      qtd_pedidos: porVendedor.reduce((s, r) => s + r.qtd_pedidos, 0),
      qtd_itens: porVendedor.reduce((s, r) => s + r.qtd_itens, 0),
      total_vendas: porVendedor.reduce((s, r) => s + r.total_vendas, 0),
      qtd_vendedores: porVendedor.length,
      fontes: sources.map((source) => source.name),
      por_vendedor: porVendedor,
    });
  } catch (err) {
    next(err);
  }
});

// Diagnóstico: mostra o que cada fonte enxerga de PEDIDO por loja no período.
router.get('/diagnostico', async (req, res) => {
  const sources = [
    { name: 'principal', db: erpDb },
    ...(erpLoja2Db ? [{ name: 'loja2', db: erpLoja2Db }] : []),
  ];

  const resultados = [];
  for (const source of sources) {
    try {
      const query = source.db(PEDIDO)
        .select('codiloja')
        .count('* as qtd_pedidos')
        .min('dataemis as primeira_data')
        .max('dataemis as ultima_data')
        .where('numeropi', 'like', 'PV-%')
        .where('cancelad', '')
        .groupBy('codiloja')
        .orderBy('codiloja', 'asc');
      const dataInicio = clean(req.query.dataInicio);
      const dataFim = clean(req.query.dataFim);
      if (dataInicio) query.where('dataemis', '>=', dataInicio);
      if (dataFim) query.where('dataemis', '<=', dataFim);

      resultados.push({ fonte: source.name, ok: true, codiloja: await query });
    } catch (err) {
      resultados.push({ fonte: source.name, ok: false, erro: err.message });
    }
  }

  res.json({ loja2_configurada: Boolean(erpLoja2Db), resultados });
});

module.exports = router;
