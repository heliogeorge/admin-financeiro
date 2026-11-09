/**
 * F4 da remodelagem — baixa em lote: 1 extrato → N baixas.
 *
 * O vínculo extrato↔baixa deixa de ser 1:1 (extratos_bancarios.baixa_id) e
 * passa a morar na baixa (contas_pagar_baixas.extrato_id), permitindo que um
 * depósito quite várias contas (caso: "por fora" de várias notas do mês).
 *
 *  - backfill: extrato_id preenchido a partir do baixa_id legado (mantido);
 *  - status novo 'parcial' no extrato: soma das baixas ainda < valor.
 */
exports.up = async function (knex) {
  const hasExtratoId = await knex.schema.hasColumn('contas_pagar_baixas', 'extrato_id');
  if (!hasExtratoId) {
    await knex.schema.alterTable('contas_pagar_baixas', (t) => {
      t.integer('extrato_id').unsigned().nullable()
        .references('id').inTable('extratos_bancarios').onDelete('SET NULL');
      t.index(['extrato_id'], 'idx_baixas_extrato_id');
    });

    await knex.raw(`
      UPDATE contas_pagar_baixas b
      JOIN extratos_bancarios e ON e.baixa_id = b.id
      SET b.extrato_id = e.id
      WHERE b.extrato_id IS NULL
    `);
  }

  // enum do status do extrato ganha 'parcial'
  await knex.raw(`
    ALTER TABLE extratos_bancarios
    MODIFY status ENUM('pendente','conciliado','ignorado','divergente','parcial')
    NOT NULL DEFAULT 'pendente'
  `);
};

exports.down = async function (knex) {
  await knex('extratos_bancarios').where('status', 'parcial').update({ status: 'pendente' });
  await knex.raw(`
    ALTER TABLE extratos_bancarios
    MODIFY status ENUM('pendente','conciliado','ignorado','divergente')
    NOT NULL DEFAULT 'pendente'
  `);

  const hasExtratoId = await knex.schema.hasColumn('contas_pagar_baixas', 'extrato_id');
  if (hasExtratoId) {
    await knex.schema.alterTable('contas_pagar_baixas', (t) => {
      t.dropForeign(['extrato_id']);
      t.dropIndex(['extrato_id'], 'idx_baixas_extrato_id');
      t.dropColumn('extrato_id');
    });
  }
};
