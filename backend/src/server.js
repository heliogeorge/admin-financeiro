require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');

const { testConnections } = require('./config/database');

const authRoutes = require('./routes/auth');
const pagameRoutes = require('./routes/pagame');
const relrecRoutes = require('./routes/relrec');
const dashboardRoutes = require('./routes/dashboard');
const contasPagarRoutes = require('./routes/contasPagar');
const syncRoutes = require('./routes/sync');
const chequesRoutes = require('./routes/cheques');
const entradasRoutes = require('./routes/entradas');
const ddaRoutes = require('./routes/dda');
const planoContasRoutes = require('./routes/planoContas');
const shortcutRoutes = require('./routes/shortcut');
const inboxRoutes = require('./routes/inbox');
const contasBancariasRoutes = require('./routes/contasBancarias');
const fornecedorRegrasRoutes = require('./routes/fornecedorRegras');
const conciliacaoRoutes = require('./routes/conciliacao');
const mpRoutes = require('./routes/mp');
const bbRoutes = require('./routes/bb');
const comprasRoutes = require('./routes/compras');
const rankingVendasRoutes = require('./routes/rankingVendas');
const vendasAnaliticoRoutes = require('./routes/vendasAnalitico');
const lojasRoutes = require('./routes/lojas');
const precosRoutes = require('./routes/precos');
const lojaInfoRoutes = require('./routes/lojaInfo');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet({
  contentSecurityPolicy: false, // evita upgrade-insecure-requests em HTTP puro
  crossOriginOpenerPolicy: false,
  originAgentCluster: false,
}));
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    /^http:\/\/192\.168\.0\.\d+/,
  ],
  credentials: true,
}));
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/pagame', pagameRoutes);
app.use('/api/relrec', relrecRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/contas-pagar', contasPagarRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/cheques', chequesRoutes);
app.use('/api/entradas', entradasRoutes);
app.use('/api/dda', ddaRoutes);
app.use('/api/plano-contas', planoContasRoutes);
app.use('/api/shortcut', shortcutRoutes);
app.use('/api/inbox', inboxRoutes);
app.use('/api/contas-bancarias', contasBancariasRoutes);
app.use('/api/fornecedor-regras', fornecedorRegrasRoutes);
app.use('/api/conciliacao', conciliacaoRoutes);
app.use('/api/mp', mpRoutes);
app.use('/api/bb', bbRoutes);
app.use('/api/compras', comprasRoutes);
app.use('/api/ranking-vendas', rankingVendasRoutes);
app.use('/api/vendas-analitico', vendasAnaliticoRoutes);
app.use('/api/lojas', lojasRoutes);
app.use('/api/precos', precosRoutes);
app.use('/api/loja-info', lojaInfoRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../../frontend/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
  });
}

app.use((err, req, res, next) => {
  console.error('❌ Erro:', err.stack);
  const schemaOutdated = err?.code === 'ER_NO_SUCH_TABLE' || err?.code === 'ER_BAD_FIELD_ERROR';
  const message = schemaOutdated
    ? 'Estrutura do banco desatualizada. Rode as migrations pendentes e tente novamente.'
    : (process.env.NODE_ENV === 'development' ? err.message : 'Erro interno do servidor');
  res.status(err.status || 500).json({
    error: message,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack, code: err.code || null }),
  });
});

async function start() {
  console.log('\n🏢 Admin Financeiro - Iniciando...');
  console.log('─'.repeat(50));
  await testConnections();
  console.log('─'.repeat(50));
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 API rodando em http://0.0.0.0:${PORT}`);
    console.log(`📊 Health: http://localhost:${PORT}/api/health\n`);
    require('./services/mpScheduler').startMpScheduler();
  });
}

start();
