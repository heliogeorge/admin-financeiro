/**
 * Adiciona 'mercadopago' ao enum de origem das baixas, para conciliação
 * de pagamentos sincronizados da API do MercadoPago.
 */
exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE contas_pagar_baixas
    MODIFY origem ENUM('manual', 'ofx', 'lote', 'cheque', 'estorno_ajuste', 'mercadopago')
    NOT NULL DEFAULT 'manual'
  `);
};

exports.down = async function (knex) {
  await knex('contas_pagar_baixas').where('origem', 'mercadopago').update({ origem: 'ofx' });
  await knex.raw(`
    ALTER TABLE contas_pagar_baixas
    MODIFY origem ENUM('manual', 'ofx', 'lote', 'cheque', 'estorno_ajuste')
    NOT NULL DEFAULT 'manual'
  `);
};
