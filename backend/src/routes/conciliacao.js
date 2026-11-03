const express = require('express');
const router = express.Router();
const multer = require('multer');
const { adminDb } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { parseOfx } = require('../services/ofxService');
const { guessBankFromCode } = require('../services/ddaService');
const { recalcContaDependencies, toNumber } = require('../services/reconciliationService');
const { calcJurosMultaAuto } = require('../services/baixasService');

const CONTAS = 'contas_pagar';
const BAIXAS = 'contas_pagar_baixas';
const EXTRATOS = 'extratos_bancarios';
const BANCOS = 'contas_bancarias';

// OFX: vem pequeno, guarda em memória
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const toDateStr = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

// Normalização para comparar agência/conta do OFX com o cadastro: só dígitos,
// sem zeros à esquerda na comparação final. Cada lado pode vir com ou sem o
// dígito verificador, e o Itaú manda o ACCTID como agência+conta concatenadas
// (ex.: "8111094838" = ag 8111 + cc 094838), então o cadastro gera também
// essas variantes.
const rawDigitos = (v) => String(v || '').replace(/\D/g, '');
const normDigitos = (v) => rawDigitos(v).replace(/^0+/, '');
function addVariantes(set, raw) {
  if (!raw) return;
  const n = normDigitos(raw);
  if (n) set.add(n);
  if (rawDigitos(raw).length > 1) {
    const semDv = normDigitos(rawDigitos(raw).slice(0, -1));
    if (semDv) set.add(semDv);
  }
}
function contaOfxBateCadastro(acctidOfx, conta) {
  const ofx = new Set();
  addVariantes(ofx, acctidOfx);

  const cadastro = new Set();
  addVariantes(cadastro, conta.conta);
  if (conta.agencia && conta.conta) {
    addVariantes(cadastro, rawDigitos(conta.agencia) + rawDigitos(conta.conta));
  }

  for (const x of ofx) if (cadastro.has(x)) return true;
  return false;
}

/**
 * Compara os dados bancários do OFX com a conta selecionada. Retorna null
 * quando compatível (ou quando falta informação para comparar) e a mensagem
 * de erro quando é claramente outra conta.
 */
function validarContaOfx(contaOfx, conta) {
  if (!contaOfx) return null;
  const problemas = [];

  if (contaOfx.bankid && conta.banco_codigo
    && parseInt(normDigitos(contaOfx.bankid), 10) !== parseInt(normDigitos(conta.banco_codigo), 10)) {
    problemas.push('banco');
  }
  if (contaOfx.branchid && conta.agencia
    && normDigitos(contaOfx.branchid) !== normDigitos(conta.agencia)) {
    problemas.push('agência');
  }
  if (contaOfx.acctid && conta.conta && !contaOfxBateCadastro(contaOfx.acctid, conta)) {
    problemas.push('conta');
  }

  if (problemas.length === 0) return null;
  return `O arquivo OFX é do banco ${contaOfx.bankid || '?'}, agência ${contaOfx.branchid || '?'}, `
    + `conta ${contaOfx.acctid || '?'} — não bate (${problemas.join(', ')}) com a conta selecionada `
    + `"${conta.nome}" (banco ${conta.banco_codigo || '?'}, ag ${conta.agencia || '?'}, cc ${conta.conta || '?'}). `
    + 'Selecione a conta bancária correspondente ao arquivo.';
}

/**
 * POST /api/conciliacao/ofx/:contaBancariaId
 * Importa OFX como extratos pendentes de conciliação.
 */
router.post('/ofx/:contaBancariaId', authMiddleware, upload.single('arquivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Envie o arquivo OFX.' });

    const contaBancariaId = parseInt(req.params.contaBancariaId, 10);
    const conta = await adminDb(BANCOS).where('id', contaBancariaId).first();
    if (!conta) return res.status(404).json({ error: 'Conta bancária não encontrada' });

    const texto = req.file.buffer.toString('latin1'); // OFX costuma vir em ISO-8859-1
    const { conta: contaOfx, saldo, transactions } = parseOfx(texto);

    const erroConta = validarContaOfx(contaOfx, conta);
    if (erroConta) return res.status(400).json({ error: erroConta });

    let inserted = 0;
    let duplicated = 0;

    for (const tx of transactions) {
      if (!tx.data || !tx.valor) continue;

      const existe = await adminDb(EXTRATOS)
        .where('conta_bancaria_id', contaBancariaId)
        .where('fit_id', tx.fit_id || '')
        .first();
      if (existe) { duplicated++; continue; }

      await adminDb(EXTRATOS).insert({
        conta_bancaria_id: contaBancariaId,
        fit_id: tx.fit_id || null,
        data_transacao: tx.data,
        valor: tx.valor,
        tipo: tx.tipo,
        descricao: tx.descricao,
        documento: tx.documento,
        status: 'pendente',
        importado_por: req.user.username,
      });
      inserted++;
    }

    // Saldo de fechamento do extrato (LEDGERBAL): vira o saldo da conta na
    // listagem, se for mais recente que o último registrado.
    let saldoAtualizado = false;
    if (saldo && saldo.data
      && (!conta.data_saldo_extrato || toDateStr(conta.data_saldo_extrato) <= saldo.data)) {
      await adminDb(BANCOS).where('id', conta.id).update({
        saldo_extrato: saldo.valor,
        data_saldo_extrato: saldo.data,
      });
      saldoAtualizado = true;
    }

    res.status(201).json({
      message: `${inserted} lançamentos importados`,
      inserted,
      duplicated,
      total: transactions.length,
      saldo_extrato: saldoAtualizado ? saldo.valor : null,
      data_saldo_extrato: saldoAtualizado ? saldo.data : null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/conciliacao/extratos
 * Lista extratos com filtros (conta, status, data)
 */
router.get('/extratos', async (req, res, next) => {
  try {
    const { conta_bancaria_id, status, tipo, dataInicio, dataFim, search } = req.query;
    let q = adminDb(EXTRATOS).select('*');
    if (conta_bancaria_id) q = q.where('conta_bancaria_id', conta_bancaria_id);
    if (status) q = q.where('status', status);
    if (tipo) q = q.where('tipo', tipo);
    if (dataInicio) q = q.where('data_transacao', '>=', dataInicio);
    if (dataFim) q = q.where('data_transacao', '<=', dataFim);
    if (search) q = q.where('descricao', 'like', `%${search}%`);

    const data = await q.orderBy('data_transacao', 'desc').limit(500);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/conciliacao/extratos/:id/conciliar
 * Liga um extrato a uma conta a pagar criando uma baixa. O valor pago é o do
 * extrato; a diferença para o saldo da conta pode ser decomposta em
 * juros/multa (pagou a mais) ou desconto (pagou a menos) no body.
 */
router.post('/extratos/:id/conciliar', authMiddleware, async (req, res, next) => {
  try {
    const { conta_pagar_id } = req.body;
    if (!conta_pagar_id) return res.status(400).json({ error: 'Informe a conta a pagar.' });

    const valorJuros = Math.max(0, toNumber(req.body.valor_juros || 0));
    const valorMulta = Math.max(0, toNumber(req.body.valor_multa || 0));
    const valorDesconto = Math.max(0, toNumber(req.body.valor_desconto || 0));

    const extrato = await adminDb(EXTRATOS).where('id', req.params.id).first();
    if (!extrato) return res.status(404).json({ error: 'Extrato não encontrado' });
    if (extrato.status === 'conciliado') return res.status(400).json({ error: 'Extrato já conciliado' });
    if (extrato.tipo !== 'debito') return res.status(400).json({ error: 'Apenas débitos podem gerar baixas.' });

    const conta = await adminDb(CONTAS).where('id', conta_pagar_id).first();
    if (!conta) return res.status(404).json({ error: 'Conta a pagar não encontrada' });

    const valorPago = toNumber(extrato.valor);
    if (valorJuros + valorMulta > valorPago) {
      return res.status(400).json({ error: 'Juros + multa não podem exceder o valor pago.' });
    }

    const isMp = (extrato.fit_id || '').startsWith('mp-');
    const [baixaId] = await adminDb(BAIXAS).insert({
      conta_pagar_id: conta.id,
      data_pagamento: extrato.data_transacao,
      valor_pago: valorPago,
      valor_desconto: valorDesconto,
      valor_juros: valorJuros,
      valor_multa: valorMulta,
      forma_pagamento: isMp ? 'mercadopago' : 'ofx',
      conta_bancaria_id: extrato.conta_bancaria_id,
      banco_baixa: null,
      origem: isMp ? 'mercadopago' : 'ofx',
      referencia_externa: extrato.fit_id,
      observacoes: `Conciliado via ${isMp ? 'MercadoPago' : 'OFX'}: ${extrato.descricao || ''}`,
      criado_por: req.user.username,
      atualizado_por: req.user.username,
    });

    await adminDb(EXTRATOS).where('id', req.params.id).update({
      status: 'conciliado',
      baixa_id: baixaId,
    });

    await recalcContaDependencies(conta.id);
    res.json({ ok: true, baixa_id: baixaId });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/conciliacao/extratos/:id/criar-conta
 * Cria uma conta a pagar nova a partir do lançamento do extrato, já com a
 * baixa casada (conta nasce paga). Body: fornecedor (obrigatório), descricao,
 * categoria_id, natureza, plano_conta_id, codiloja, observacoes.
 */
router.post('/extratos/:id/criar-conta', authMiddleware, async (req, res, next) => {
  try {
    const {
      fornecedor, descricao, categoria_id, natureza, plano_conta_id,
      codiloja, observacoes,
    } = req.body;
    if (!fornecedor || !String(fornecedor).trim()) {
      return res.status(400).json({ error: 'Informe o fornecedor.' });
    }

    const extrato = await adminDb(EXTRATOS).where('id', req.params.id).first();
    if (!extrato) return res.status(404).json({ error: 'Extrato não encontrado' });
    if (extrato.status === 'conciliado') return res.status(400).json({ error: 'Extrato já conciliado' });
    if (extrato.tipo !== 'debito') return res.status(400).json({ error: 'Apenas débitos podem gerar contas a pagar.' });

    const valor = toNumber(extrato.valor);
    if (valor <= 0) return res.status(400).json({ error: 'Extrato sem valor válido.' });

    const isMp = (extrato.fit_id || '').startsWith('mp-');
    let contaId = null;
    let baixaId = null;

    await adminDb.transaction(async (trx) => {
      [contaId] = await trx(CONTAS).insert({
        fornecedor: String(fornecedor).trim().slice(0, 200),
        descricao: descricao || extrato.descricao || null,
        valor,
        saldo_aberto: valor,
        data_vencimento: extrato.data_transacao,
        status: 'pendente',
        origem: 'manual',
        forma_pagamento: isMp ? 'mercadopago' : null,
        categoria_id: categoria_id || null,
        natureza: natureza || 'despesa_geral',
        plano_conta_id: plano_conta_id || null,
        codiloja: codiloja || null,
        observacoes: observacoes
          || `Criada na conciliação a partir do extrato: ${extrato.descricao || ''}`,
        criado_por: req.user.username,
        atualizado_por: req.user.username,
      });

      [baixaId] = await trx(BAIXAS).insert({
        conta_pagar_id: contaId,
        data_pagamento: extrato.data_transacao,
        valor_pago: valor,
        valor_desconto: 0,
        valor_juros: 0,
        valor_multa: 0,
        forma_pagamento: isMp ? 'mercadopago' : 'ofx',
        conta_bancaria_id: extrato.conta_bancaria_id,
        banco_baixa: null,
        origem: isMp ? 'mercadopago' : 'ofx',
        referencia_externa: extrato.fit_id,
        observacoes: `Conta criada e baixada na conciliação: ${extrato.descricao || ''}`,
        criado_por: req.user.username,
        atualizado_por: req.user.username,
      });

      await trx(EXTRATOS).where('id', extrato.id).update({
        status: 'conciliado',
        baixa_id: baixaId,
      });
    });

    await recalcContaDependencies(contaId);
    const conta = await adminDb(CONTAS).where('id', contaId).first();
    res.status(201).json({ ok: true, conta, baixa_id: baixaId });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/conciliacao/extratos/:id/ignorar
 */
router.post('/extratos/:id/ignorar', authMiddleware, async (req, res, next) => {
  try {
    await adminDb(EXTRATOS).where('id', req.params.id).update({ status: 'ignorado' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/conciliacao/extrato-conta/:contaId?inicio=&fim=
 * Extrato da conta com saldo acumulado linha a linha. Fonte dos movimentos:
 * mp_movimentos para contas MercadoPago (cobertura completa, valores
 * líquidos), extratos_bancarios para as demais. O saldo é ancorado no melhor
 * ponto conhecido: saldo do extrato OFX (LEDGERBAL), ou saldo inicial da
 * conta — a resposta diz qual âncora foi usada.
 */
router.get('/extrato-conta/:contaId', async (req, res, next) => {
  try {
    const conta = await adminDb(BANCOS).where('id', req.params.contaId).first();
    if (!conta) return res.status(404).json({ error: 'Conta bancária não encontrada' });

    const hoje = new Date().toISOString().slice(0, 10);
    const fim = (req.query.fim || hoje).slice(0, 10);
    const inicioDefault = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const inicio = (req.query.inicio || inicioDefault).slice(0, 10);

    const isMp = conta.banco_codigo === '323';

    // Âncora de saldo: fim do dia da data da âncora
    let anchor;
    if (!isMp && conta.saldo_extrato !== null && conta.saldo_extrato !== undefined
      && conta.data_saldo_extrato) {
      anchor = {
        saldo: parseFloat(conta.saldo_extrato),
        data: toDateStr(conta.data_saldo_extrato),
        fonte: 'extrato_ofx',
      };
    } else if (conta.data_saldo_inicial) {
      anchor = {
        saldo: parseFloat(conta.saldo_inicial || 0),
        data: toDateStr(conta.data_saldo_inicial),
        fonte: 'saldo_inicial',
      };
    } else {
      // sem data: saldo_inicial vale antes de qualquer movimento conhecido
      anchor = { saldo: parseFloat(conta.saldo_inicial || 0), data: null, fonte: 'saldo_inicial' };
    }

    // Movimentos no período (asc) e soma líquida fora do período p/ âncora
    let rows;
    let netAte; // função que soma net no intervalo (a, b] por data
    if (isMp) {
      rows = await adminDb('mp_movimentos')
        .where('conta_bancaria_id', conta.id)
        .where('transaction_date', '>=', `${inicio} 00:00:00`)
        .where('transaction_date', '<=', `${fim} 23:59:59`)
        .orderBy('transaction_date', 'asc').orderBy('id', 'asc')
        .select('transaction_date as data', 'descricao', 'net_amount', 'transaction_type', 'source_id');
      rows = rows.map((r) => ({
        data: r.data,
        descricao: r.descricao || r.transaction_type,
        tipo: parseFloat(r.net_amount) >= 0 ? 'credito' : 'debito',
        valor: Math.abs(parseFloat(r.net_amount)),
        net: parseFloat(r.net_amount),
        status: null,
        documento: r.source_id,
      }));
      netAte = async (aExclusive, bInclusive) => {
        const q = adminDb('mp_movimentos').where('conta_bancaria_id', conta.id);
        if (aExclusive) q.where('transaction_date', '>', `${aExclusive} 23:59:59`);
        if (bInclusive) q.where('transaction_date', '<=', `${bInclusive} 23:59:59`);
        const agg = await q.first(adminDb.raw('COALESCE(SUM(net_amount),0) as total'));
        return parseFloat(agg.total || 0);
      };
    } else {
      rows = await adminDb(EXTRATOS)
        .where('conta_bancaria_id', conta.id)
        .where('data_transacao', '>=', inicio)
        .where('data_transacao', '<=', fim)
        .whereNot('status', 'ignorado')
        .orderBy('data_transacao', 'asc').orderBy('id', 'asc')
        .select('id', 'data_transacao as data', 'descricao', 'valor', 'tipo', 'status', 'documento');
      rows = rows.map((r) => ({
        extrato_id: r.id,
        data: r.data,
        descricao: r.descricao,
        tipo: r.tipo,
        valor: parseFloat(r.valor),
        net: r.tipo === 'credito' ? parseFloat(r.valor) : -parseFloat(r.valor),
        status: r.status,
        documento: r.documento,
      }));
      netAte = async (aExclusive, bInclusive) => {
        const q = adminDb(EXTRATOS).where('conta_bancaria_id', conta.id).whereNot('status', 'ignorado');
        if (aExclusive) q.where('data_transacao', '>', aExclusive);
        if (bInclusive) q.where('data_transacao', '<=', bInclusive);
        const agg = await q.first(
          adminDb.raw("COALESCE(SUM(CASE WHEN tipo='credito' THEN valor ELSE -valor END),0) as total")
        );
        return parseFloat(agg.total || 0);
      };
    }

    // Saldo no fim do dia anterior ao início da janela
    const diaAntes = new Date(new Date(`${inicio}T12:00:00Z`).getTime() - 86400000)
      .toISOString().slice(0, 10);
    let saldoInicialJanela;
    if (!anchor.data) {
      saldoInicialJanela = anchor.saldo + await netAte(null, diaAntes);
    } else if (anchor.data <= diaAntes) {
      saldoInicialJanela = anchor.saldo + await netAte(anchor.data, diaAntes);
    } else {
      // âncora dentro ou depois da janela: volta no tempo
      saldoInicialJanela = anchor.saldo - await netAte(diaAntes, anchor.data);
    }

    let saldo = saldoInicialJanela;
    const lancamentos = rows.map((r) => {
      saldo = Math.round((saldo + r.net) * 100) / 100;
      return { ...r, saldo_apos: saldo };
    });

    res.json({
      conta: {
        id: conta.id,
        nome: conta.nome,
        banco_codigo: conta.banco_codigo,
        fonte_movimentos: isMp ? 'mercadopago' : 'extratos',
      },
      periodo: { inicio, fim },
      ancora: anchor,
      saldo_inicial_periodo: Math.round(saldoInicialJanela * 100) / 100,
      saldo_final_periodo: saldo,
      lancamentos,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/conciliacao/sugestoes/:extratoId
 * Busca contas a pagar candidatas para um extrato. Sem ?search, janela de
 * valor que acomoda juros/multa (pagou a mais) e desconto (pagou a menos);
 * com ?search, busca livre por fornecedor/descrição. Cada candidata vem com
 * a diferença e a decomposição sugerida (juros/multa pela regra do
 * fornecedor, ou desconto).
 */
router.get('/sugestoes/:extratoId', async (req, res, next) => {
  try {
    const extrato = await adminDb(EXTRATOS).where('id', req.params.extratoId).first();
    if (!extrato) return res.status(404).json({ error: 'Extrato não encontrado' });

    const valor = toNumber(extrato.valor);
    const tolerancia = Math.max(1, valor * 0.005); // 0.5% ou R$1
    const search = (req.query.search || '').trim();

    let query = adminDb(CONTAS)
      .select('*')
      .whereIn('status', ['pendente', 'vencido']);

    if (search) {
      query = query
        .where((q) => q
          .where('fornecedor', 'like', `%${search}%`)
          .orWhere('descricao', 'like', `%${search}%`))
        .orderByRaw('ABS(DATEDIFF(data_vencimento, ?)) ASC', [extrato.data_transacao])
        .limit(15);
    } else {
      // Pagou a mais (juros/multa de até ~15%) ou a menos (desconto de até ~10%)
      query = query
        .whereBetween('saldo_aberto', [
          Math.max(0.01, valor * 0.85 - tolerancia),
          valor * 1.10 + tolerancia,
        ])
        .orderByRaw('ABS(saldo_aberto - ?) ASC', [valor])
        .orderByRaw('ABS(DATEDIFF(data_vencimento, ?)) ASC', [extrato.data_transacao])
        .limit(10);
    }

    let candidatas = await query;

    // Extrato MP de boleto traz o banco emissor na descrição ("[banco 341]"):
    // marca e prioriza as candidatas cujo boleto DDA é do mesmo banco.
    const mBanco = (extrato.fit_id || '').startsWith('mp-')
      ? (extrato.descricao || '').match(/\[banco (\d{3})\]/)
      : null;
    if (mBanco && candidatas.length > 0) {
      const bancoNome = guessBankFromCode(mBanco[1]) || mBanco[1];
      const ddaRows = await adminDb('dda_documentos')
        .whereIn('conta_pagar_id', candidatas.map((c) => c.id))
        .select('conta_pagar_id', 'banco');
      const bancoPorConta = {};
      for (const d of ddaRows) {
        if (d.banco) bancoPorConta[d.conta_pagar_id] = d.banco;
      }
      candidatas = candidatas
        .map((c) => ({
          ...c,
          dda_banco: bancoPorConta[c.id] || null,
          banco_match: Boolean(bancoPorConta[c.id] && bancoPorConta[c.id] === bancoNome),
        }))
        .sort((a, b) => Number(b.banco_match) - Number(a.banco_match));
    }

    // Diferença entre o valor pago (extrato) e o saldo da conta, com a
    // decomposição sugerida: juros/multa pela regra do fornecedor quando
    // pagou a mais, desconto quando pagou a menos.
    candidatas = await Promise.all(candidatas.map(async (c) => {
      const saldo = toNumber(c.saldo_aberto);
      const diferenca = toNumber(valor - saldo);
      const sugestao = { valor_juros: 0, valor_multa: 0, valor_desconto: 0 };

      if (diferenca > 0.009) {
        try {
          const auto = await calcJurosMultaAuto({
            fornecedor: c.fornecedor,
            codiforn: c.erp_fornecedor_id,
            valor: saldo,
            data_vencimento: c.data_vencimento,
            data_pagamento: extrato.data_transacao,
          });
          if (auto && (auto.valor_multa > 0 || auto.valor_juros > 0)) {
            sugestao.valor_multa = Math.min(auto.valor_multa, diferenca);
            sugestao.valor_juros = toNumber(diferenca - sugestao.valor_multa);
          } else {
            sugestao.valor_juros = diferenca;
          }
        } catch {
          sugestao.valor_juros = diferenca;
        }
      } else if (diferenca < -0.009) {
        sugestao.valor_desconto = toNumber(-diferenca);
      }

      return { ...c, diferenca, sugestao_decomposicao: sugestao };
    }));

    res.json({ extrato, sugestoes: candidatas });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
