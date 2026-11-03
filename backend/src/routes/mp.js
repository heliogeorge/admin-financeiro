const express = require('express');
const router = express.Router();
const { adminDb } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const {
  getEmpresas, syncEmpresa, autoConciliarMp, syncRelatoriosEmpresa,
  gerarRelatorioBackfill, refreshRelatoriosDia, getSaldoContaMp, MP_BANCO_CODIGO,
} = require('../services/mpService');

const EXTRATOS = 'extratos_bancarios';
const BANCOS = 'contas_bancarias';

/**
 * GET /api/mp/contas
 * Empresas MP configuradas no .env + conta bancária vinculada + último sync.
 */
router.get('/contas', async (req, res, next) => {
  try {
    const empresas = getEmpresas();
    const data = [];

    for (const emp of empresas) {
      const conta = await adminDb(BANCOS)
        .where('banco_codigo', MP_BANCO_CODIGO)
        .where('observacoes', 'like', `%(${emp.slug})%`)
        .first();

      let ultimoSync = null;
      let pendentes = 0;
      if (conta) {
        const agg = await adminDb(EXTRATOS)
          .where('conta_bancaria_id', conta.id)
          .where('fit_id', 'like', 'mp-%')
          .first(
            adminDb.raw('MAX(importado_em) as ultimo'),
            adminDb.raw("SUM(CASE WHEN status = 'pendente' THEN 1 ELSE 0 END) as pendentes")
          );
        ultimoSync = agg ? agg.ultimo : null;
        pendentes = agg ? Number(agg.pendentes || 0) : 0;
      }

      let saldo = null;
      if (conta) {
        try {
          saldo = await getSaldoContaMp(conta);
        } catch (err) { /* tabela pode não existir ainda */ }
      }

      data.push({
        slug: emp.slug,
        label: emp.label,
        conta_bancaria_id: conta ? conta.id : null,
        conta_nome: conta ? conta.nome : null,
        ultimo_sync: ultimoSync,
        pendentes,
        saldo: saldo ? saldo.saldo : null,
        saldo_movimentos: saldo ? saldo.movimentos : 0,
        saldo_ultimo_movimento: saldo ? saldo.ultimo_movimento : null,
      });
    }

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/mp/sync
 * Sincroniza movimentações das empresas MP configuradas.
 * Body opcional: { dias: 60, empresa: 'vivenda' }
 */
router.post('/sync', authMiddleware, async (req, res, next) => {
  try {
    const dias = Math.min(Math.max(parseInt(req.body.dias, 10) || 60, 1), 365);
    const filtro = req.body.empresa || null;

    const empresas = getEmpresas().filter((e) => !filtro || e.slug === filtro);
    if (empresas.length === 0) {
      return res.status(400).json({ error: 'Nenhuma empresa MercadoPago configurada no servidor.' });
    }

    const resultados = [];
    const erros = [];
    for (const emp of empresas) {
      try {
        const r = await syncEmpresa(emp.slug, { dias, username: req.user.username });
        resultados.push(r);
      } catch (err) {
        erros.push({ slug: emp.slug, label: emp.label, error: err.message });
      }
      try {
        const rel = await syncRelatoriosEmpresa(emp.slug, { username: req.user.username });
        const alvo = resultados.find((r) => r.slug === emp.slug);
        if (alvo) alvo.relatorios = rel;
      } catch (err) {
        erros.push({ slug: emp.slug, label: `${emp.label} (relatórios)`, error: err.message });
      }
    }

    // Baixa automática dos boletos com match único no DDA
    let auto = null;
    try {
      auto = await autoConciliarMp({ username: req.user.username });
    } catch (err) {
      erros.push({ slug: 'auto-conciliar', label: 'Baixa automática', error: err.message });
    }

    // Extrato do dia sob demanda: pede relatório de hoje ao MP e importa
    // (desative com { atualizar_dia: false } para um sync rápido)
    let relatoriosDia = null;
    if (req.body.atualizar_dia !== false) {
      try {
        relatoriosDia = await refreshRelatoriosDia({ username: req.user.username });
      } catch (err) {
        erros.push({ slug: 'relatorio-dia', label: 'Relatório do dia', error: err.message });
      }
    }

    res.json({ resultados, erros, auto, relatorios_dia: relatoriosDia });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/mp/relatorios/backfill
 * Pede ao MP relatórios sob demanda do período (geração assíncrona — os
 * movimentos entram no próximo sync). Body: { dias: 60, empresa: 'vivenda' }
 */
router.post('/relatorios/backfill', authMiddleware, async (req, res, next) => {
  try {
    const dias = Math.min(Math.max(parseInt(req.body.dias, 10) || 60, 1), 365);
    const filtro = req.body.empresa || null;
    const empresas = getEmpresas().filter((e) => !filtro || e.slug === filtro);
    if (empresas.length === 0) {
      return res.status(400).json({ error: 'Nenhuma empresa MercadoPago configurada no servidor.' });
    }

    const resultados = [];
    const erros = [];
    for (const emp of empresas) {
      try {
        const r = await gerarRelatorioBackfill(emp.slug, dias);
        resultados.push({ slug: emp.slug, label: emp.label, report_id: r.id, status: r.status });
      } catch (err) {
        erros.push({ slug: emp.slug, label: emp.label, error: err.message });
      }
    }
    res.json({ resultados, erros });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/mp/auto-conciliar
 * Roda só a baixa automática sobre os extratos MP pendentes.
 */
router.post('/auto-conciliar', authMiddleware, async (req, res, next) => {
  try {
    const auto = await autoConciliarMp({ username: req.user.username });
    res.json(auto);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
