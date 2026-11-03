const express = require('express');
const router = express.Router();
const { adminDb } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { hasTable } = require('../services/schemaCompatService');

const TABLE = 'fornecedor_regras_juros';

router.get('/', async (req, res, next) => {
  try {
    const hasRegrasTable = await hasTable(TABLE);
    if (!hasRegrasTable) {
      return res.json({ data: [] });
    }

    const { ativo, search } = req.query;
    let q = adminDb(TABLE).select('*').orderBy('fornecedor', 'asc');
    if (ativo !== undefined) q = q.where('ativo', ativo === 'true' || ativo === '1');
    if (search) {
      q = q.where(function () {
        this.where('fornecedor', 'like', `%${search}%`)
          .orWhere('cnpj', 'like', `%${search}%`)
          .orWhere('codiforn', 'like', `%${search}%`);
      });
    }
    const data = await q;
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const hasRegrasTable = await hasTable(TABLE);
    if (!hasRegrasTable) {
      return res.status(503).json({
        error: 'Tabela de regras por fornecedor não encontrada. Rode as migrations do backend antes de cadastrar regras.',
      });
    }

    const {
      fornecedor, cnpj, codiforn,
      multa_percentual, juros_diario_percentual, carencia_dias,
      ativo = true, observacoes,
    } = req.body;

    if (!fornecedor) return res.status(400).json({ error: 'fornecedor é obrigatório' });

    const [id] = await adminDb(TABLE).insert({
      fornecedor,
      cnpj: cnpj || null,
      codiforn: codiforn || null,
      multa_percentual: parseFloat(multa_percentual ?? 2),
      juros_diario_percentual: parseFloat(juros_diario_percentual ?? 0.0333),
      carencia_dias: parseInt(carencia_dias ?? 0, 10),
      ativo: !!ativo,
      observacoes: observacoes || null,
    });
    const created = await adminDb(TABLE).where('id', id).first();
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', authMiddleware, async (req, res, next) => {
  try {
    const hasRegrasTable = await hasTable(TABLE);
    if (!hasRegrasTable) {
      return res.status(503).json({
        error: 'Tabela de regras por fornecedor não encontrada. Rode as migrations do backend antes de editar regras.',
      });
    }

    const allowed = ['fornecedor', 'cnpj', 'codiforn',
      'multa_percentual', 'juros_diario_percentual', 'carencia_dias',
      'ativo', 'observacoes'];
    const updates = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    if (updates.multa_percentual !== undefined) updates.multa_percentual = parseFloat(updates.multa_percentual);
    if (updates.juros_diario_percentual !== undefined) updates.juros_diario_percentual = parseFloat(updates.juros_diario_percentual);
    if (updates.carencia_dias !== undefined) updates.carencia_dias = parseInt(updates.carencia_dias, 10);

    await adminDb(TABLE).where('id', req.params.id).update(updates);
    const updated = await adminDb(TABLE).where('id', req.params.id).first();
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authMiddleware, async (req, res, next) => {
  try {
    const hasRegrasTable = await hasTable(TABLE);
    if (!hasRegrasTable) {
      return res.status(503).json({
        error: 'Tabela de regras por fornecedor não encontrada. Rode as migrations do backend antes de excluir regras.',
      });
    }

    await adminDb(TABLE).where('id', req.params.id).del();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
