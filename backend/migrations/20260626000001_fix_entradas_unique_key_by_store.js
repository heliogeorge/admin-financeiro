async function indexExists(knex, tableName, indexName) {
  const result = await knex.raw(
    `SELECT COUNT(1) AS total
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND index_name = ?`,
    [tableName, indexName]
  );

  const rows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
  return Number(rows?.[0]?.total || 0) > 0;
}

exports.up = async function (knex) {
  const hasEntradas = await knex.schema.hasTable('entradas_mercadoria');
  if (!hasEntradas) return;

  const hasOldIndex = await indexExists(knex, 'entradas_mercadoria', 'uk_entrada_erp');
  if (hasOldIndex) {
    await knex.schema.alterTable('entradas_mercadoria', (table) => {
      table.dropUnique(['numerorr', 'codiempr'], 'uk_entrada_erp');
    });
  }

  const hasNewIndex = await indexExists(knex, 'entradas_mercadoria', 'uk_entrada_erp_loja');
  if (!hasNewIndex) {
    await knex.schema.alterTable('entradas_mercadoria', (table) => {
      table.unique(['numerorr', 'codiempr', 'codiloja'], 'uk_entrada_erp_loja');
    });
  }
};

exports.down = async function (knex) {
  const hasEntradas = await knex.schema.hasTable('entradas_mercadoria');
  if (!hasEntradas) return;

  const hasNewIndex = await indexExists(knex, 'entradas_mercadoria', 'uk_entrada_erp_loja');
  if (hasNewIndex) {
    await knex.schema.alterTable('entradas_mercadoria', (table) => {
      table.dropUnique(['numerorr', 'codiempr', 'codiloja'], 'uk_entrada_erp_loja');
    });
  }

  const duplicate = await knex('entradas_mercadoria')
    .select('numerorr', 'codiempr')
    .whereNotNull('numerorr')
    .groupBy('numerorr', 'codiempr')
    .havingRaw('COUNT(*) > 1')
    .first();

  const hasOldIndex = await indexExists(knex, 'entradas_mercadoria', 'uk_entrada_erp');
  if (!duplicate && !hasOldIndex) {
    await knex.schema.alterTable('entradas_mercadoria', (table) => {
      table.unique(['numerorr', 'codiempr'], 'uk_entrada_erp');
    });
  }
};
