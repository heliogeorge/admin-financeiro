const express = require('express');
const router = express.Router();
const { adminDb } = require('../config/database');

const CONTAS = 'contas_pagar';
const ENTRADAS = 'entradas_mercadoria';

function applyContaFilters(query, { codiloja, dataInicio, dataFim }) {
  if (codiloja) query = query.where('codiloja', codiloja);
  if (dataInicio) query = query.where('data_vencimento', '>=', dataInicio);
  if (dataFim) query = query.where('data_vencimento', '<=', dataFim);
  return query;
}

function applyEntradaFilters(query, { codiloja, dataInicio, dataFim }) {
  if (codiloja) query = query.where('codiloja', codiloja);
  if (dataInicio) query = query.where('data_emissao', '>=', dataInicio);
  if (dataFim) query = query.where('data_emissao', '<=', dataFim);
  return query;
}

async function resumoContas(filters) {
  async function byStatus(status, valueExpression) {
    const row = await applyContaFilters(adminDb(CONTAS), filters)
      .where('status', status)
      .select(adminDb.raw(`COALESCE(SUM(${valueExpression}), 0) as total`))
      .count('* as qtd')
      .first();

    return { total: row.total || 0, qtd: row.qtd || 0 };
  }

  return {
    pendente: await byStatus('pendente', 'COALESCE(saldo_aberto, valor)'),
    vencido: await byStatus('vencido', 'COALESCE(saldo_aberto, valor)'),
    pago: await byStatus('pago', 'COALESCE(valor_pago, valor)'),
  };
}

async function resumoEntradas(filters) {
  const row = await applyEntradaFilters(adminDb(ENTRADAS), filters)
    .select(
      adminDb.raw('COALESCE(SUM(total_produtos), 0) as totalProdutos'),
      adminDb.raw('COALESCE(SUM(total_faturado), 0) as totalFaturado'),
      adminDb.raw('COALESCE(SUM(valor_icms), 0) as totalIcms'),
      adminDb.raw('COALESCE(SUM(valor_ipi), 0) as totalIpi'),
      adminDb.raw('COALESCE(SUM(valor_frete), 0) as totalFrete'),
      adminDb.raw('COALESCE(SUM(valor_desconto), 0) as totalDesconto')
    )
    .count('* as qtdEntradas')
    .first();

  return row;
}

async function topFornecedores(filters, limit = 5) {
  let query = applyContaFilters(adminDb(CONTAS), filters)
    .select('erp_fornecedor_id as fornclie', 'fornecedor as nomeforn')
    .where('status', '!=', 'cancelado')
    .sum('valor as total')
    .count('* as qtd')
    .groupBy('erp_fornecedor_id', 'fornecedor')
    .orderBy('total', 'DESC')
    .limit(limit);

  return query;
}

/**
 * GET /api/dashboard/overview
 * Visão geral: resumo de contas a pagar + entradas
 */
router.get('/overview', async (req, res, next) => {
  try {
    const { codiloja, dataInicio, dataFim } = req.query;
    const filters = { codiloja, dataInicio, dataFim };

    const [contasPagar, entradas, fornecedores] = await Promise.all([
      resumoContas(filters),
      resumoEntradas(filters),
      topFornecedores(filters, 5),
    ]);

    res.json({
      contasPagar,
      entradas,
      topFornecedores: fornecedores,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/dashboard/fluxo-caixa
 * Fluxo de caixa projetado (saídas por dia)
 */
router.get('/fluxo-caixa', async (req, res, next) => {
  try {
    const { codiloja, dataInicio, dataFim } = req.query;

    if (!dataInicio || !dataFim) {
      return res.status(400).json({ error: 'dataInicio e dataFim obrigatórios' });
    }

    let query = adminDb(CONTAS)
      .select('data_vencimento as datavenc')
      .select(adminDb.raw('COALESCE(SUM(COALESCE(saldo_aberto, valor)), 0) as total'))
      .count('* as qtd')
      .whereNotIn('status', ['pago', 'cancelado'])
      .whereBetween('data_vencimento', [dataInicio, dataFim])
      .groupBy('data_vencimento')
      .orderBy('data_vencimento', 'ASC');

    if (codiloja) query = query.where('codiloja', codiloja);

    const fluxo = await query;
    res.json(fluxo);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
