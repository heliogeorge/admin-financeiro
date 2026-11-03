const express = require('express');
const router = express.Router();
const SyncService = require('../services/syncService');
const { authMiddleware } = require('../middleware/auth');

/**
 * POST /api/sync/pagame
 * Sincronizar lançamentos do ERP → banco admin
 */
router.post('/pagame', authMiddleware, async (req, res, next) => {
  try {
    const { codiloja, dataInicio, dataFim } = req.body;

    const result = await SyncService.syncPagame({
      codiloja: codiloja || null,
      dataInicio: dataInicio || null,
      dataFim: dataFim || null,
      username: req.user.username,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/sync/relrec
 * Sincronizar entradas do ERP
 */
router.post('/relrec', authMiddleware, async (req, res, next) => {
  try {
    const { codiloja, dataInicio, dataFim } = req.body;
    const result = await SyncService.syncRelrec({
      codiloja: codiloja || null,
      dataInicio: dataInicio || null,
      dataFim: dataFim || null,
      username: req.user.username,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/sync/status
 * Status da última sincronização
 */
router.get('/status', async (req, res, next) => {
  try {
    const status = await SyncService.getLastSync();
    res.json(status);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
