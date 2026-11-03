const express = require('express');
const router = express.Router();
const { adminDb } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { recalcContaDependencies } = require('../services/reconciliationService');

const CHEQUES = 'cheques';
const CHEQUES_CONTAS = 'cheques_contas';
const CONTAS = 'contas_pagar';

/**
 * GET /api/cheques
 * Listar cheques com filtros
 */
router.get('/', async (req, res, next) => {
  try {
    const {
      status, fornecedor, codiloja,
      dataInicio, dataFim,
      page = 1, perPage = 50,
      orderBy = 'data_bom_para', orderDir = 'ASC',
    } = req.query;

    function applyFilters(q) {
      if (status) q = q.where(`${CHEQUES}.status`, status);
      if (codiloja) q = q.where(`${CHEQUES}.codiloja`, codiloja);
      if (fornecedor) q = q.where(`${CHEQUES}.fornecedor`, 'like', `%${fornecedor}%`);
      if (dataInicio) q = q.where(`${CHEQUES}.data_bom_para`, '>=', dataInicio);
      if (dataFim) q = q.where(`${CHEQUES}.data_bom_para`, '<=', dataFim);
      return q;
    }

    const countResult = await applyFilters(adminDb(CHEQUES)).count('* as total').first();
    const total = countResult.total;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(perPage, 10) || 50));
    const offset = (pageNum - 1) * pageSize;
    const allowedOrderBy = new Set([
      'data_bom_para', 'data_emissao', 'fornecedor', 'valor',
      'numero_cheque', 'banco', 'status', 'codiloja', 'created_at', 'updated_at',
    ]);
    const safeOrderBy = allowedOrderBy.has(orderBy) ? orderBy : 'data_bom_para';
    const safeOrderDir = String(orderDir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    const data = await applyFilters(adminDb(CHEQUES).select('*'))
      .orderBy(`${CHEQUES}.${safeOrderBy}`, safeOrderDir)
      .limit(pageSize)
      .offset(offset);

    res.json({
      data,
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

/**
 * GET /api/cheques/resumo
 * Resumo por status
 */
router.get('/resumo', async (req, res, next) => {
  try {
    const emitido = await adminDb(CHEQUES).where('status', 'emitido')
      .sum('valor as total').count('* as qtd').first();
    const compensado = await adminDb(CHEQUES).where('status', 'compensado')
      .sum('valor as total').count('* as qtd').first();
    const devolvido = await adminDb(CHEQUES).where('status', 'devolvido')
      .sum('valor as total').count('* as qtd').first();

    // Cheques a vencer nos próximos 7 dias
    const hoje = new Date().toISOString().slice(0, 10);
    const em7dias = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const aVencer = await adminDb(CHEQUES)
      .where('status', 'emitido')
      .where('data_bom_para', '>=', hoje)
      .where('data_bom_para', '<=', em7dias)
      .sum('valor as total').count('* as qtd').first();

    res.json({
      emitido: { total: emitido.total || 0, qtd: emitido.qtd || 0 },
      compensado: { total: compensado.total || 0, qtd: compensado.qtd || 0 },
      devolvido: { total: devolvido.total || 0, qtd: devolvido.qtd || 0 },
      aVencer7dias: { total: aVencer.total || 0, qtd: aVencer.qtd || 0 },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/cheques/lote
 * Criar MÚLTIPLOS cheques vinculados a MÚLTIPLAS contas de uma vez
 */
router.post('/lote', authMiddleware, async (req, res, next) => {
  try {
    const {
      contas_ids = [],
      cheques = [],
      fornecedor,
      erp_fornecedor_id,
      codiloja,
      dar_baixa = true,
      observacoes,
    } = req.body;

    if (cheques.length === 0) {
      return res.status(400).json({ error: 'Informe ao menos um cheque' });
    }

    const chequeIds = [];

    for (const ch of cheques) {
      if (!ch.numero_cheque || !ch.valor || !ch.data_bom_para) {
        return res.status(400).json({ error: 'Cheque incompleto: número, valor e data bom-para são obrigatórios' });
      }

      const [chequeId] = await adminDb(CHEQUES).insert({
        numero_cheque: ch.numero_cheque,
        banco: ch.banco || null,
        agencia: ch.agencia || null,
        conta: ch.conta || null,
        fornecedor: fornecedor || ch.fornecedor || '',
        erp_fornecedor_id: erp_fornecedor_id || null,
        valor: parseFloat(ch.valor),
        data_emissao: ch.data_emissao || new Date().toISOString().slice(0, 10),
        data_bom_para: ch.data_bom_para,
        status: 'emitido',
        codiloja: codiloja || null,
        observacoes: ch.observacoes || observacoes || null,
        criado_por: req.user.username,
      });

      chequeIds.push(chequeId);
    }

    if (contas_ids.length > 0) {
      const vinculos = [];
      for (const chequeId of chequeIds) {
        for (const contaId of contas_ids) {
          vinculos.push({ cheque_id: chequeId, conta_pagar_id: contaId });
        }
      }
      await adminDb(CHEQUES_CONTAS).insert(vinculos);

      if (dar_baixa) {
        await adminDb(CONTAS)
          .whereIn('id', contas_ids)
          .whereIn('status', ['pendente', 'vencido'])
          .update({
            status: 'pago',
            data_pagamento: new Date().toISOString().slice(0, 10),
            forma_pagamento: 'cheque',
            atualizado_por: req.user.username,
          });
      }

      for (const contaId of contas_ids) {
        await recalcContaDependencies(contaId);
      }
    }

    const created = await adminDb(CHEQUES).whereIn('id', chequeIds);

    res.status(201).json({
      message: `${chequeIds.length} cheques criados, ${contas_ids.length} contas vinculadas`,
      cheques: created,
      contasBaixadas: dar_baixa ? contas_ids.length : 0,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/cheques/:id
 * Detalhe do cheque com contas vinculadas
 */
router.get('/:id', async (req, res, next) => {
  try {
    const cheque = await adminDb(CHEQUES).where('id', req.params.id).first();
    if (!cheque) return res.status(404).json({ error: 'Cheque não encontrado' });

    // Buscar contas vinculadas
    const contas = await adminDb(CHEQUES_CONTAS)
      .select(
        `${CHEQUES_CONTAS}.*`,
        `${CONTAS}.fornecedor`,
        `${CONTAS}.documento`,
        `${CONTAS}.historico`,
        `${CONTAS}.valor as valor_conta`,
        `${CONTAS}.data_vencimento`,
        `${CONTAS}.status as status_conta`,
        `${CONTAS}.erp_lancamento`,
      )
      .leftJoin(CONTAS, `${CHEQUES_CONTAS}.conta_pagar_id`, `${CONTAS}.id`)
      .where(`${CHEQUES_CONTAS}.cheque_id`, req.params.id);

    res.json({ ...cheque, contas });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/cheques
 * Criar cheque e opcionalmente vincular a contas + dar baixa
 * 
 * Body:
 * {
 *   numero_cheque, banco, agencia, conta, fornecedor,
 *   erp_fornecedor_id, valor, data_emissao, data_bom_para,
 *   codiloja, observacoes,
 *   contas_ids: [1, 2, 3]  // opcional - IDs das contas a vincular
 *   dar_baixa: true         // opcional - dar baixa nas contas vinculadas
 * }
 */
router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const {
      numero_cheque, banco, agencia, conta, fornecedor,
      erp_fornecedor_id, valor, data_emissao, data_bom_para,
      codiloja, observacoes,
      contas_ids = [], dar_baixa = false,
    } = req.body;

    if (!numero_cheque || !fornecedor || !valor || !data_emissao || !data_bom_para) {
      return res.status(400).json({
        error: 'numero_cheque, fornecedor, valor, data_emissao e data_bom_para são obrigatórios',
      });
    }

    // Inserir cheque
    const [chequeId] = await adminDb(CHEQUES).insert({
      numero_cheque,
      banco: banco || null,
      agencia: agencia || null,
      conta: conta || null,
      fornecedor,
      erp_fornecedor_id: erp_fornecedor_id || null,
      valor: parseFloat(valor),
      data_emissao,
      data_bom_para,
      status: 'emitido',
      codiloja: codiloja || null,
      observacoes: observacoes || null,
      criado_por: req.user.username,
    });

    // Vincular contas se fornecidas
    if (contas_ids.length > 0) {
      const vinculos = contas_ids.map(contaId => ({
        cheque_id: chequeId,
        conta_pagar_id: contaId,
      }));
      await adminDb(CHEQUES_CONTAS).insert(vinculos);

      // Dar baixa nas contas se solicitado
      if (dar_baixa) {
        await adminDb(CONTAS)
          .whereIn('id', contas_ids)
          .whereIn('status', ['pendente', 'vencido'])
          .update({
            status: 'pago',
            data_pagamento: data_emissao,
            forma_pagamento: 'cheque',
            atualizado_por: req.user.username,
          });
      }

      for (const contaId of contas_ids) {
        await recalcContaDependencies(contaId);
      }
    }

    const cheque = await adminDb(CHEQUES).where('id', chequeId).first();
    res.status(201).json(cheque);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/cheques/:id
 */
router.put('/:id', authMiddleware, async (req, res, next) => {
  try {
    const {
      numero_cheque, banco, agencia, conta, fornecedor,
      erp_fornecedor_id, valor, data_emissao, data_bom_para,
      status, data_compensacao, codiloja, observacoes,
    } = req.body;

    const updates = {};
    if (numero_cheque !== undefined) updates.numero_cheque = numero_cheque;
    if (banco !== undefined) updates.banco = banco;
    if (agencia !== undefined) updates.agencia = agencia;
    if (conta !== undefined) updates.conta = conta;
    if (fornecedor !== undefined) updates.fornecedor = fornecedor;
    if (erp_fornecedor_id !== undefined) updates.erp_fornecedor_id = erp_fornecedor_id;
    if (valor !== undefined) updates.valor = parseFloat(valor);
    if (data_emissao !== undefined) updates.data_emissao = data_emissao;
    if (data_bom_para !== undefined) updates.data_bom_para = data_bom_para;
    if (status !== undefined) updates.status = status;
    if (data_compensacao !== undefined) updates.data_compensacao = data_compensacao;
    if (codiloja !== undefined) updates.codiloja = codiloja;
    if (observacoes !== undefined) updates.observacoes = observacoes;
    updates.atualizado_por = req.user.username;

    await adminDb(CHEQUES).where('id', req.params.id).update(updates);
    const cheque = await adminDb(CHEQUES).where('id', req.params.id).first();
    if (!cheque) return res.status(404).json({ error: 'Cheque não encontrado' });
    res.json(cheque);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/cheques/:id/compensar
 */
router.put('/:id/compensar', authMiddleware, async (req, res, next) => {
  try {
    const { data_compensacao } = req.body;
    await adminDb(CHEQUES).where('id', req.params.id).update({
      status: 'compensado',
      data_compensacao: data_compensacao || new Date().toISOString().slice(0, 10),
      atualizado_por: req.user.username,
    });
    const cheque = await adminDb(CHEQUES).where('id', req.params.id).first();
    res.json(cheque);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/cheques/:id/devolver
 */
router.put('/:id/devolver', authMiddleware, async (req, res, next) => {
  try {
    const { observacoes } = req.body;
    await adminDb(CHEQUES).where('id', req.params.id).update({
      status: 'devolvido',
      observacoes: observacoes || null,
      atualizado_por: req.user.username,
    });

    // Reverter baixa das contas vinculadas
    const vinculos = await adminDb(CHEQUES_CONTAS).where('cheque_id', req.params.id);
    if (vinculos.length > 0) {
      const contaIds = vinculos.map(v => v.conta_pagar_id);
      const hoje = new Date().toISOString().slice(0, 10);
      // Contas voltam para pendente/vencido
      for (const contaId of contaIds) {
        const conta = await adminDb(CONTAS).where('id', contaId).first();
        if (conta && conta.forma_pagamento === 'cheque') {
          const novoStatus = conta.data_vencimento < hoje ? 'vencido' : 'pendente';
          await adminDb(CONTAS).where('id', contaId).update({
            status: novoStatus,
            data_pagamento: null,
            forma_pagamento: null,
            atualizado_por: req.user.username,
          });
        }
      }

      for (const contaId of contaIds) {
        await recalcContaDependencies(contaId);
      }
    }

    const cheque = await adminDb(CHEQUES).where('id', req.params.id).first();
    res.json(cheque);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/cheques/:id/vincular
 * Vincular contas a um cheque existente
 */
router.post('/:id/vincular', authMiddleware, async (req, res, next) => {
  try {
    const { contas_ids = [], dar_baixa = false } = req.body;
    if (contas_ids.length === 0) return res.status(400).json({ error: 'Informe ao menos uma conta' });

    const cheque = await adminDb(CHEQUES).where('id', req.params.id).first();
    if (!cheque) return res.status(404).json({ error: 'Cheque não encontrado' });

    // Inserir vínculos (ignora duplicatas)
    for (const contaId of contas_ids) {
      const exists = await adminDb(CHEQUES_CONTAS)
        .where('cheque_id', req.params.id)
        .where('conta_pagar_id', contaId)
        .first();
      if (!exists) {
        await adminDb(CHEQUES_CONTAS).insert({
          cheque_id: parseInt(req.params.id),
          conta_pagar_id: contaId,
        });
      }
    }

    if (dar_baixa) {
      await adminDb(CONTAS)
        .whereIn('id', contas_ids)
        .whereIn('status', ['pendente', 'vencido'])
        .update({
          status: 'pago',
          data_pagamento: cheque.data_emissao,
          forma_pagamento: 'cheque',
          atualizado_por: req.user.username,
        });
    }

    for (const contaId of contas_ids) {
      await recalcContaDependencies(contaId);
    }

    res.json({ message: `${contas_ids.length} contas vinculadas` });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/cheques/:id
 * Cancelar cheque
 */
router.delete('/:id', authMiddleware, async (req, res, next) => {
  try {
    await adminDb(CHEQUES).where('id', req.params.id).update({
      status: 'cancelado',
      atualizado_por: req.user.username,
    });
    res.json({ message: 'Cheque cancelado' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
