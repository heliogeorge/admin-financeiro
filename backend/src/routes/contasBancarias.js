const express = require('express');
const router = express.Router();
const { adminDb } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { hasTable, getExistingColumns } = require('../services/schemaCompatService');
const { getSaldoContaMp, MP_BANCO_CODIGO } = require('../services/mpService');

const TABLE = 'contas_bancarias';
const BAIXAS = 'contas_pagar_baixas';
const EXTRATOS = 'extratos_bancarios';

router.get('/', async (req, res, next) => {
  try {
    const { ativo } = req.query;
    const hasContasBancarias = await hasTable(TABLE);
    if (!hasContasBancarias) {
      return res.json({ data: [] });
    }

    const q = adminDb(TABLE).select('*').orderBy('nome', 'asc');
    if (ativo !== undefined) q.where('ativo', ativo === 'true' || ativo === '1');
    const data = await q;

    const hasBaixas = await hasTable(BAIXAS);
    const baixaCols = hasBaixas
      ? await getExistingColumns(BAIXAS, [
        'conta_bancaria_id',
        'estornada',
        'valor_pago',
        'valor_juros',
        'valor_multa',
      ])
      : {};
    const podeCalcularSaidas = Boolean(
      baixaCols.conta_bancaria_id
      && (baixaCols.valor_pago || baixaCols.valor_juros || baixaCols.valor_multa)
    );

    const hasMpMovimentos = await hasTable('mp_movimentos');

    // Saldo estimado: saldo_inicial - soma das baixas que saem dessa conta.
    // Contas MercadoPago usam o relatório oficial (mp_movimentos), que cobre
    // todas as movimentações com valores líquidos.
    const withSaldo = await Promise.all(
      data.map(async (conta) => {
        if (hasMpMovimentos && conta.banco_codigo === MP_BANCO_CODIGO) {
          const mp = await getSaldoContaMp(conta);
          if (mp.movimentos > 0 || conta.data_saldo_inicial) {
            return {
              ...conta,
              total_saidas: null,
              saldo_estimado: mp.saldo,
              saldo_fonte: 'mercadopago',
            };
          }
        }

        // Contas com extrato OFX importado usam o saldo informado pelo banco
        // no fechamento do extrato (LEDGERBAL).
        if (conta.saldo_extrato !== null && conta.saldo_extrato !== undefined) {
          return {
            ...conta,
            total_saidas: null,
            saldo_estimado: parseFloat(conta.saldo_extrato),
            saldo_fonte: 'extrato',
          };
        }

        let saidas = 0;

        if (podeCalcularSaidas) {
          let query = adminDb(BAIXAS).where('conta_bancaria_id', conta.id);
          if (baixaCols.estornada) {
            query = query.where('estornada', false);
          }

          const selects = [];
          if (baixaCols.valor_pago) selects.push(adminDb.raw('COALESCE(SUM(valor_pago), 0) as total_pago'));
          if (baixaCols.valor_juros) selects.push(adminDb.raw('COALESCE(SUM(valor_juros), 0) as total_juros'));
          if (baixaCols.valor_multa) selects.push(adminDb.raw('COALESCE(SUM(valor_multa), 0) as total_multa'));

          const soma = await query.first(...selects);
          saidas = parseFloat(soma?.total_pago || 0)
            + parseFloat(soma?.total_juros || 0)
            + parseFloat(soma?.total_multa || 0);
        }

        return {
          ...conta,
          total_saidas: saidas,
          saldo_estimado: parseFloat(conta.saldo_inicial || 0) - saidas,
        };
      })
    );

    res.json({ data: withSaldo });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const conta = await adminDb(TABLE).where('id', req.params.id).first();
    if (!conta) return res.status(404).json({ error: 'Conta bancária não encontrada' });
    res.json(conta);
  } catch (err) {
    next(err);
  }
});

router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const {
      nome, banco_codigo, banco_nome, agencia, conta, tipo,
      codiloja, saldo_inicial, data_saldo_inicial, observacoes,
    } = req.body;

    if (!nome) return res.status(400).json({ error: 'Nome da conta é obrigatório' });

    const [id] = await adminDb(TABLE).insert({
      nome,
      banco_codigo: banco_codigo || null,
      banco_nome: banco_nome || null,
      agencia: agencia || null,
      conta: conta || null,
      tipo: tipo || 'corrente',
      codiloja: codiloja || null,
      saldo_inicial: parseFloat(saldo_inicial || 0),
      data_saldo_inicial: data_saldo_inicial || null,
      observacoes: observacoes || null,
      ativo: true,
    });
    const created = await adminDb(TABLE).where('id', id).first();
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', authMiddleware, async (req, res, next) => {
  try {
    const allowed = ['nome', 'banco_codigo', 'banco_nome', 'agencia', 'conta', 'tipo',
      'codiloja', 'saldo_inicial', 'data_saldo_inicial', 'observacoes', 'ativo'];
    const updates = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    if (updates.saldo_inicial !== undefined) updates.saldo_inicial = parseFloat(updates.saldo_inicial || 0);

    await adminDb(TABLE).where('id', req.params.id).update(updates);
    const updated = await adminDb(TABLE).where('id', req.params.id).first();
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authMiddleware, async (req, res, next) => {
  try {
    // Soft delete: só marca como inativo
    await adminDb(TABLE).where('id', req.params.id).update({ ativo: false });
    res.json({ ok: true, message: 'Conta inativada' });
  } catch (err) {
    next(err);
  }
});

/**
 * Extratos bancários — listar movimentações por conta
 */
router.get('/:id/extratos', async (req, res, next) => {
  try {
    const { status, dataInicio, dataFim } = req.query;
    let q = adminDb(EXTRATOS).where('conta_bancaria_id', req.params.id);
    if (status) q = q.where('status', status);
    if (dataInicio) q = q.where('data_transacao', '>=', dataInicio);
    if (dataFim) q = q.where('data_transacao', '<=', dataFim);
    const data = await q.orderBy('data_transacao', 'desc').orderBy('id', 'desc');
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
