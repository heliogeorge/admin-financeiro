const express = require('express');
const router = express.Router();
const PagameModel = require('../models/pagame');

/**
 * GET /api/pagame
 * Listar contas a pagar do ERP
 */
router.get('/', async (req, res, next) => {
  try {
    const {
      codiloja, dataInicio, dataFim, status,
      fornecedor, page = 1, perPage = 50,
      orderBy = 'datavenc', orderDir = 'DESC',
    } = req.query;

    const result = await PagameModel.list({
      codiloja,
      dataInicio,
      dataFim,
      status,
      fornecedor,
      page: parseInt(page),
      perPage: parseInt(perPage),
      orderBy,
      orderDir,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/pagame/resumo
 * Resumo de contas a pagar (totais pendente, vencido, pago)
 */
router.get('/resumo', async (req, res, next) => {
  try {
    const { codiloja, dataInicio, dataFim } = req.query;
    const resumo = await PagameModel.resumo({ codiloja, dataInicio, dataFim });
    res.json(resumo);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/pagame/fluxo
 * Fluxo de caixa diário (contas a vencer)
 */
router.get('/fluxo', async (req, res, next) => {
  try {
    const { codiloja, dataInicio, dataFim } = req.query;

    if (!dataInicio || !dataFim) {
      return res.status(400).json({ error: 'dataInicio e dataFim são obrigatórios' });
    }

    const fluxo = await PagameModel.fluxoPorDia({ codiloja, dataInicio, dataFim });
    res.json(fluxo);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/pagame/top-fornecedores
 * Top fornecedores por valor
 */
router.get('/top-fornecedores', async (req, res, next) => {
  try {
    const { codiloja, dataInicio, dataFim, limit = 10 } = req.query;
    const result = await PagameModel.topFornecedores({
      codiloja, dataInicio, dataFim, limit: parseInt(limit),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/pagame/:lancamen
 * Detalhe de um lançamento
 */
router.get('/:lancamen', async (req, res, next) => {
  try {
    const { lancamen } = req.params;
    const { codiempr } = req.query;
    const record = await PagameModel.findByLancamento(lancamen, codiempr);

    if (!record) {
      return res.status(404).json({ error: 'Lançamento não encontrado' });
    }

    res.json(record);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
