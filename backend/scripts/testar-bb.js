/**
 * Teste manual da API de Extratos do Banco do Brasil.
 *
 * Uso (na pasta backend):
 *   node --env-file=.env scripts/testar-bb.js
 *
 * Faz o fluxo completo com as credenciais do .env: token OAuth, depois o GET
 * do extrato com mTLS (certificado de backend/certs). Imprime cada etapa.
 * Não grava nada no banco.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const AMB = (process.env.BB_AMBIENTE || 'prod').toLowerCase();
const HOSTS = {
  hm: { oauth: 'https://oauth.hm.bb.com.br', api: 'https://api-extratos.hm.bb.com.br', keyParam: 'gw-dev-app-key' },
  prod: { oauth: 'https://oauth.bb.com.br', api: 'https://api-extratos.bb.com.br', keyParam: 'gw-app-key' },
};
const env = HOSTS[AMB];
const agencia = process.env.BB_AGENCIA || '452';
const conta = process.env.BB_CONTA || '123873';

(async () => {
  console.log(`Ambiente: ${AMB} | agência ${agencia} conta ${conta}`);

  // 1. token
  const tokRes = await fetch(`${env.oauth}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.BB_CLIENT_ID}:${process.env.BB_CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=extrato-info',
  });
  const tok = await tokRes.json().catch(() => ({}));
  if (!tok.access_token) {
    console.log(`1) Token: FALHOU (HTTP ${tokRes.status})`, JSON.stringify(tok).slice(0, 300));
    process.exit(1);
  }
  console.log(`1) Token: ok (scope ${tok.scope})`);

  // 2. extrato com mTLS
  const certsDir = path.join(__dirname, '../certs');
  const tls = { ca: fs.readFileSync(path.join(certsDir, 'bb-hom-ca.pem')) };
  if (process.env.BB_CERT_PFX) {
    tls.pfx = fs.readFileSync(process.env.BB_CERT_PFX);
    if (process.env.BB_CERT_SENHA) tls.passphrase = process.env.BB_CERT_SENHA;
  } else if (process.env.BB_CERT_CRT && process.env.BB_CERT_KEY) {
    tls.cert = fs.readFileSync(process.env.BB_CERT_CRT);
    tls.key = fs.readFileSync(process.env.BB_CERT_KEY);
  } else {
    console.log('2) Sem certificado de cliente no .env (BB_CERT_*)');
    process.exit(1);
  }

  const u = new URL(`${env.api}/extratos/v1/conta-corrente/agencia/${agencia}/conta/${conta}`);
  u.searchParams.set(env.keyParam, process.env.BB_APP_KEY);
  u.searchParams.set('quantidadeRegistroPaginaSolicitacao', '50');

  const req = https.request({
    hostname: u.hostname,
    path: u.pathname + u.search,
    method: 'GET',
    headers: { Authorization: `Bearer ${tok.access_token}` },
    timeout: 30000,
    ...tls,
  }, (res) => {
    let d = '';
    res.on('data', (c) => { d += c; });
    res.on('end', () => {
      console.log(`2) Extrato: HTTP ${res.statusCode}`);
      console.log(d.slice(0, 2000));
    });
  });
  req.on('error', (e) => {
    console.log('2) Extrato: FALHA NO HANDSHAKE/CONEXÃO:', e.message);
    if (/alert|certificate/i.test(e.message)) {
      console.log('   -> O servidor do BB ainda não aceitou nosso certificado mTLS');
      console.log('      (upload no portal ok, mas a lista de CAs do servidor é atualizada em lote).');
    }
  });
  req.on('timeout', () => req.destroy(new Error('timeout')));
  req.end();
})();
