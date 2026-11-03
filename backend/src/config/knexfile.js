require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

module.exports = {
  development: {
    client: 'mysql',
    connection: {
      host: process.env.ADMIN_DB_HOST,
      port: parseInt(process.env.ADMIN_DB_PORT, 10),
      database: process.env.ADMIN_DB_NAME,
      user: process.env.ADMIN_DB_USER,
      password: process.env.ADMIN_DB_PASS,
      charset: 'utf8mb4',
      dateStrings: ['DATE'],
    },
    migrations: {
      directory: '../../migrations',
    },
    pool: { min: 2, max: 10 },
  },
  production: {
    client: 'mysql',
    connection: {
      host: process.env.ADMIN_DB_HOST,
      port: parseInt(process.env.ADMIN_DB_PORT, 10),
      database: process.env.ADMIN_DB_NAME,
      user: process.env.ADMIN_DB_USER,
      password: process.env.ADMIN_DB_PASS,
      charset: 'utf8mb4',
      dateStrings: ['DATE'],
    },
    migrations: {
      directory: '../../migrations',
    },
    pool: { min: 2, max: 10 },
  },
};
