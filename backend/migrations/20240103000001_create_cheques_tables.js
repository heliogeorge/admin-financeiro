/**
 * Migration: Tabelas de controle de cheques
 * 
 * cheques - Cada cheque emitido
 * cheques_contas - Vínculo N:N entre cheques e contas_pagar
 * 
 * Fluxo: Fornecedor vem receber → seleciona várias contas →
 *        cria 1 ou mais cheques pré-datados → vincula aos pagamentos
 */

exports.up = async function (knex) {
  // Tabela de cheques
  await knex.schema.createTable('cheques', (table) => {
    table.increments('id').primary();
    table.string('numero_cheque', 20).notNullable();
    table.string('banco', 50).nullable();
    table.string('agencia', 10).nullable();
    table.string('conta', 15).nullable();
    table.string('fornecedor', 100).notNullable();
    table.string('erp_fornecedor_id', 10).nullable();
    table.decimal('valor', 12, 2).notNullable();
    table.date('data_emissao').notNullable();
    table.date('data_bom_para').notNullable().comment('Data pré-datada do cheque');
    table.enum('status', ['emitido', 'compensado', 'devolvido', 'cancelado', 'reapresentado'])
      .defaultTo('emitido');
    table.date('data_compensacao').nullable();
    table.string('codiloja', 2).nullable();
    table.text('observacoes').nullable();
    table.string('criado_por', 50).nullable();
    table.string('atualizado_por', 50).nullable();
    table.timestamps(true, true);

    table.index(['fornecedor'], 'idx_cheques_fornecedor');
    table.index(['data_bom_para'], 'idx_cheques_data_bom');
    table.index(['status'], 'idx_cheques_status');
    table.index(['numero_cheque'], 'idx_cheques_numero');
  });

  // Tabela de vínculo cheque ↔ contas a pagar (N:N)
  await knex.schema.createTable('cheques_contas', (table) => {
    table.increments('id').primary();
    table.integer('cheque_id').unsigned().notNullable()
      .references('id').inTable('cheques').onDelete('CASCADE');
    table.integer('conta_pagar_id').unsigned().notNullable()
      .references('id').inTable('contas_pagar').onDelete('CASCADE');
    table.decimal('valor_vinculado', 12, 2).nullable()
      .comment('Parcela desta conta coberta por este cheque');
    table.timestamps(true, true);

    table.unique(['cheque_id', 'conta_pagar_id'], 'uk_cheque_conta');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('cheques_contas');
  await knex.schema.dropTableIfExists('cheques');
};
