const express = require('express');
const router = express.Router();
const { adminDb, erpDb } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const TABLE = 'plano_contas_erp';
const PLACON = 'PLACON';

function normalizeCode(value) {
  return String(value || '').trim();
}

function scopeKey(row) {
  return `${normalizeCode(row.codiempr)}|${normalizeCode(row.codiloja)}`;
}

function parentCode(code) {
  const parts = normalizeCode(code).split('.');
  if (parts.length !== 3) return null;

  const [major, mid, minor] = parts;
  if (minor !== '00') return `${major}.${mid}.00`;
  if (mid !== '00') return `${major}.00.00`;
  return null;
}

function codeLevel(code) {
  const parts = normalizeCode(code).split('.');
  if (parts.length !== 3) return 1;
  if (parts[2] !== '00') return 3;
  if (parts[1] !== '00') return 2;
  return 1;
}

function buildLabel(row) {
  const indent = '  '.repeat(Math.max(0, (row.nivel || 1) - 1));
  return `${indent}${row.codigo_erp} - ${row.descricao}`;
}

router.get('/', async (req, res, next) => {
  try {
    const {
      q,
      ativo = 'true',
      analitica,
      pagareci = 'P',
      codiloja,
      codiempr,
      limit = 300,
    } = req.query;

    let query = adminDb(TABLE).select('*');
    if (ativo !== 'all') {
      query = query.where('ativo', ativo === 'true');
    }
    if (analitica !== undefined) {
      query = query.where('analitica', analitica === 'true');
    }
    if (pagareci && pagareci !== 'all') {
      query = query.where('pagareci', pagareci);
    }
    if (codiloja) query = query.where('codiloja', codiloja);
    if (codiempr) query = query.where('codiempr', codiempr);
    if (q) {
      query = query.where(function () {
        this.where('descricao', 'like', `%${q}%`)
          .orWhere('codigo_erp', 'like', `%${q}%`);
      });
    }

    const data = await query
      .orderBy('codigo_erp', 'asc')
      .limit(parseInt(limit, 10));

    res.json(data.map((row) => ({ ...row, label: buildLabel(row) })));
  } catch (err) {
    next(err);
  }
});

router.post('/sync', authMiddleware, async (req, res, next) => {
  try {
    const { codiempr = null, codiloja = null } = req.body || {};

    let erpQuery = erpDb(PLACON).select('*');
    if (codiempr) erpQuery = erpQuery.where('codiempr', codiempr);
    if (codiloja) erpQuery = erpQuery.where('codiloja', codiloja);

    const rows = await erpQuery.orderBy('numconta', 'asc');
    const codesByScope = new Map();
    for (const row of rows) {
      const key = scopeKey(row);
      if (!codesByScope.has(key)) codesByScope.set(key, new Set());
      codesByScope.get(key).add(normalizeCode(row.numconta));
    }

    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      const codigo = normalizeCode(row.numconta);
      if (!codigo) continue;

      const key = scopeKey(row);
      const scopeCodes = codesByScope.get(key) || new Set();
      const codigoPai = parentCode(codigo);
      const hasChildren = rows.some((candidate) => (
        scopeKey(candidate) === key && parentCode(candidate.numconta) === codigo
      ));
      const tipconta = normalizeCode(row.tipconta);
      const payload = {
        codiempr: normalizeCode(row.codiempr) || null,
        codiloja: normalizeCode(row.codiloja) || null,
        codigo_erp: codigo,
        codigo_pai: codigoPai && scopeCodes.has(codigoPai) ? codigoPai : null,
        nivel: codeLevel(codigo),
        descricao: normalizeCode(row.desconta) || codigo,
        tipo: tipconta || null,
        analitica: tipconta === 'A' || !hasChildren,
        pagareci: normalizeCode(row.pagareci) || null,
        codibala: normalizeCode(row.codibala) || null,
        codi_dre: normalizeCode(row.codi_dre) || null,
        codifscf: normalizeCode(row.codifscf) || null,
        codiccus: normalizeCode(row.codiccus) || null,
        diasvenc: parseInt(row.diasvenc, 10) || 0,
        contproj: normalizeCode(row.contproj) || null,
        ativo: true,
        ultima_sync_at: new Date(),
      };

      let existing = await adminDb(TABLE)
        .where('codiempr', payload.codiempr)
        .where('codiloja', payload.codiloja)
        .where('codigo_erp', payload.codigo_erp)
        .first();

      if (!existing && (payload.codiempr || payload.codiloja)) {
        existing = await adminDb(TABLE)
          .where(function () {
            this.whereNull('codiempr').orWhere('codiempr', '');
          })
          .where(function () {
            this.whereNull('codiloja').orWhere('codiloja', '');
          })
          .where('codigo_erp', payload.codigo_erp)
          .first();
      }

      if (existing) {
        await adminDb(TABLE).where('id', existing.id).update(payload);
        updated++;
      } else {
        await adminDb(TABLE).insert(payload);
        inserted++;
      }
    }

    res.json({ total: rows.length, inserted, updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
