const express = require('express');
const router = express.Router();
const { adminDb } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const fs = require('fs');

const INBOX = 'comprovantes_inbox';
const CONTAS = 'contas_pagar';

/**
 * GET /api/inbox/comprovantes
 * Lista comprovantes não vinculados
 */
router.get('/comprovantes', authMiddleware, async (req, res, next) => {
  try {
    const itens = await adminDb(INBOX)
      .select(
        `${INBOX}.*`,
        `${CONTAS}.fornecedor as conta_fornecedor`,
        `${CONTAS}.valor as conta_valor`,
        `${CONTAS}.data_vencimento as conta_vencimento`
      )
      .leftJoin(CONTAS, `${INBOX}.conta_pagar_id`, `${CONTAS}.id`)
      .orderBy(`${INBOX}.criado_em`, 'desc')
      .limit(100);

    res.json({ data: itens });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/inbox/comprovantes/:id/vincular
 * Vincula um comprovante do inbox a uma conta a pagar
 */
router.post('/comprovantes/:id/vincular', authMiddleware, async (req, res, next) => {
  try {
    const { conta_pagar_id } = req.body;
    if (!conta_pagar_id) return res.status(400).json({ error: 'conta_pagar_id é obrigatório' });

    const inbox = await adminDb(INBOX).where('id', req.params.id).first();
    if (!inbox) return res.status(404).json({ error: 'Comprovante não encontrado' });

    const conta = await adminDb(CONTAS).where('id', conta_pagar_id).first();
    if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });

    // Vincula na conta
    await adminDb(CONTAS).where('id', conta_pagar_id).update({
      comprovante_path: inbox.arquivo_path,
      atualizado_por: req.user.username,
    });

    // Marca inbox como vinculado
    await adminDb(INBOX).where('id', req.params.id).update({
      conta_pagar_id,
      vinculado: true,
      vinculado_em: new Date(),
    });

    res.json({ ok: true, mensagem: `Comprovante vinculado a: ${conta.fornecedor}` });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/inbox/comprovantes/:id
 * Remove um comprovante do inbox (e o arquivo)
 */
router.delete('/comprovantes/:id', authMiddleware, async (req, res, next) => {
  try {
    const inbox = await adminDb(INBOX).where('id', req.params.id).first();
    if (!inbox) return res.status(404).json({ error: 'Comprovante não encontrado' });

    // Remove arquivo do disco se existir
    if (inbox.arquivo_path && fs.existsSync(inbox.arquivo_path)) {
      fs.unlinkSync(inbox.arquivo_path);
    }

    await adminDb(INBOX).where('id', req.params.id).delete();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
