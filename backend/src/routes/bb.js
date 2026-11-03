const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { isConfigured, getConfig, hasClientCert, syncExtratoBb } = require('../services/bbService');

/**
 * GET /api/bb/status
 * Indica se a integração BB está configurada e em qual ambiente.
 */
router.get('/status', (req, res) => {
  const cfg = getConfig();
  res.json({
    configurado: Boolean(cfg),
    ambiente: cfg ? cfg.ambiente : null,
    agencia: cfg ? cfg.agencia || null : null,
    conta: cfg ? cfg.conta || null : null,
    certificado_mtls: cfg ? hasClientCert(cfg) : false,
  });
});

/**
 * POST /api/bb/sync
 * Sincroniza o extrato do BB para extratos_bancarios.
 * Body opcional: { dias: 30 }
 */
router.post('/sync', authMiddleware, async (req, res, next) => {
  try {
    if (!isConfigured()) {
      return res.status(400).json({ error: 'Credenciais do Banco do Brasil não configuradas no servidor.' });
    }
    const dias = Math.min(Math.max(parseInt(req.body.dias, 10) || 30, 1), 365);
    const resultado = await syncExtratoBb({ dias, username: req.user.username });
    res.json(resultado);
  } catch (err) {
    if (err.status === 403) {
      return res.status(502).json({
        error: 'Banco do Brasil recusou o acesso (403). Verifique no portal BB Developers se a '
          + 'aplicação tem a API Extratos liberada para este ambiente e se as credenciais são do ambiente certo.',
      });
    }
    next(err);
  }
});

module.exports = router;
