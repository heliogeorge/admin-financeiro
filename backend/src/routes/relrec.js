const express = require('express');
const router = express.Router();
const RelrecModel = require('../models/relrec');

/**
 * GET /api/relrec
 * Listar entradas de mercadoria
 */
router.get('/', async (req, res, next) => {
  try {
    const {
      codiloja, dataInicio, dataFim, fornecedor,
      numeroNf, chaveNfe, page = 1, perPage = 50,
      orderBy = 'dataemis', orderDir = 'DESC',
    } = req.query;

    const result = await RelrecModel.list({
      codiloja, dataInicio, dataFim, fornecedor,
      numeroNf, chaveNfe,
      page: parseInt(page), perPage: parseInt(perPage),
      orderBy, orderDir,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/relrec/resumo
 * Resumo de entradas
 */
router.get('/resumo', async (req, res, next) => {
  try {
    const { codiloja, dataInicio, dataFim } = req.query;
    const resumo = await RelrecModel.resumo({ codiloja, dataInicio, dataFim });
    res.json(resumo);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/relrec/sem-vinculo
 * Entradas sem vínculo com pagamento
 */
router.get('/sem-vinculo', async (req, res, next) => {
  try {
    const { codiloja, dataInicio, dataFim, page = 1, perPage = 50 } = req.query;
    const result = await RelrecModel.entradasSemVinculo({
      codiloja, dataInicio, dataFim,
      page: parseInt(page), perPage: parseInt(perPage),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/relrec/fornecedor/:codiforn
 * Entradas de um fornecedor específico
 */
router.get('/fornecedor/:codiforn', async (req, res, next) => {
  try {
    const { codiforn } = req.params;
    const { dataInicio, dataFim } = req.query;
    const result = await RelrecModel.listByFornecedor(codiforn, { dataInicio, dataFim });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/relrec/nfe/:chave
 * Buscar por chave NFe
 */
router.get('/nfe/:chave', async (req, res, next) => {
  try {
    const record = await RelrecModel.findByChaveNfe(req.params.chave);
    if (!record) {
      return res.status(404).json({ error: 'Entrada não encontrada para esta chave NFe' });
    }
    res.json(record);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/relrec/:numerorr
 * Detalhe de uma entrada
 */
router.get('/:numerorr', async (req, res, next) => {
  try {
    const { codiempr } = req.query;
    const record = await RelrecModel.findByNumero(req.params.numerorr, codiempr);
    if (!record) {
      return res.status(404).json({ error: 'Entrada não encontrada' });
    }
    res.json(record);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
