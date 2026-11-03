/**
 * Integração com a API de Extratos do Banco do Brasil.
 *
 * OAuth2 client_credentials (scope extrato-info) e consulta paginada de
 * GET /extratos/v1/conta-corrente/agencia/{agencia}/conta/{conta}.
 * Os lançamentos entram em extratos_bancarios como pendentes, no mesmo
 * fluxo de conciliação do OFX e do MercadoPago.
 *
 * Config no .env do backend:
 *   BB_AMBIENTE       hm (homologação) ou prod
 *   BB_CLIENT_ID / BB_CLIENT_SECRET / BB_APP_KEY  (credenciais do portal)
 *   BB_AGENCIA / BB_CONTA   agência e conta corrente SEM dígito verificador
 *   BB_CERT_PFX / BB_CERT_SENHA   certificado de cliente p/ mTLS (ex.: e-CNPJ
 *                                 A1 .pfx), exigido pelo host de extratos
 *   (alternativa em PEM: BB_CERT_CRT + BB_CERT_KEY)
 *   BB_MCI_TESTE   header x-br-com-bb-ipa-mciteste (massa de teste, só hm)
 *
 * O host de extratos exige mTLS: o certificado de cliente deve ser o mesmo
 * registrado no Portal Developers (com EKU Client Authentication). O OAuth
 * não exige mTLS.
 *
 * Obs: a API não fornece um id único por lançamento; o fit_id é um hash
 * estável dos campos do lançamento (com sequencial para linhas idênticas
 * no mesmo dia).
 */
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const { adminDb } = require('../config/database');

const EXTRATOS = 'extratos_bancarios';
const BANCOS = 'contas_bancarias';

const BB_BANCO_CODIGO = '001';

// API Extratos v2 (a v1 será desativada em 20/11/2026). Os hosts mTLS usam
// certificado de servidor DigiCert (CA pública), então não precisam de CA
// customizada; a autenticação do cliente é pelo certificado registrado no
// Portal Developers. O app key vai em query gw-dev-app-key nos dois ambientes.
const AMBIENTES = {
  hm: {
    oauth: 'https://oauth.hm.bb.com.br',
    api: 'https://extratos.mtls.api.hm.bb.com.br',
  },
  prod: {
    oauth: 'https://oauth.bb.com.br',
    api: 'https://extratos.mtls.api.bb.com.br',
  },
};

function getConfig() {
  const ambiente = (process.env.BB_AMBIENTE || 'prod').toLowerCase();
  const env = AMBIENTES[ambiente];
  if (!env) return null;
  const clientId = process.env.BB_CLIENT_ID;
  const clientSecret = process.env.BB_CLIENT_SECRET;
  const appKey = process.env.BB_APP_KEY;
  const agencia = process.env.BB_AGENCIA;
  const conta = process.env.BB_CONTA;
  if (!clientId || !clientSecret || !appKey) return null;
  return {
    ambiente,
    ...env,
    clientId,
    clientSecret,
    appKey,
    agencia,
    conta,
    mciTeste: process.env.BB_MCI_TESTE || null,
    certPfx: process.env.BB_CERT_PFX || null,
    certSenha: process.env.BB_CERT_SENHA || null,
    certCrt: process.env.BB_CERT_CRT || null,
    certKey: process.env.BB_CERT_KEY || null,
  };
}

function isConfigured() {
  return Boolean(getConfig());
}

function hasClientCert(cfg) {
  return Boolean(cfg.certPfx || (cfg.certCrt && cfg.certKey));
}

/**
 * Opções TLS do host de extratos: certificado de cliente (mTLS).
 * Lança erro claro se o certificado não estiver configurado.
 */
function buildTlsOptions(cfg) {
  const tls = {};
  if (cfg.certPfx) {
    try {
      tls.pfx = fs.readFileSync(cfg.certPfx);
    } catch {
      throw new Error(`Certificado BB_CERT_PFX não encontrado em ${cfg.certPfx}.`);
    }
    if (cfg.certSenha) tls.passphrase = cfg.certSenha;
  } else if (cfg.certCrt && cfg.certKey) {
    try {
      tls.cert = fs.readFileSync(cfg.certCrt);
      tls.key = fs.readFileSync(cfg.certKey);
    } catch {
      throw new Error('Certificado BB_CERT_CRT/BB_CERT_KEY não encontrado.');
    }
  } else {
    throw new Error('A API de extratos do BB exige mTLS: configure BB_CERT_PFX e '
      + 'BB_CERT_SENHA (ex.: e-CNPJ A1) ou BB_CERT_CRT e BB_CERT_KEY no .env.');
  }
  return tls;
}

/**
 * GET https com suporte a CA customizada e certificado de cliente (o fetch
 * nativo não aceita essas opções por chamada).
 */
function httpsGet(urlStr, headers, tls) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'GET',
      headers,
      timeout: 30000,
      // Doc do BB: endpoints aceitam somente TLS 1.2
      minVersion: 'TLSv1.2',
      maxVersion: 'TLSv1.2',
      ...tls,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, text: data }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout na API do BB')));
    req.on('error', reject);
    req.end();
  });
}

// Token OAuth com cache (o BB emite com validade de ~600s)
let tokenCache = { token: null, expiraEm: 0 };

async function getToken(cfg) {
  if (tokenCache.token && Date.now() < tokenCache.expiraEm) return tokenCache.token;

  const res = await fetch(`${cfg.oauth}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=extrato-info',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`BB OAuth: HTTP ${res.status} ${body.error_description || body.error || ''}`.trim());
  }
  const ttlMs = Math.max(60, (parseInt(body.expires_in, 10) || 600) - 60) * 1000;
  tokenCache = { token: body.access_token, expiraEm: Date.now() + ttlMs };
  return body.access_token;
}

// A API usa datas como inteiro ddmmaaaa (zeros à esquerda caem no int)
function toDataSolicitacao(d) {
  return parseInt(
    `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear()}`,
    10
  );
}

// dataLancamento vem como ddmmaaaa (int); converte para YYYY-MM-DD
function parseDataLancamento(v) {
  const s = String(v).padStart(8, '0');
  if (s.length !== 8) return null;
  return `${s.slice(4, 8)}-${s.slice(2, 4)}-${s.slice(0, 2)}`;
}

const stripZeros = (v) => String(v).replace(/^0+/, '') || '0';

/**
 * Busca os lançamentos do período (paginado, janelas de até 31 dias —
 * limite da API v2; HTTP 404 = sem lançamentos no período).
 */
async function fetchLancamentos(cfg, dias) {
  if (!cfg.agencia || !cfg.conta) {
    throw new Error('BB_AGENCIA e BB_CONTA não configurados no .env (sem dígito verificador).');
  }
  const token = await getToken(cfg);
  const tls = buildTlsOptions(cfg);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (cfg.ambiente === 'hm' && cfg.mciTeste) {
    headers['x-br-com-bb-ipa-mciteste'] = cfg.mciTeste;
  }

  const basePath = `${cfg.api}/v2/conta-corrente/agencia/${stripZeros(cfg.agencia)}/conta/${stripZeros(cfg.conta)}`;
  const all = [];

  // janelas de no máximo 31 dias, da mais antiga para a mais recente
  const fimTotal = new Date();
  let inicio = new Date(fimTotal.getTime() - dias * 86400000);

  while (inicio < fimTotal) {
    const fim = new Date(Math.min(inicio.getTime() + 30 * 86400000, fimTotal.getTime()));

    let pagina = 1;
    while (pagina && pagina < 200) {
      const qs = new URLSearchParams({
        'gw-dev-app-key': cfg.appKey,
        dataInicioSolicitacao: String(toDataSolicitacao(inicio)),
        dataFimSolicitacao: String(toDataSolicitacao(fim)),
        numeroPaginaSolicitacao: String(pagina),
        quantidadeRegistroPaginaSolicitacao: '120',
      });
      const res = await httpsGet(`${basePath}?${qs}`, headers, tls);
      let body;
      try { body = JSON.parse(res.text); } catch { body = {}; }

      if (res.status === 404) break; // sem lançamentos nesta janela

      if (res.status < 200 || res.status >= 300) {
        const msg = body.message
          || (body.errors && body.errors[0]
            && (body.errors[0].message || body.errors[0].mensagem || body.errors[0].title))
          || `HTTP ${res.status}`;
        const err = new Error(`BB Extratos: ${msg}`);
        err.status = res.status;
        throw err;
      }

      const lancamentos = body.listaLancamento || [];
      all.push(...lancamentos);

      const proxima = parseInt(body.numeroPaginaProximo, 10) || 0;
      pagina = proxima > pagina ? proxima : 0;
      if (lancamentos.length === 0) break;
    }

    inicio = new Date(fim.getTime() + 86400000);
  }
  return all;
}

/**
 * Converte um lançamento v2 em linha de extrato. Só entram lançamentos
 * contabilizados (indicadorTipoLancamento = 1); saldos, limites e futuros
 * (SA, SD, LD, LC, LU, 2, 3, ...) não são movimentação.
 */
function lancamentoToExtrato(l) {
  if (String(l.indicadorTipoLancamento) !== '1') return null;

  // Linhas de saldo vêm como tipo 1: "SALDO ANTERIOR" (codigoHistorico 0)
  // e "S A L D O" (grafado com espaços, com histórico preenchido).
  const descricaoBruta = (l.textoDescricaoSubHistorico || l.textoDescricaoHistorico || '').trim();
  if (!parseInt(l.codigoHistorico, 10)) return null;
  if (/\bsaldo\b/i.test(descricaoBruta.replace(/\s+/g, ' '))
    || /S\s*A\s*L\s*D\s*O/i.test(descricaoBruta)) return null;

  const valor = Math.abs(parseFloat(l.valorLancamento) || 0);
  if (!valor) return null;

  const data = parseDataLancamento(l.dataLancamento);
  if (!data) return null;

  const sinal = String(l.indicadorSinalLancamento || '').toUpperCase();
  if (sinal !== 'C' && sinal !== 'D') return null;

  const descricao = (l.textoDescricaoSubHistorico || l.textoDescricaoHistorico || '').trim();
  const complemento = (l.textoInformacaoComplementar || '').trim();
  const partes = [descricao || 'Lançamento BB'];
  if (complemento) partes.push(complemento);

  return {
    data_transacao: data,
    valor,
    tipo: sinal === 'C' ? 'credito' : 'debito',
    descricao: partes.join(' - ').slice(0, 255),
    documento: l.numeroDocumento ? String(l.numeroDocumento) : null,
    hashBase: [
      l.dataLancamento, l.valorLancamento, sinal, l.numeroDocumento,
      l.codigoHistorico, l.CodigoSubHistorico, l.numeroLote, descricao,
    ].join('|'),
  };
}

/**
 * Garante a conta bancária do BB no cadastro (banco 001 + agência/conta).
 */
async function ensureContaBancaria(cfg) {
  const existente = await adminDb(BANCOS)
    .where('banco_codigo', BB_BANCO_CODIGO)
    .where('agencia', String(cfg.agencia))
    .where('conta', String(cfg.conta))
    .first();
  if (existente) return existente;

  const [id] = await adminDb(BANCOS).insert({
    nome: 'Banco do Brasil',
    banco_codigo: BB_BANCO_CODIGO,
    banco_nome: 'Banco do Brasil',
    agencia: String(cfg.agencia),
    conta: String(cfg.conta),
    tipo: 'corrente',
    saldo_inicial: 0,
    ativo: true,
    observacoes: 'Conta Banco do Brasil sincronizada via API Extratos',
  });
  return adminDb(BANCOS).where('id', id).first();
}

/**
 * Sincroniza os lançamentos do período para extratos_bancarios.
 */
async function syncExtratoBb({ dias = 30, username = null } = {}) {
  const cfg = getConfig();
  if (!cfg) throw new Error('Credenciais do Banco do Brasil não configuradas no servidor.');

  const conta = await ensureContaBancaria(cfg);
  const lancamentos = await fetchLancamentos(cfg, dias);

  let inserted = 0;
  let duplicated = 0;
  let skipped = 0;
  const vistos = new Map();

  for (const l of lancamentos) {
    const row = lancamentoToExtrato(l);
    if (!row) { skipped++; continue; }

    const seq = vistos.get(row.hashBase) || 0;
    vistos.set(row.hashBase, seq + 1);
    const fitId = `bb-${crypto.createHash('sha1').update(`${row.hashBase}|${seq}`).digest('hex').slice(0, 24)}`;

    const existe = await adminDb(EXTRATOS)
      .where('conta_bancaria_id', conta.id)
      .where('fit_id', fitId)
      .first();
    if (existe) { duplicated++; continue; }

    await adminDb(EXTRATOS).insert({
      conta_bancaria_id: conta.id,
      fit_id: fitId,
      data_transacao: row.data_transacao,
      valor: row.valor,
      tipo: row.tipo,
      descricao: row.descricao,
      documento: row.documento,
      status: 'pendente',
      importado_por: username,
    });
    inserted++;
  }

  return {
    ambiente: cfg.ambiente,
    conta_bancaria_id: conta.id,
    conta_nome: conta.nome,
    total: lancamentos.length,
    inserted,
    duplicated,
    skipped,
  };
}

module.exports = {
  isConfigured,
  getConfig,
  hasClientCert,
  syncExtratoBb,
  BB_BANCO_CODIGO,
};
