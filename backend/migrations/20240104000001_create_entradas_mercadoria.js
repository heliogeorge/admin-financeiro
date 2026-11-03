/**
 * Migration: Entradas de mercadoria sincronizadas + vínculo com contas a pagar
 */

exports.up = async function (knex) {
  await knex.schema.createTable('entradas_mercadoria', (table) => {
    table.increments('id').primary();
    table.string('origem', 10).defaultTo('erp');

    // Chave do ERP
    table.string('numerorr', 20).nullable();
    table.string('codiempr', 2).nullable();
    table.string('codiloja', 2).nullable();

    // Nota fiscal
    table.string('numeronf', 15).nullable();
    table.string('nfe_chav', 60).nullable();

    // Fornecedor
    table.string('codiforn', 10).nullable();
    table.string('fornecedor', 100).nullable();

    // Datas
    table.date('data_emissao').nullable();
    table.date('data_entrada').nullable();

    // Valores (editáveis)
    table.decimal('total_produtos', 14, 2).defaultTo(0);
    table.decimal('total_faturado', 14, 2).defaultTo(0);
    table.decimal('valor_icms', 14, 2).defaultTo(0);
    table.decimal('valor_ipi', 14, 2).defaultTo(0);
    table.decimal('valor_frete', 14, 2).defaultTo(0);
    table.decimal('valor_seguro', 14, 2).defaultTo(0);
    table.decimal('valor_desconto', 14, 2).defaultTo(0);

    // Dados do ERP
    table.string('tipo_entrada', 30).nullable();
    table.string('natureza', 10).nullable();
    table.string('cond_pagamento', 60).nullable();
    table.string('cod_pagamento', 5).nullable();
    table.string('pedido_compra', 10).nullable();
    table.text('observacoes').nullable();

    // Controle de pagamento
    table.enum('status_pagamento', ['em_aberto', 'parcial', 'pago']).defaultTo('em_aberto');

    // Sync
    table.string('sync_hash', 64).nullable();
    table.datetime('ultima_sync_at').nullable();
    table.string('criado_por', 50).nullable();
    table.string('atualizado_por', 50).nullable();
    table.timestamps(true, true);

    table.unique(['numerorr', 'codiempr'], { indexName: 'uk_entrada_erp' });
    table.index(['codiforn'], 'idx_ent_fornecedor');
    table.index(['data_emissao'], 'idx_ent_data');
    table.index(['numeronf'], 'idx_ent_nf');
    table.index(['status_pagamento'], 'idx_ent_status_pgto');
  });

  // Vínculo N:N entre entradas e contas a pagar
  await knex.schema.createTable('entradas_contas', (table) => {
    table.increments('id').primary();
    table.integer('entrada_id').unsigned().notNullable()
      .references('id').inTable('entradas_mercadoria').onDelete('CASCADE');
    table.integer('conta_pagar_id').unsigned().notNullable()
      .references('id').inTable('contas_pagar').onDelete('CASCADE');
    table.timestamps(true, true);

    table.unique(['entrada_id', 'conta_pagar_id'], 'uk_entrada_conta');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('entradas_contas');
  await knex.schema.dropTableIfExists('entradas_mercadoria');
};
