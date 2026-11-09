/**
 * Integração com a API do MercadoPago.
 *
 * Sincroniza as movimentações de saída (pagamentos de boleto, transferências,
 * recargas) das contas MP das empresas para extratos_bancarios, onde entram
 * no mesmo fluxo de conciliação do OFX.
 *
 * Tokens ficam SOMENTE no .env do backend (MP_ACCESS_TOKEN_<EMPRESA>).
 * A API pública não expõe saldo nem código de barras do boleto pago; o que
 * vem é o banco emissor (point_of_interaction.references UTILITY_ENTITY),
 * valor e data — suficiente para sugerir o match com o DDA/contas a pagar.
 */
const crypto = require('crypto');
const { adminDb } = require('../config/database');
const { guessBankFromCode } = require('./ddaService');
const { recalcContaDependencies } = require('./reconciliationService');

const MP_API = 'https://api.mercadopago.com';
const EXTRATOS = 'extratos_bancarios';
const BANCOS = 'contas_bancarias';
const BAIXAS = 'contas_pagar_baixas';
const RELATORIOS = 'mp_relatorios';
const MOVIMENTOS = 'mp_movimentos';

// Código FEBRABAN da instituição de pagamento do Mercado Pago
const MP_BANCO_CODIGO = '323';

const EMPRESAS = [
  { slug: 'vivenda', label: 'Vivenda das Flores', envVar: 'MP_ACCESS_TOKEN_VIVENDA' },
  { slug: 'embalatti', label: 'Embalatti', envVar: 'MP_ACCESS_TOKEN_EMBALATTI' },
];

function getEmpresas() {
  return EMPRESAS.filter((e) => process.env[e.envVar]);
}

function getEmpresa(slug) {
  const emp = EMPRESAS.find((e) => e.slug === slug);
  if (!emp || !process.env[emp.envVar]) return null;
  return { ...emp, token: process.env[emp.envVar] };
}

async function mpGet(token, path) {
  const res = await fetch(MP_API + path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body.message || body.error || `HTTP ${res.status}`;
    const err = new Error(`MercadoPago ${path.split('?')[0]}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

async function mpGetText(token, path) {
  const res = await fetch(MP_API + path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`MercadoPago ${path.split('?')[0]}: HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return text;
}

async function mpPost(token, path, body) {
  const res = await fetch(MP_API + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const parsed = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = parsed.message || parsed.error || `HTTP ${res.status}`;
    const err = new Error(`MercadoPago ${path}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return parsed;
}

/**
 * Garante que existe uma conta bancária cadastrada para a conta MP da
 * empresa (banco 323, conta = user id do MP). Retorna o registro.
 */
async function ensureContaBancaria(empresa, mpUserId) {
  const existente = await adminDb(BANCOS)
    .where('banco_codigo', MP_BANCO_CODIGO)
    .where('conta', String(mpUserId))
    .first();
  if (existente) return existente;

  const [id] = await adminDb(BANCOS).insert({
    nome: `MercadoPago ${empresa.label}`,
    banco_codigo: MP_BANCO_CODIGO,
    banco_nome: 'Mercado Pago',
    agencia: '0001',
    conta: String(mpUserId),
    tipo: 'corrente',
    saldo_inicial: 0,
    ativo: true,
    observacoes: `Conta MercadoPago (${empresa.slug}) sincronizada via API`,
  });
  return adminDb(BANCOS).where('id', id).first();
}

const OP_LABELS = {
  regular_payment: 'Pagamento',
  money_transfer: 'Transferência',
  account_fund: 'Depósito',
  recurring_payment: 'Pagamento recorrente',
  pos_payment: 'Pagamento POS',
};

/**
 * Converte um payment do MP (visão payer) em linha de extrato.
 * Retorna null para o que não deve entrar (não aprovado etc.).
 */
// Movimentações internas da conta MP (reservas, rendimentos) que não
// interessam para conciliação de contas a pagar.
const OP_IGNORADAS = new Set(['partition_transfer', 'investment', 'reserve_for_payout']);

function paymentToExtrato(p, mpUserId) {
  if (p.status !== 'approved') return null;
  if (OP_IGNORADAS.has(p.operation_type)) return null;
  const valor = Math.abs(Number(p.transaction_amount) || 0);
  if (!valor) return null;

  const isCredito = p.collector && Number(p.collector.id) === Number(mpUserId);
  const dataRaw = p.date_approved || p.date_created;
  if (!dataRaw) return null;

  const poi = p.point_of_interaction || {};
  const branch = (poi.business_info && poi.business_info.branch) || '';
  const refs = poi.references || [];
  const utility = refs.find((r) => r.type === 'UTILITY_ENTITY');
  const isBoleto = /bill payments/i.test(branch) || Boolean(utility);

  const base = p.description
    || (p.additional_info && p.additional_info.items && p.additional_info.items[0]
      && p.additional_info.items[0].title)
    || OP_LABELS[p.operation_type]
    || p.operation_type
    || 'Movimentação MP';

  let descricao;
  if (isBoleto) {
    descricao = `Boleto ${base}`;
    if (utility && utility.id) descricao += ` [banco ${utility.id}]`;
  } else if (p.operation_type === 'account_fund') {
    descricao = `Depósito na conta MP (${p.payment_method_id || 'transferência'})`;
  } else if (p.operation_type === 'money_transfer') {
    descricao = `Transferência: ${base}`;
  } else {
    descricao = base;
  }

  return {
    fit_id: `mp-${p.id}`,
    data_transacao: String(dataRaw).slice(0, 10),
    valor,
    tipo: isCredito ? 'credito' : 'debito',
    descricao: descricao.slice(0, 255),
    documento: String(p.id),
  };
}

/**
 * Busca paginada em /v1/payments/search. Sem filtro extra o MP devolve os
 * pagamentos RECEBIDOS (conta como collector); com payer.id, os pagos.
 */
async function fetchPagamentosSearch(token, dias, extraQs = '') {
  const end = new Date().toISOString();
  const begin = new Date(Date.now() - dias * 86400000).toISOString();
  const all = [];
  let offset = 0;

  while (true) {
    const qs = `${extraQs}range=date_created&begin_date=${begin}&end_date=${end}`
      + `&sort=date_created&criteria=desc&limit=50&offset=${offset}`;
    const page = await mpGet(token, `/v1/payments/search?${qs}`);
    const results = page.results || [];
    all.push(...results);
    offset += results.length;
    const total = (page.paging && page.paging.total) || 0;
    if (results.length === 0 || offset >= total || offset >= 1000) break;
  }
  return all;
}

/**
 * Busca paginada dos pagamentos em que a conta MP é a pagadora.
 */
function fetchPagamentosPayer(token, mpUserId, dias) {
  return fetchPagamentosSearch(token, dias, `payer.id=${mpUserId}&`);
}

/**
 * Sincroniza as movimentações de uma empresa para extratos_bancarios.
 */
async function syncEmpresa(slug, { dias = 60, username = null } = {}) {
  const empresa = getEmpresa(slug);
  if (!empresa) throw new Error(`Empresa MP não configurada: ${slug}`);

  const me = await mpGet(empresa.token, '/users/me');
  const conta = await ensureContaBancaria(empresa, me.id);

  const pagamentos = await fetchPagamentosPayer(empresa.token, me.id, dias);

  let inserted = 0;
  let duplicated = 0;
  let skipped = 0;

  for (const p of pagamentos) {
    const row = paymentToExtrato(p, me.id);
    if (!row) { skipped++; continue; }

    const existe = await adminDb(EXTRATOS)
      .where('conta_bancaria_id', conta.id)
      .where('fit_id', row.fit_id)
      .first();
    if (existe) { duplicated++; continue; }

    await adminDb(EXTRATOS).insert({
      conta_bancaria_id: conta.id,
      ...row,
      status: 'pendente',
      importado_por: username,
    });
    inserted++;
  }

  return {
    slug,
    label: empresa.label,
    conta_bancaria_id: conta.id,
    conta_nome: conta.nome,
    total: pagamentos.length,
    inserted,
    duplicated,
    skipped,
  };
}

// ============================================================
// Relatório "dinheiro em conta" (settlement_report)
//
// O MP gera 1 CSV por dia (agendamento criado via API) com TODAS as
// movimentações que impactam o saldo da conta — vendas (com tarifa),
// pagamentos de boleto, transferências, saques, estornos, disputas.
// SETTLEMENT_NET_AMOUNT é o impacto líquido, com sinal. O saldo correto:
// saldo_inicial (fim do dia data_saldo_inicial) + soma dos net posteriores.
// ============================================================

/**
 * Parse de CSV com separador ';' e campos entre aspas ("" escapa aspas).
 * Retorna objetos indexados pelo cabeçalho.
 */
function parseRelatorioCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ';') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  if (rows.length < 2) return [];
  const header = rows[0];
  return rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, idx) => { obj[h] = r[idx] !== undefined ? r[idx] : ''; });
    return obj;
  });
}

const SP_DT_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

// O MP rende o MESMO relatório ora em -03:00 ora em -04:00, então a data é
// normalizada para o horário de São Paulo quando o offset vem explícito —
// sem isso o mesmo lançamento entra duas vezes com 1h de diferença.
function toMysqlDt(iso) {
  if (!iso) return null;
  const s = String(iso).trim();
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      const parts = SP_DT_FMT.formatToParts(d);
      const g = (t) => parts.find((p) => p.type === t).value;
      return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}:${g('second')}`;
    }
  }
  return s.replace('T', ' ').replace(/\.\d+.*$|Z$/, '').slice(0, 19);
}

/**
 * Importa para mp_movimentos os relatórios ainda não processados da empresa.
 * Dedupe por hash da linha (relatórios sob demanda sobrepõem os diários);
 * linhas idênticas no mesmo arquivo recebem um sequencial no hash.
 */
async function syncRelatoriosEmpresa(slug, { username = null } = {}) {
  const empresa = getEmpresa(slug);
  if (!empresa) throw new Error(`Empresa MP não configurada: ${slug}`);

  const me = await mpGet(empresa.token, '/users/me');
  const conta = await ensureContaBancaria(empresa, me.id);

  const lista = await mpGet(empresa.token, '/v1/account/settlement_report/list');
  const arquivos = (Array.isArray(lista) ? lista : []).filter((r) => r.file_name);
  const jaImportados = new Set(
    (await adminDb(RELATORIOS).where('empresa_slug', slug).select('file_name'))
      .map((r) => r.file_name)
  );

  let novosArquivos = 0;
  let inseridos = 0;
  let duplicados = 0;

  for (const arq of arquivos) {
    const fileName = String(arq.file_name).slice(0, 180);
    if (jaImportados.has(fileName)) continue;

    const csv = await mpGetText(empresa.token, `/v1/account/settlement_report/${arq.file_name}`);
    const rows = parseRelatorioCsv(csv);

    const vistos = new Map();
    let insFile = 0;
    for (const r of rows) {
      const net = parseFloat(r.SETTLEMENT_NET_AMOUNT);
      if (!r.TRANSACTION_DATE || Number.isNaN(net)) continue;

      const base = [
        r.SOURCE_ID, r.TRANSACTION_TYPE, r.TRANSACTION_DATE,
        r.SETTLEMENT_NET_AMOUNT, r.TRANSACTION_AMOUNT, r.EXTERNAL_REFERENCE,
      ].join('|');
      const seq = vistos.get(base) || 0;
      vistos.set(base, seq + 1);
      const rowHash = crypto.createHash('sha1').update(`${base}|${seq}`).digest('hex');

      // O hash falha quando outro arquivo rendeu o mesmo lançamento em fuso
      // diferente (data deslocada ±1h): checa por source_id + tipo + valor
      // líquido numa janela de ±3h em arquivos anteriores.
      const dtNorm = toMysqlDt(r.TRANSACTION_DATE);
      if (r.SOURCE_ID && dtNorm && seq === 0) {
        const centro = new Date(`${dtNorm.replace(' ', 'T')}Z`);
        const wall = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
        const parecido = await adminDb(MOVIMENTOS)
          .where('conta_bancaria_id', conta.id)
          .whereNot('file_name', fileName)
          .where('source_id', String(r.SOURCE_ID).slice(0, 80))
          .where('transaction_type', (r.TRANSACTION_TYPE || 'DESCONHECIDO').slice(0, 40))
          .whereBetween('net_amount', [net - 0.005, net + 0.005])
          .whereBetween('transaction_date', [
            wall(new Date(centro.getTime() - 3 * 3600000)),
            wall(new Date(centro.getTime() + 3 * 3600000)),
          ])
          .first('id');
        if (parecido) { duplicados++; continue; }
      }

      try {
        await adminDb(MOVIMENTOS).insert({
          conta_bancaria_id: conta.id,
          empresa_slug: slug,
          source_id: (r.SOURCE_ID || '').slice(0, 80) || null,
          external_reference: (r.EXTERNAL_REFERENCE || '').slice(0, 120) || null,
          transaction_type: (r.TRANSACTION_TYPE || 'DESCONHECIDO').slice(0, 40),
          transaction_date: toMysqlDt(r.TRANSACTION_DATE),
          amount: parseFloat(r.TRANSACTION_AMOUNT) || 0,
          fee: parseFloat(r.FEE_AMOUNT) || 0,
          net_amount: net,
          payment_method: (r.PAYMENT_METHOD || '').slice(0, 40) || null,
          payment_method_type: (r.PAYMENT_METHOD_TYPE || '').slice(0, 40) || null,
          descricao: (r.DESCRIPTION || '').slice(0, 255) || null,
          file_name: fileName,
          row_hash: rowHash,
        });
        inseridos++;
        insFile++;
      } catch (err) {
        if (err && err.code === 'ER_DUP_ENTRY') duplicados++;
        else throw err;
      }
    }

    await adminDb(RELATORIOS).insert({
      empresa_slug: slug,
      file_name: fileName,
      begin_date: toMysqlDt(arq.begin_date),
      end_date: toMysqlDt(arq.end_date),
      created_from: arq.created_from || null,
      linhas: rows.length,
      inseridos: insFile,
      importado_por: username,
    });
    novosArquivos++;
  }

  return {
    slug,
    label: empresa.label,
    conta_bancaria_id: conta.id,
    arquivos_novos: novosArquivos,
    movimentos_inseridos: inseridos,
    movimentos_duplicados: duplicados,
  };
}

/**
 * Pede ao MP a geração de um relatório sob demanda (backfill). A geração é
 * assíncrona: o arquivo entra na lista em alguns minutos e o próximo sync
 * de relatórios importa.
 */
async function gerarRelatorioBackfill(slug, dias = 60) {
  const empresa = getEmpresa(slug);
  if (!empresa) throw new Error(`Empresa MP não configurada: ${slug}`);
  const end = new Date();
  const begin = new Date(end.getTime() - dias * 86400000);
  const fmt = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return mpPost(empresa.token, '/v1/account/settlement_report', {
    begin_date: fmt(begin),
    end_date: fmt(end),
  });
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * Atualização sob demanda do extrato MP: pede um relatório dos últimos 2 dias
 * para cada empresa (a geração no MP leva ~30-60s), aguarda e importa. O
 * dedupe por hash absorve a sobreposição com os relatórios diários. Quando a
 * geração não fica pronta dentro do timeout, devolve importado=false — o
 * próximo sync importa o arquivo que ficou pronto.
 */
async function refreshRelatoriosDia({ username = null, timeoutMs = 75000 } = {}) {
  const empresas = getEmpresas();
  const resultados = {};

  for (const emp of empresas) {
    try {
      await gerarRelatorioBackfill(emp.slug, 2);
      resultados[emp.slug] = { label: emp.label, solicitado: true, importado: false };
    } catch (err) {
      resultados[emp.slug] = { label: emp.label, solicitado: false, importado: false, error: err.message };
    }
  }

  const pendentes = new Set(Object.keys(resultados).filter((s) => resultados[s].solicitado));
  const fim = Date.now() + timeoutMs;

  while (pendentes.size > 0 && Date.now() < fim) {
    await sleep(6000);
    for (const slug of [...pendentes]) {
      try {
        const r = await syncRelatoriosEmpresa(slug, { username });
        if (r.arquivos_novos > 0) {
          resultados[slug] = { ...resultados[slug], ...r, importado: true };
          pendentes.delete(slug);
        }
      } catch (err) {
        // geração ainda em andamento ou erro transitório — tenta no próximo ciclo
      }
    }
  }

  return resultados;
}

// "ITAÚ UNIBANCO S.A." -> "Itaú Unibanco S.A."
function tituloAmigavel(s) {
  return String(s).toLowerCase().replace(/(^|[\s(])\S/g, (c) => c.toUpperCase())
    .replace(/\bS\.a\./g, 'S.A.').replace(/\bLtda\b/gi, 'Ltda');
}

/**
 * Nome amigável de quem pagou, a partir do payment (visão collector):
 * descrição/título do item, nome no cartão, ou o banco de origem do pix
 * (o MP mascara a identidade do pagador em pix via QR).
 */
function paymentToNomePagador(p) {
  let direto = (p.description || '').trim()
    || ((p.additional_info && p.additional_info.items && p.additional_info.items[0]
      && p.additional_info.items[0].title) || '').trim();
  // "Olá, você recebeu uma transferência de TikTok Shop" -> "Transferência de TikTok Shop"
  direto = direto.replace(/^Olá,?\s*você recebeu uma\s*/i, '');
  if (direto && !/^\d+$/.test(direto)) return direto;
  const holder = (p.card && p.card.cardholder && p.card.cardholder.name || '').trim();
  if (holder) return tituloAmigavel(holder);
  const poi = p.point_of_interaction || {};
  const banco = poi.transaction_data && poi.transaction_data.bank_info
    && poi.transaction_data.bank_info.payer
    && poi.transaction_data.bank_info.payer.long_name;
  if (banco) return `via ${tituloAmigavel(banco)}`;
  return direto || '';
}

/**
 * Preenche a descrição dos movimentos do relatório (vem vazia do CSV) com os
 * dados dos pagamentos recebidos: "Recebimento (pix) — via Banco X",
 * "Recebimento (visa) — Fulano". Os pagamentos FEITOS já ganham descrição no
 * extrato de conciliação (extratos_bancarios), que tem prioridade na tela.
 */
async function enriquecerMovimentos(slug, { dias = 15 } = {}) {
  const empresa = getEmpresa(slug);
  if (!empresa) throw new Error(`Empresa MP não configurada: ${slug}`);

  const me = await mpGet(empresa.token, '/users/me');
  const conta = await ensureContaBancaria(empresa, me.id);

  const desde = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
  const semDescricao = await adminDb(MOVIMENTOS)
    .where('conta_bancaria_id', conta.id)
    .whereNull('descricao')
    .whereNotNull('source_id')
    .where('transaction_date', '>=', `${desde} 00:00:00`)
    .select('id', 'source_id', 'net_amount', 'payment_method');
  if (semDescricao.length === 0) {
    return { slug, label: empresa.label, candidatos: 0, atualizados: 0 };
  }

  const recebidos = await fetchPagamentosSearch(empresa.token, dias);
  const porId = new Map(recebidos.map((p) => [String(p.id), p]));

  let atualizados = 0;
  for (const mv of semDescricao) {
    const p = porId.get(String(mv.source_id));
    if (!p) continue;
    const nome = paymentToNomePagador(p);
    if (!nome) continue;
    const rotulo = parseFloat(mv.net_amount) >= 0 ? 'Recebimento' : 'Pagamento';
    const metodo = mv.payment_method && mv.payment_method !== 'available_money'
      ? ` (${mv.payment_method})` : '';
    await adminDb(MOVIMENTOS).where('id', mv.id).update({
      descricao: `${rotulo}${metodo} — ${nome}`.slice(0, 255),
    });
    atualizados++;
  }

  return { slug, label: empresa.label, candidatos: semDescricao.length, atualizados };
}

/**
 * Saldo da conta MP a partir dos movimentos do relatório:
 * saldo_inicial + soma dos net_amount com data posterior a data_saldo_inicial
 * (saldo_inicial é o saldo no FIM daquele dia). Sem data, soma tudo.
 */
async function getSaldoContaMp(conta) {
  const q = adminDb(MOVIMENTOS).where('conta_bancaria_id', conta.id);
  if (conta.data_saldo_inicial) {
    const d = String(conta.data_saldo_inicial instanceof Date
      ? conta.data_saldo_inicial.toISOString()
      : conta.data_saldo_inicial).slice(0, 10);
    q.where('transaction_date', '>', `${d} 23:59:59`);
  }
  const agg = await q.first(
    adminDb.raw('COALESCE(SUM(net_amount), 0) as total'),
    adminDb.raw('MAX(transaction_date) as ultimo'),
    adminDb.raw('COUNT(*) as n')
  );
  return {
    saldo: parseFloat(conta.saldo_inicial || 0) + parseFloat(agg.total || 0),
    movimentos: Number(agg.n || 0),
    ultimo_movimento: agg.ultimo || null,
  };
}

const toDateStr = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const diffDias = (a, b) => Math.round((new Date(toDateStr(a)) - new Date(toDateStr(b))) / 86400000);

/**
 * Baixa automática dos pagamentos de boleto via MercadoPago.
 *
 * Para cada extrato MP pendente com banco identificado:
 * 1. Procura o boleto DDA do mesmo banco e valor cujo VENCIMENTO é o mais
 *    próximo da data do pagamento. O match só vale quando é inequívoco:
 *    o mais próximo dista <= 7 dias e o segundo colocado >= 20 dias
 *    (parcelas mensais do mesmo cedente ficam distinguíveis).
 * 2. Marca o DDA como 'pago' (pago_em / pago_ref).
 * 3. Se o DDA tem conta a pagar vinculada em aberto — ou existe exatamente
 *    uma conta em aberto com o mesmo valor e vencimento — cria a baixa e
 *    marca o extrato como conciliado.
 * Sem conta a pagar, o extrato FICA PENDENTE (só o DDA é marcado como pago):
 * o sync do ERP costuma trazer a conta horas depois do pagamento, e a
 * próxima rodada repesca o extrato pelo pago_ref do DDA e cria a baixa.
 * Ambíguos e sem DDA também ficam pendentes para o fluxo manual.
 */
async function autoConciliarMp({ username = 'auto-mp' } = {}) {
  const pendentes = await adminDb(EXTRATOS)
    .where('fit_id', 'like', 'mp-%')
    .where('status', 'pendente')
    .where('tipo', 'debito')
    .where('descricao', 'like', '%[banco %');

  const baixados = [];
  const ddaPagos = [];
  let ambiguos = 0;
  let semMatch = 0;
  let aguardandoConta = 0;

  for (const extrato of pendentes) {
    const valor = Number(extrato.valor);

    // Repescagem: boleto já identificado numa rodada anterior em que a conta
    // a pagar ainda não existia.
    let best = await adminDb('dda_documentos')
      .where('pago_ref', extrato.fit_id)
      .where('status', 'pago')
      .first('id', 'data_vencimento', 'cedente_nome', 'conta_pagar_id', 'status');
    const repescagem = Boolean(best);

    if (!best) {
      const m = (extrato.descricao || '').match(/\[banco (\d{3})\]/);
      if (!m) { semMatch++; continue; }
      const bancoNome = guessBankFromCode(m[1]) || m[1];

      // 1. boleto DDA: mesmo banco + valor, vencimento mais próximo do pagamento
      const ddas = await adminDb('dda_documentos')
        .where('banco', bancoNome)
        .whereBetween('valor_documento', [valor - 0.005, valor + 0.005])
        .whereNotIn('status', ['descartado', 'pago'])
        .select('id', 'data_vencimento', 'cedente_nome', 'conta_pagar_id', 'status');

      const ranked = ddas
        .map((d) => ({ ...d, dist: Math.abs(diffDias(d.data_vencimento, extrato.data_transacao)) }))
        .sort((a, b) => a.dist - b.dist);
      best = ranked[0];
      const second = ranked[1];

      if (!best) { semMatch++; continue; }
      if (best.dist > 7 || (second && second.dist < 20)) { ambiguos++; continue; }
    }

    // 2. conta a pagar: a vinculada ao DDA, ou única em aberto com mesmo valor+venc
    let conta = null;
    if (best.conta_pagar_id) {
      conta = await adminDb('contas_pagar')
        .where('id', best.conta_pagar_id)
        .whereIn('status', ['pendente', 'vencido'])
        .first('id', 'fornecedor', 'saldo_aberto');
    }
    if (!conta) {
      const candidatas = await adminDb('contas_pagar')
        .whereIn('status', ['pendente', 'vencido'])
        .whereBetween('saldo_aberto', [valor - 0.005, valor + 0.005])
        .whereRaw('ABS(DATEDIFF(data_vencimento, ?)) <= 3', [toDateStr(best.data_vencimento)])
        .select('id', 'fornecedor', 'saldo_aberto');
      if (candidatas.length === 1) conta = candidatas[0];
    }

    // 3. marca o DDA como pago (na repescagem só completa o vínculo da conta)
    if (!repescagem) {
      await adminDb('dda_documentos').where('id', best.id).update({
        status: 'pago',
        pago_em: toDateStr(extrato.data_transacao),
        pago_ref: extrato.fit_id,
        conta_pagar_id: conta ? conta.id : best.conta_pagar_id,
        atualizado_por: username,
      });
      ddaPagos.push({
        dda_id: best.id,
        cedente: best.cedente_nome,
        valor,
        vencimento: toDateStr(best.data_vencimento),
        pago_em: toDateStr(extrato.data_transacao),
      });
    } else if (conta && !best.conta_pagar_id) {
      await adminDb('dda_documentos').where('id', best.id).update({
        conta_pagar_id: conta.id,
        atualizado_por: username,
      });
    }

    // 4. sem conta em aberto, o extrato fica pendente para repescagem/manual
    if (!conta || Number(conta.saldo_aberto) < valor - 0.01) {
      aguardandoConta++;
      continue;
    }

    // 5. baixa na conta a pagar
    let baixaId = null;
    const jaBaixado = await adminDb(BAIXAS)
      .where('referencia_externa', extrato.fit_id)
      .where('estornada', false)
      .first();
    if (jaBaixado) {
      baixaId = jaBaixado.id;
    } else {
      [baixaId] = await adminDb(BAIXAS).insert({
        conta_pagar_id: conta.id,
        data_pagamento: extrato.data_transacao,
        valor_pago: valor,
        valor_desconto: 0,
        valor_juros: 0,
        valor_multa: 0,
        forma_pagamento: 'mercadopago',
        conta_bancaria_id: extrato.conta_bancaria_id,
        banco_baixa: null,
        origem: 'mercadopago',
        referencia_externa: extrato.fit_id,
        extrato_id: extrato.id,
        observacoes: `Baixa automática MercadoPago: ${extrato.descricao || ''} (DDA #${best.id} ${best.cedente_nome || ''})`,
        criado_por: username,
        atualizado_por: username,
      });
      await recalcContaDependencies(conta.id);
    }
    if (jaBaixado && !jaBaixado.extrato_id) {
      await adminDb(BAIXAS).where('id', baixaId).update({ extrato_id: extrato.id });
    }
    baixados.push({
      extrato_id: extrato.id,
      baixa_id: baixaId,
      conta_pagar_id: conta.id,
      fornecedor: conta.fornecedor,
      valor,
      data_pagamento: toDateStr(extrato.data_transacao),
    });

    // 6. extrato conciliado somente com baixa criada
    await adminDb(EXTRATOS).where('id', extrato.id).update({
      status: 'conciliado',
      baixa_id: baixaId,
    });
  }

  return {
    analisados: pendentes.length,
    baixados,
    dda_pagos: ddaPagos,
    ambiguos,
    sem_match: semMatch,
    aguardando_conta: aguardandoConta,
  };
}

module.exports = {
  getEmpresas,
  getEmpresa,
  ensureContaBancaria,
  syncEmpresa,
  autoConciliarMp,
  syncRelatoriosEmpresa,
  gerarRelatorioBackfill,
  refreshRelatoriosDia,
  enriquecerMovimentos,
  getSaldoContaMp,
  MP_BANCO_CODIGO,
};
