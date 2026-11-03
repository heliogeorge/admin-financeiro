/**
 * Relatórios "dinheiro em conta" do MercadoPago.
 *
 * mp_relatorios: controle dos arquivos CSV já importados (1 por dia, gerados
 * pelo próprio MP via agendamento da API de relatórios).
 *
 * mp_movimentos: cada linha do relatório = uma movimentação que impactou o
 * saldo da conta MP (SETTLEMENT_NET_AMOUNT, com sinal). O saldo correto da
 * conta é saldo_inicial + soma dos net_amount posteriores à data do saldo.
 * Dedupe por row_hash, pois relatórios sob demanda podem sobrepor os diários
 * e o SOURCE_ID nem sempre é o id do payment.
 */
exports.up = async function (knex) {
  const hasRelatorios = await knex.schema.hasTable('mp_relatorios');
  if (!hasRelatorios) {
    await knex.schema.createTable('mp_relatorios', (t) => {
      t.increments('id').primary();
      t.string('empresa_slug', 30).notNullable();
      t.string('file_name', 180).notNullable();
      t.datetime('begin_date').nullable();
      t.datetime('end_date').nullable();
      t.string('created_from', 20).nullable(); // manual | schedule
      t.integer('linhas').notNullable().defaultTo(0);
      t.integer('inseridos').notNullable().defaultTo(0);
      t.datetime('importado_em').notNullable().defaultTo(knex.fn.now());
      t.string('importado_por', 50).nullable();

      t.unique(['empresa_slug', 'file_name'], 'uk_mp_relatorio_arquivo');
    });
  }

  const hasMovimentos = await knex.schema.hasTable('mp_movimentos');
  if (!hasMovimentos) {
    await knex.schema.createTable('mp_movimentos', (t) => {
      t.increments('id').primary();
      t.integer('conta_bancaria_id').unsigned().notNullable()
        .references('id').inTable('contas_bancarias').onDelete('CASCADE');
      t.string('empresa_slug', 30).notNullable();

      t.string('source_id', 80).nullable();
      t.string('external_reference', 120).nullable();
      t.string('transaction_type', 40).notNullable();   // SETTLEMENT, PAYOUTS, REFUND...
      t.datetime('transaction_date').notNullable();     // horário local (GMT-03)
      t.decimal('amount', 14, 2).notNullable();         // TRANSACTION_AMOUNT (com sinal)
      t.decimal('fee', 14, 2).notNullable().defaultTo(0);
      t.decimal('net_amount', 14, 2).notNullable();     // impacto real no saldo
      t.string('payment_method', 40).nullable();
      t.string('payment_method_type', 40).nullable();
      t.string('descricao', 255).nullable();
      t.string('file_name', 180).notNullable();
      t.string('row_hash', 40).notNullable();

      t.unique(['conta_bancaria_id', 'row_hash'], 'uk_mp_mov_hash');
      t.index(['conta_bancaria_id', 'transaction_date'], 'idx_mp_mov_conta_data');
      t.index(['source_id'], 'idx_mp_mov_source');
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('mp_movimentos');
  await knex.schema.dropTableIfExists('mp_relatorios');
};
