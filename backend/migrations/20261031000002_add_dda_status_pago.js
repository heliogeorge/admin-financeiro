/**
 * Status 'pago' para boletos DDA detectados como pagos via MercadoPago,
 * com data e referência do pagamento (fit_id do extrato).
 */
exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE dda_documentos
    MODIFY status ENUM('novo', 'sugerido', 'confirmado', 'divergente', 'descartado', 'pago')
    NOT NULL DEFAULT 'novo'
  `);

  const hasPagoEm = await knex.schema.hasColumn('dda_documentos', 'pago_em');
  if (!hasPagoEm) {
    await knex.schema.alterTable('dda_documentos', (t) => {
      t.date('pago_em').nullable();
      t.string('pago_ref', 80).nullable(); // ex: fit_id do extrato MP
    });
  }
};

exports.down = async function (knex) {
  await knex('dda_documentos').where('status', 'pago').update({ status: 'confirmado' });
  await knex.raw(`
    ALTER TABLE dda_documentos
    MODIFY status ENUM('novo', 'sugerido', 'confirmado', 'divergente', 'descartado')
    NOT NULL DEFAULT 'novo'
  `);
  await knex.schema.alterTable('dda_documentos', (t) => {
    t.dropColumn('pago_em');
    t.dropColumn('pago_ref');
  });
};
