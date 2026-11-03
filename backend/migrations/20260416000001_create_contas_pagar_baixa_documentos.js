/**
 * Documentos de baixa para pagamentos em lote ou com múltiplas formas.
 *
 * - contas_pagar_baixa_documentos: cabeçalho do documento
 * - contas_pagar_baixa_documento_pagamentos: linhas/formas de pagamento
 * - contas_pagar_baixas.documento_baixa_id: vínculo de cada baixa ao documento
 */
exports.up = async function (knex) {
  const hasDocumentos = await knex.schema.hasTable('contas_pagar_baixa_documentos');
  if (!hasDocumentos) {
    await knex.schema.createTable('contas_pagar_baixa_documentos', (t) => {
      t.increments('id').primary();
      t.string('codigo', 30).nullable().unique();
      t.date('data_documento').notNullable();
      t.integer('quantidade_contas').unsigned().notNullable().defaultTo(0);
      t.decimal('total_contas', 12, 2).notNullable().defaultTo(0);
      t.decimal('total_pagamentos', 12, 2).notNullable().defaultTo(0);
      t.text('observacoes').nullable();

      t.enum('status', ['ativo', 'estornado']).notNullable().defaultTo('ativo');
      t.datetime('estornado_em').nullable();
      t.string('estornado_por', 50).nullable();
      t.string('estorno_motivo', 255).nullable();

      t.string('criado_por', 50).nullable();
      t.string('atualizado_por', 50).nullable();
      t.timestamps(true, true);

      t.index(['data_documento'], 'idx_baixa_docs_data');
      t.index(['status'], 'idx_baixa_docs_status');
    });
  }

  const hasPagamentos = await knex.schema.hasTable('contas_pagar_baixa_documento_pagamentos');
  if (!hasPagamentos) {
    await knex.schema.createTable('contas_pagar_baixa_documento_pagamentos', (t) => {
      t.increments('id').primary();
      t.integer('documento_baixa_id').unsigned().notNullable();
      t.integer('ordem').unsigned().notNullable().defaultTo(1);
      t.string('forma_pagamento', 40).notNullable();
      t.decimal('valor', 12, 2).notNullable().defaultTo(0);
      t.integer('conta_bancaria_id').unsigned().nullable();
      t.string('banco_baixa', 120).nullable();
      t.string('referencia_externa', 120).nullable();
      t.text('observacoes').nullable();
      t.timestamps(true, true);

      t.foreign('documento_baixa_id', 'fk_baixa_doc_pag_doc')
        .references('id')
        .inTable('contas_pagar_baixa_documentos')
        .onDelete('CASCADE');

      t.index(['documento_baixa_id'], 'idx_baixa_doc_pagamentos_doc');
      t.index(['forma_pagamento'], 'idx_baixa_doc_pagamentos_forma');
    });
  }
  const pagamentosProntos = hasPagamentos || await knex.schema.hasTable('contas_pagar_baixa_documento_pagamentos');

  const hasBaixas = await knex.schema.hasTable('contas_pagar_baixas');
  if (hasBaixas) {
    const hasDocumentoBaixaId = await knex.schema.hasColumn('contas_pagar_baixas', 'documento_baixa_id');
    if (!hasDocumentoBaixaId) {
      await knex.schema.alterTable('contas_pagar_baixas', (t) => {
        t.integer('documento_baixa_id').unsigned().nullable().after('conta_pagar_id');
      });
      await knex.schema.alterTable('contas_pagar_baixas', (t) => {
        t.foreign('documento_baixa_id', 'fk_baixas_documento_baixa')
          .references('id')
          .inTable('contas_pagar_baixa_documentos')
          .onDelete('SET NULL');
        t.index(['documento_baixa_id'], 'idx_baixas_documento');
      });
    }
  }

  const hasContasBancarias = await knex.schema.hasTable('contas_bancarias');
  if (pagamentosProntos && hasContasBancarias) {
    const fkName = 'fk_baixa_doc_pagamento_conta_bancaria';
    const hasFk = await knex.raw(`
      SELECT CONSTRAINT_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'contas_pagar_baixa_documento_pagamentos'
        AND COLUMN_NAME = 'conta_bancaria_id'
        AND REFERENCED_TABLE_NAME = 'contas_bancarias'
      LIMIT 1
    `);
    const rows = hasFk[0] || hasFk;
    if (!Array.isArray(rows) || rows.length === 0) {
      await knex.schema.alterTable('contas_pagar_baixa_documento_pagamentos', (t) => {
        t.foreign('conta_bancaria_id', fkName)
          .references('id')
          .inTable('contas_bancarias')
          .onDelete('SET NULL');
      });
    }
  }
};

exports.down = async function (knex) {
  const hasBaixas = await knex.schema.hasTable('contas_pagar_baixas');
  if (hasBaixas) {
    const hasDocumentoBaixaId = await knex.schema.hasColumn('contas_pagar_baixas', 'documento_baixa_id');
    if (hasDocumentoBaixaId) {
      await knex.schema.alterTable('contas_pagar_baixas', (t) => {
        t.dropForeign(['documento_baixa_id'], 'fk_baixas_documento_baixa');
        t.dropIndex(['documento_baixa_id'], 'idx_baixas_documento');
      });
      await knex.schema.alterTable('contas_pagar_baixas', (t) => {
        t.dropColumn('documento_baixa_id');
      });
    }
  }

  const hasPagamentos = await knex.schema.hasTable('contas_pagar_baixa_documento_pagamentos');
  if (hasPagamentos) {
    await knex.schema.dropTableIfExists('contas_pagar_baixa_documento_pagamentos');
  }

  await knex.schema.dropTableIfExists('contas_pagar_baixa_documentos');
};
