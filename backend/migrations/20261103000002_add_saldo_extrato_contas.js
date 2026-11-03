/**
 * Saldo informado pelo extrato (LEDGERBAL do OFX): snapshot do saldo da conta
 * na data do extrato importado. Para contas sem integração (Itaú via OFX),
 * passa a ser a fonte do "saldo estimado" na listagem.
 */
exports.up = async function (knex) {
  const has = await knex.schema.hasColumn('contas_bancarias', 'saldo_extrato');
  if (!has) {
    await knex.schema.alterTable('contas_bancarias', (t) => {
      t.decimal('saldo_extrato', 14, 2).nullable();
      t.date('data_saldo_extrato').nullable();
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.alterTable('contas_bancarias', (t) => {
    t.dropColumn('saldo_extrato');
    t.dropColumn('data_saldo_extrato');
  });
};
