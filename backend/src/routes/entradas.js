const express = require('express');
const router = express.Router();
const { adminDb } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { recalcContaDependencies, recalcEntrada, toNumber, TOLERANCIA } = require('../services/reconciliationService');
const { criarComplementoManual, gerarComplementosPendentes } = require('../services/complementosService');

const ENTRADAS = 'entradas_mercadoria';
const ENTRADAS_CONTAS = 'entradas_contas';
const CONTAS = 'contas_pagar';
const CHEQUES_CONTAS = 'cheques_contas';
const CHEQUES = 'cheques';
const ITENS = 'contas_pagar_itens';

async function getContaRemainingValue(contaId) {
  const conta = await adminDb(CONTAS).where('id', contaId).first();
  if (!conta) return null;

  const totalItens = await adminDb(ITENS)
    .where('conta_pagar_id', contaId)
    .sum('valor_item as total')
    .first();

  const remaining = Math.max(0, toNumber(conta.valor) - toNumber(totalItens.total));
  return { conta, remaining };
}

/**
 * GET /api/entradas
 */
router.get('/', async (req, res, next) => {
  try {
    const {
      codiloja, fornecedor, numeronf, status_pagamento,
      dataInicio, dataFim,
      page = 1, perPage = 30,
      orderBy = 'data_emissao', orderDir = 'DESC',
    } = req.query;

    function applyFilters(q) {
      if (codiloja) q = q.where(`${ENTRADAS}.codiloja`, codiloja);
      if (status_pagamento) q = q.where(`${ENTRADAS}.status_pagamento`, status_pagamento);
      if (fornecedor) q = q.where(function () {
        this.where(`${ENTRADAS}.fornecedor`, 'like', `%${fornecedor}%`)
          .orWhere(`${ENTRADAS}.codiforn`, 'like', `%${fornecedor}%`);
      });
      if (numeronf) q = q.where(`${ENTRADAS}.numeronf`, 'like', `%${numeronf}%`);
      if (dataInicio) q = q.where(`${ENTRADAS}.data_emissao`, '>=', dataInicio);
      if (dataFim) q = q.where(`${ENTRADAS}.data_emissao`, '<=', dataFim);
      return q;
    }

    const countResult = await applyFilters(adminDb(ENTRADAS)).count('* as total').first();
    const total = countResult.total;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(perPage, 10) || 30));
    const offset = (pageNum - 1) * pageSize;
    const allowedOrderBy = new Set([
      'data_emissao', 'data_entrada', 'fornecedor', 'codiloja',
      'numeronf', 'numerorr', 'total_faturado', 'total_produtos',
      'status_pagamento',
    ]);
    const safeOrderBy = allowedOrderBy.has(orderBy) ? orderBy : 'data_emissao';
    const safeOrderDir = String(orderDir).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const data = await applyFilters(adminDb(ENTRADAS).select('*'))
      .orderBy(`${ENTRADAS}.${safeOrderBy}`, safeOrderDir)
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
 * GET /api/entradas/resumo
 */
router.get('/resumo', async (req, res, next) => {
  try {
    const { codiloja, dataInicio, dataFim } = req.query;

    function applyBase(q) {
      if (codiloja) q = q.where('codiloja', codiloja);
      if (dataInicio) q = q.where('data_emissao', '>=', dataInicio);
      if (dataFim) q = q.where('data_emissao', '<=', dataFim);
      return q;
    }

    const emAberto = await applyBase(adminDb(ENTRADAS))
      .where('status_pagamento', 'em_aberto')
      .sum('total_faturado as total').count('* as qtd').first();

    const parcial = await applyBase(adminDb(ENTRADAS))
      .where('status_pagamento', 'parcial')
      .sum('total_faturado as total').count('* as qtd').first();

    const pago = await applyBase(adminDb(ENTRADAS))
      .where('status_pagamento', 'pago')
      .sum('total_faturado as total').count('* as qtd').first();

    const totalGeral = await applyBase(adminDb(ENTRADAS))
      .sum('total_faturado as total').count('* as qtd').first();

    res.json({
      emAberto: { total: emAberto.total || 0, qtd: emAberto.qtd || 0 },
      parcial: { total: parcial.total || 0, qtd: parcial.qtd || 0 },
      pago: { total: pago.total || 0, qtd: pago.qtd || 0 },
      totalGeral: { total: totalGeral.total || 0, qtd: totalGeral.qtd || 0 },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/entradas/:id
 * Detalhe da entrada com resumo de pagamentos
 */
/**
 * POST /api/entradas/gerar-complementos
 * Varre as regras de "por fora" (fator) e gera o que estiver pendente.
 */
router.post('/gerar-complementos', authMiddleware, async (req, res, next) => {
  try {
    const stats = await gerarComplementosPendentes({ username: req.user.username });
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/entradas/:id/complemento
 * Cria um complemento "por fora" manual (regra valor_informado ou exceção).
 * Body: { valor, data_vencimento, observacoes }
 */
router.post('/:id/complemento', authMiddleware, async (req, res, next) => {
  try {
    const conta = await criarComplementoManual(req.params.id, {
      valor: req.body?.valor,
      data_vencimento: req.body?.data_vencimento,
      observacoes: req.body?.observacoes || null,
      username: req.user.username,
    });
    res.status(201).json(conta);
  } catch (err) {
    if (err.status === 400 || err.status === 404) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const entrada = await adminDb(ENTRADAS).where('id', req.params.id).first();
    if (!entrada) return res.status(404).json({ error: 'Entrada não encontrada' });

    const itens = await adminDb(ITENS)
      .select(
        `${ITENS}.id as item_id`,
        `${ITENS}.valor_item`,
        `${ITENS}.tipo_origem`,
        `${ITENS}.descricao_item`,
        `${ITENS}.documento_referencia`,
        `${CONTAS}.id`,
        `${CONTAS}.documento`,
        `${CONTAS}.historico`,
        `${CONTAS}.valor`,
        `${CONTAS}.data_vencimento`,
        `${CONTAS}.data_pagamento`,
        `${CONTAS}.status`,
        `${CONTAS}.forma_pagamento`,
        `${CONTAS}.erp_lancamento`,
        `${CONTAS}.status_conciliacao`,
        `${CONTAS}.tipo_titulo`,
      )
      .leftJoin(CONTAS, `${ITENS}.conta_pagar_id`, `${CONTAS}.id`)
      .where(`${ITENS}.entrada_id`, req.params.id)
      .orderBy(`${CONTAS}.data_vencimento`, 'asc');

    // Para cada conta paga com cheque, buscar cheques
    const contasComCheques = [];
    for (const conta of itens) {
      let cheques = [];
      if (conta.forma_pagamento === 'cheque') {
        cheques = await adminDb(CHEQUES_CONTAS)
          .select(
            `${CHEQUES}.numero_cheque`, `${CHEQUES}.valor`, `${CHEQUES}.banco`,
            `${CHEQUES}.data_bom_para`, `${CHEQUES}.status as status_cheque`,
          )
          .leftJoin(CHEQUES, `${CHEQUES_CONTAS}.cheque_id`, `${CHEQUES}.id`)
          .where(`${CHEQUES_CONTAS}.conta_pagar_id`, conta.id);
      }
      contasComCheques.push({ ...conta, cheques });
    }

    const itensValidos = itens.filter((item) => item.status !== 'cancelado');
    const totalComplemento = itensValidos
      .filter((item) => item.tipo_titulo === 'complemento')
      .reduce((sum, item) => sum + toNumber(item.valor_item), 0);
    const totalEsperado = toNumber(entrada.total_faturado) + totalComplemento;
    const totalTitulado = itens.reduce((sum, item) => sum + toNumber(item.valor_item), 0);
    const totalPago = itens
      .filter((item) => item.status === 'pago')
      .reduce((sum, item) => sum + toNumber(item.valor_item), 0);
    const totalPendente = itens
      .filter((item) => item.status !== 'pago' && item.status !== 'cancelado')
      .reduce((sum, item) => sum + toNumber(item.valor_item), 0);
    const saldoSemTitulo = totalEsperado - totalTitulado;
    const saldoAberto = totalEsperado - totalPago;

    // regra de "por fora" do fornecedor (p/ pendência e botão na tela)
    const fornecedorRegra = entrada.codiforn
      ? await adminDb('fornecedores')
        .where('codiforn', String(entrada.codiforn))
        .first('id', 'complemento_tipo', 'complemento_fator', 'complemento_base', 'complemento_vencimento', 'complemento_dias', 'complemento_desde')
      : null;

    res.json({
      ...entrada,
      pagamentos: contasComCheques,
      fornecedor_regra: fornecedorRegra || null,
      resumo_pagamento: {
        total_entrada: toNumber(entrada.total_faturado),
        total_complemento: toNumber(totalComplemento),
        total_esperado: toNumber(totalEsperado),
        total_titulado: totalTitulado,
        total_pago: totalPago,
        total_pendente: totalPendente,
        saldo_sem_titulo: saldoSemTitulo,
        saldo_aberto: saldoAberto,
        qtd_parcelas: itens.length,
        qtd_pagas: itens.filter((item) => item.status === 'pago').length,
        status_titulacao: entrada.status_titulacao,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/entradas/:id
 * Atualizar valores da entrada (editável)
 */
router.put('/:id', authMiddleware, async (req, res, next) => {
  try {
    const {
      total_produtos, total_faturado, valor_icms, valor_ipi,
      valor_frete, valor_seguro, valor_desconto, observacoes,
    } = req.body;

    const updates = {};
    if (total_produtos !== undefined) updates.total_produtos = parseFloat(total_produtos);
    if (total_faturado !== undefined) updates.total_faturado = parseFloat(total_faturado);
    if (valor_icms !== undefined) updates.valor_icms = parseFloat(valor_icms);
    if (valor_ipi !== undefined) updates.valor_ipi = parseFloat(valor_ipi);
    if (valor_frete !== undefined) updates.valor_frete = parseFloat(valor_frete);
    if (valor_seguro !== undefined) updates.valor_seguro = parseFloat(valor_seguro);
    if (valor_desconto !== undefined) updates.valor_desconto = parseFloat(valor_desconto);
    if (observacoes !== undefined) updates.observacoes = observacoes;
    updates.atualizado_por = req.user.username;

    await adminDb(ENTRADAS).where('id', req.params.id).update(updates);
    await recalcEntrada(req.params.id);
    const entrada = await adminDb(ENTRADAS).where('id', req.params.id).first();
    res.json(entrada);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/entradas/:id/vincular-contas
 * Vincular contas a pagar a uma entrada
 */
router.post('/:id/vincular-contas', authMiddleware, async (req, res, next) => {
  try {
    const { contas_ids = [], alocacoes = [] } = req.body;
    if (contas_ids.length === 0) return res.status(400).json({ error: 'Informe ao menos uma conta' });

    const entrada = await adminDb(ENTRADAS).where('id', req.params.id).first();
    if (!entrada) return res.status(404).json({ error: 'Entrada não encontrada' });

    const entradaAtual = await recalcEntrada(req.params.id);
    let saldoSemTitulo = entradaAtual?.saldoSemTitulo ?? Math.max(0, toNumber(entrada.total_faturado));
    let vinculadas = 0;
    let ignoradas = 0;

    for (const contaId of contas_ids) {
      const exists = await adminDb(ENTRADAS_CONTAS)
        .where('entrada_id', req.params.id)
        .where('conta_pagar_id', contaId)
        .first();
      if (!exists) {
        await adminDb(ENTRADAS_CONTAS).insert({
          entrada_id: parseInt(req.params.id),
          conta_pagar_id: contaId,
        });
      }

      const existingItem = await adminDb(ITENS)
        .where('entrada_id', req.params.id)
        .where('conta_pagar_id', contaId)
        .first();
      if (existingItem) {
        ignoradas++;
        continue;
      }

      const contaInfo = await getContaRemainingValue(contaId);
      if (!contaInfo || contaInfo.remaining <= TOLERANCIA) {
        ignoradas++;
        continue;
      }

      const alocacaoPayload = alocacoes.find((item) => String(item.conta_pagar_id || item.contaId) === String(contaId));
      const valorDesejado = alocacaoPayload ? toNumber(alocacaoPayload.valor_item || alocacaoPayload.valor) : null;
      const valorItem = valorDesejado && valorDesejado > 0
        ? Math.min(valorDesejado, contaInfo.remaining)
        : Math.min(contaInfo.remaining, saldoSemTitulo > TOLERANCIA ? saldoSemTitulo : contaInfo.remaining);

      if (valorItem <= TOLERANCIA) {
        ignoradas++;
        continue;
      }

      await adminDb(ITENS).insert({
        conta_pagar_id: contaId,
        tipo_origem: 'entrada_mercadoria',
        entrada_id: parseInt(req.params.id, 10),
        descricao_item: `Alocação da entrada ${entrada.numeronf || entrada.numerorr}`,
        documento_referencia: entrada.numeronf || entrada.numerorr || null,
        valor_item: valorItem,
        origem_match: 'manual',
        observacoes: 'Vínculo criado pela tela de entradas.',
        criado_por: req.user.username,
        atualizado_por: req.user.username,
      });

      saldoSemTitulo = Math.max(0, saldoSemTitulo - valorItem);
      vinculadas++;
      await recalcContaDependencies(contaId);
    }

    await recalcEntrada(req.params.id);

    res.json({ message: `${vinculadas} contas alocadas`, vinculadas, ignoradas });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/entradas/:id/desvincular-conta/:contaId
 */
router.delete('/:id/desvincular-conta/:contaId', authMiddleware, async (req, res, next) => {
  try {
    await adminDb(ENTRADAS_CONTAS)
      .where('entrada_id', req.params.id)
      .where('conta_pagar_id', req.params.contaId)
      .del();

    await adminDb(ITENS)
      .where('entrada_id', req.params.id)
      .where('conta_pagar_id', req.params.contaId)
      .del();

    await recalcContaDependencies(req.params.contaId);
    await recalcEntrada(req.params.id);
    res.json({ message: 'Conta desvinculada' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/entradas/:id/auto-vincular
 * Tenta vincular automaticamente contas do mesmo fornecedor
 */
router.post('/:id/auto-vincular', authMiddleware, async (req, res, next) => {
  try {
    const entrada = await adminDb(ENTRADAS).where('id', req.params.id).first();
    if (!entrada) return res.status(404).json({ error: 'Entrada não encontrada' });

    const resumoEntrada = await recalcEntrada(req.params.id);
    let saldoSemTitulo = resumoEntrada?.saldoSemTitulo ?? Math.max(0, toNumber(entrada.total_faturado));
    if (saldoSemTitulo <= TOLERANCIA) {
      return res.json({ message: 'Entrada já está totalmente titulada', total: 0, vinculadas: 0 });
    }

    let query = adminDb(CONTAS)
      .where('status', '!=', 'cancelado')
      .where(function () {
        this.where('natureza', 'mercadoria')
          .orWhere('natureza', 'nao_classificada')
          .orWhereNull('natureza');
      });

    if (entrada.codiforn) {
      query = query.where(function () {
        this.where('erp_fornecedor_id', entrada.codiforn)
          .orWhere('fornecedor', 'like', `%${entrada.fornecedor}%`);
      });
    } else {
      query = query.where('fornecedor', 'like', `%${entrada.fornecedor}%`);
    }

    if (entrada.data_emissao) {
      const dataBase = new Date(entrada.data_emissao);
      const inicio = new Date(dataBase.getTime() - (45 * 86400000)).toISOString().slice(0, 10);
      const fim = new Date(dataBase.getTime() + (90 * 86400000)).toISOString().slice(0, 10);
      query = query.whereBetween('data_vencimento', [inicio, fim]);
    }

    const contas = await query.orderBy('data_vencimento', 'asc');
    let vinculadas = 0;

    for (const conta of contas) {
      const exists = await adminDb(ENTRADAS_CONTAS)
        .where('entrada_id', req.params.id)
        .where('conta_pagar_id', conta.id)
        .first();
      if (!exists) {
        await adminDb(ENTRADAS_CONTAS).insert({
          entrada_id: parseInt(req.params.id),
          conta_pagar_id: conta.id,
        });
      }

      const contaInfo = await getContaRemainingValue(conta.id);
      if (!contaInfo || contaInfo.remaining <= TOLERANCIA) continue;

      const valorItem = Math.min(contaInfo.remaining, saldoSemTitulo);
      if (valorItem <= TOLERANCIA) break;

      const existingItem = await adminDb(ITENS)
        .where('entrada_id', req.params.id)
        .where('conta_pagar_id', conta.id)
        .first();
      if (existingItem) continue;

      await adminDb(ITENS).insert({
        conta_pagar_id: conta.id,
        tipo_origem: 'entrada_mercadoria',
        entrada_id: parseInt(req.params.id, 10),
        descricao_item: `Sugestão automática para a entrada ${entrada.numeronf || entrada.numerorr}`,
        documento_referencia: entrada.numeronf || entrada.numerorr || null,
        valor_item: valorItem,
        origem_match: 'sugestao',
        score_match: 75,
        observacoes: 'Autoalocação por fornecedor, vencimento e saldo remanescente.',
        criado_por: req.user.username,
        atualizado_por: req.user.username,
      });

      saldoSemTitulo = Math.max(0, saldoSemTitulo - valorItem);
      vinculadas++;
      await recalcContaDependencies(conta.id);
      if (saldoSemTitulo <= TOLERANCIA) break;
    }

    await recalcEntrada(req.params.id);
    res.json({ message: `${vinculadas} contas alocadas automaticamente`, total: contas.length, vinculadas });
  } catch (err) {
    next(err);
  }
});

/**
 * Recalcula status_pagamento com base nas contas vinculadas
 */
async function recalcularStatusEntrada(entradaId) {
  return recalcEntrada(entradaId);
}

module.exports = router;
