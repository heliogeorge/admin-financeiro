const express = require('express');
const router = express.Router();
const { adminDb } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { syncFornecedores, listFornecedores, updateRegras } = require('../services/fornecedoresService');

/**
 * GET /api/fornecedores
 * Lista o cadastro (espelho do ERP + regras). Filtros: q, ativo, com_regra.
 */
router.get('/', async (req, res, next) => {
  try {
    const { q, ativo, com_regra, page, perPage } = req.query;
    const result = await listFornecedores({ q, ativo, com_regra, page, perPage });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/fornecedores/sync
 * Importa/atualiza o espelho do CADFOR (campos-base; regras preservadas).
 */
router.post('/sync', authMiddleware, async (req, res, next) => {
  try {
    const stats = await syncFornecedores({ username: req.user.username });
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/fornecedores/:id
 */
router.get('/:id', async (req, res, next) => {
  try {
    const fornecedor = await adminDb('fornecedores').where('id', req.params.id).first();
    if (!fornecedor) return res.status(404).json({ error: 'Fornecedor não encontrado' });
    res.json(fornecedor);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/fornecedores/:id
 * Edita SOMENTE os campos de regra do app (aliases, complemento_*, ativo).
 * Os campos-base são espelho do ERP e voltam no próximo sync.
 */
router.put('/:id', authMiddleware, async (req, res, next) => {
  try {
    const fornecedor = await updateRegras(req.params.id, req.body, req.user.username);
    if (!fornecedor) return res.status(404).json({ error: 'Fornecedor não encontrado' });
    res.json(fornecedor);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
