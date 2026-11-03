const knex = require('knex');
require('dotenv').config();

// ============================================
// Conexão ERP - SOMENTE LEITURA
// Banco existente do ERP (SAS)
// ============================================
const erpDb = knex({
  client: 'mysql',
  connection: {
    host: process.env.ERP_DB_HOST,
    port: parseInt(process.env.ERP_DB_PORT, 10),
    database: process.env.ERP_DB_NAME,
    user: process.env.ERP_DB_USER,
    password: process.env.ERP_DB_PASS,
    charset: 'utf8mb4',
    dateStrings: ['DATE'],
    // Timeout configs para rede local
    connectTimeout: 10000,
    // Força somente leitura na camada da aplicação
    // (além do user MySQL ser read-only)
  },
pool: {
  min: 0,           
  max: 10,
  acquireTimeoutMillis: 30000,
  createTimeoutMillis: 10000,
  idleTimeoutMillis: 600000,
  createRetryIntervalMillis: 5000,
  propagateCreateError: false,
},
  // Log de queries em desenvolvimento
  debug: process.env.NODE_ENV === 'development',
});

const erpLoja2Db = process.env.ERP_LOJA2_DB_HOST ? knex({
  client: 'mysql',
  connection: {
    host: process.env.ERP_LOJA2_DB_HOST,
    port: parseInt(process.env.ERP_LOJA2_DB_PORT || process.env.ERP_DB_PORT, 10),
    database: process.env.ERP_LOJA2_DB_NAME || process.env.ERP_DB_NAME,
    user: process.env.ERP_LOJA2_DB_USER || process.env.ERP_DB_USER,
    password: process.env.ERP_LOJA2_DB_PASS || process.env.ERP_DB_PASS,
    charset: 'utf8mb4',
    dateStrings: ['DATE'],
    connectTimeout: 10000,
  },
  pool: {
    min: 0,
    max: 10,
    acquireTimeoutMillis: 30000,
    createTimeoutMillis: 10000,
    idleTimeoutMillis: 600000,
    createRetryIntervalMillis: 5000,
    propagateCreateError: false,
  },
  debug: process.env.NODE_ENV === 'development',
}) : null;

// ============================================
// Conexão Admin - LEITURA E ESCRITA
// Banco novo para módulos administrativos
// ============================================
const adminDb = knex({
  client: 'mysql',
  connection: {
    host: process.env.ADMIN_DB_HOST,
    port: parseInt(process.env.ADMIN_DB_PORT, 10),
    database: process.env.ADMIN_DB_NAME,
    user: process.env.ADMIN_DB_USER,
    password: process.env.ADMIN_DB_PASS,
    charset: 'utf8mb4',
    dateStrings: ['DATE'],
    connectTimeout: 10000,
  },
  pool: {
    min: 2,
    max: 10,
  },
  migrations: {
    directory: '../migrations',
    tableName: 'knex_migrations',
  },
  debug: process.env.NODE_ENV === 'development',
});

// Testar conexões na inicialização
async function testConnections() {
  try {
    await erpDb.raw('SELECT 1');
    console.log('✅ Conexão ERP (SAS) estabelecida com sucesso');
  } catch (err) {
    console.error('❌ Falha na conexão ERP:', err.message);
    console.error('   Verifique ERP_DB_HOST, porta e credenciais no .env');
  }

  if (erpLoja2Db) {
    try {
      await erpLoja2Db.raw('SELECT 1');
      console.log('Conexao ERP Loja 2 (SAS) estabelecida com sucesso');
    } catch (err) {
      console.error('Falha na conexao ERP Loja 2:', err.message);
      console.error('   Verifique ERP_LOJA2_DB_HOST, porta e credenciais no .env');
    }
  }

  try {
    await adminDb.raw('SELECT 1');
    console.log('✅ Conexão Admin estabelecida com sucesso');
  } catch (err) {
    console.warn('⚠️  Falha na conexão Admin:', err.message);
    console.warn('   O banco admin_financeiro pode ainda não existir.');
    console.warn('   Execute: CREATE DATABASE admin_financeiro;');
  }
}

module.exports = { erpDb, erpLoja2Db, adminDb, testConnections };
