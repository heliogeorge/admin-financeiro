const express = require('express');
const router = express.Router();
const { erpDb } = require('../config/database');

const TABLE = 'CADLOJ';
const FIXED_LOJA_NAMES = {
  1: 'VIVENDA',
  2: 'EMBALATTI',
};

function normalize(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeCode(value) {
  const raw = normalize(value);
  return raw.replace(/^0+/, '') || raw;
}

function fixedLojaName(codiloja, fallback) {
  return FIXED_LOJA_NAMES[normalizeCode(codiloja)] || fallback;
}

function findColumn(columns, candidates) {
  const lowerMap = new Map(columns.map((column) => [column.toLowerCase(), column]));
  for (const candidate of candidates) {
    if (lowerMap.has(candidate.toLowerCase())) return lowerMap.get(candidate.toLowerCase());
  }
  return null;
}

async function getColumns() {
  const schema = process.env.ERP_DB_NAME || 'SAS';
  const rows = await erpDb('information_schema.COLUMNS')
    .select('COLUMN_NAME')
    .where('TABLE_SCHEMA', schema)
    .where('TABLE_NAME', TABLE)
    .orderBy('ORDINAL_POSITION', 'asc');

  return rows.map((row) => row.COLUMN_NAME);
}

router.get('/', async (req, res, next) => {
  try {
    const columns = await getColumns();
    const codeColumn = findColumn(columns, ['codiloja']);
    const nameColumn = findColumn(columns, [
      'nomeloja',
      'nomevend',
      'nome',
      'fantasia',
      'nomefant',
      'nomefanta',
      'razaosoc',
      'razao',
    ]) || columns.find((column) => column.toLowerCase().includes('nome'));

    if (!codeColumn) {
      return res.status(500).json({
        error: 'Coluna codiloja nao encontrada em SAS.CADLOJ.',
        columns,
      });
    }

    const selectMap = { codiloja: codeColumn };
    if (nameColumn) selectMap.nomeloja = nameColumn;

    const rows = await erpDb(TABLE)
      .select(selectMap)
      .orderBy(codeColumn, 'asc');

    res.json({
      data: rows
        .map((row) => ({
          codiloja: normalize(row.codiloja),
          nomeloja: fixedLojaName(row.codiloja, normalize(row.nomeloja) || `Loja ${normalize(row.codiloja)}`),
        }))
        .filter((row) => row.codiloja),
      meta: {
        table: TABLE,
        codeColumn,
        nameColumn,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
