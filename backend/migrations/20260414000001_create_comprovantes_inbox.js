/**
 * Caixa de entrada de comprovantes enviados pelo Atalho iOS
 * sem vinculação imediata a uma conta a pagar.
 */
exports.up = function (knex) {
  return knex.schema.createTable('comprovantes_inbox', (t) => {
    t.increments('id').primary();
    t.string('arquivo_path', 500).notNullable();
    t.integer('conta_pagar_id').unsigned().nullable()
      .references('id').inTable('contas_pagar').onDelete('SET NULL');
    t.string('observacao', 500).nullable();
    t.boolean('vinculado').defaultTo(false);
    t.timestamp('criado_em').defaultTo(knex.fn.now());
    t.timestamp('vinculado_em').nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('comprovantes_inbox');
};
