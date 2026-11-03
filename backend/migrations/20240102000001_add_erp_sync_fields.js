/**
 * Migration: Adicionar campos de sincronização ERP
 * 
 * Adiciona campos para suportar a importação do PAGAME
 * e distinguir contas criadas manualmente vs importadas do ERP
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('contas_pagar', (table) => {
    // Origem do registro
    table.enum('origem', ['erp', 'manual']).defaultTo('manual').after('status');

    // Dados do ERP
    table.string('codiloja', 2).nullable().after('origem');
    table.string('codiempr', 2).nullable().after('codiloja');
    table.date('data_emissao').nullable().after('data_pagamento');
    table.string('documento', 15).nullable().after('descricao');
    table.string('historico', 60).nullable().after('documento');
    table.string('referencia', 15).nullable().after('historico');

    // Dados de baixa do ERP
    table.string('banco_baixa', 3).nullable();
    table.string('doc_baixa', 15).nullable();

    // Valores extras do ERP
    table.decimal('valor_desconto', 12, 2).defaultTo(0);
    table.decimal('valor_juros', 12, 2).defaultTo(0);

    // Controle de sincronização
    table.datetime('ultima_sync_at').nullable();
    table.string('sync_hash', 64).nullable().comment('Hash dos dados ERP para detectar mudanças');

    // Índice único para evitar duplicatas na sync
    table.unique(['erp_lancamento', 'codiempr'], { indexName: 'uk_erp_lancamento' });
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('contas_pagar', (table) => {
    table.dropUnique(['erp_lancamento', 'codiempr'], 'uk_erp_lancamento');
    table.dropColumns([
      'origem', 'codiloja', 'codiempr', 'data_emissao',
      'documento', 'historico', 'referencia',
      'banco_baixa', 'doc_baixa',
      'valor_desconto', 'valor_juros',
      'ultima_sync_at', 'sync_hash',
    ]);
  });
};
