async function hasForeignKey(knex, tableName, columnName, referencedTableName) {
  const result = await knex.raw(`
    SELECT CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
      AND REFERENCED_TABLE_NAME = ?
    LIMIT 1
  `, [tableName, columnName, referencedTableName]);

  const rows = result[0] || result;
  return Array.isArray(rows) && rows.length > 0;
}

async function hasIndex(knex, tableName, indexName) {
  const result = await knex.raw(`
    SELECT INDEX_NAME
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND INDEX_NAME = ?
    LIMIT 1
  `, [tableName, indexName]);

  const rows = result[0] || result;
  return Array.isArray(rows) && rows.length > 0;
}

exports.up = async function (knex) {
  const hasBaixas = await knex.schema.hasTable('contas_pagar_baixas');
  const hasDocumentos = await knex.schema.hasTable('contas_pagar_baixa_documentos');
  const hasDocumentoPagamentos = await knex.schema.hasTable('contas_pagar_baixa_documento_pagamentos');
  const hasContasBancarias = await knex.schema.hasTable('contas_bancarias');

  if (hasBaixas && hasDocumentos) {
    const hasDocumentoBaixaId = await knex.schema.hasColumn('contas_pagar_baixas', 'documento_baixa_id');
    if (!hasDocumentoBaixaId) {
      await knex.schema.alterTable('contas_pagar_baixas', (t) => {
        t.integer('documento_baixa_id').unsigned().nullable().after('conta_pagar_id');
      });
    }

    const baixasHasIndex = await hasIndex(knex, 'contas_pagar_baixas', 'idx_baixas_documento');
    if (!baixasHasIndex) {
      await knex.schema.alterTable('contas_pagar_baixas', (t) => {
        t.index(['documento_baixa_id'], 'idx_baixas_documento');
      });
    }

    const baixasHasFk = await hasForeignKey(
      knex,
      'contas_pagar_baixas',
      'documento_baixa_id',
      'contas_pagar_baixa_documentos'
    );
    if (!baixasHasFk) {
      await knex.schema.alterTable('contas_pagar_baixas', (t) => {
        t.foreign('documento_baixa_id', 'fk_baixas_documento_baixa')
          .references('id')
          .inTable('contas_pagar_baixa_documentos')
          .onDelete('SET NULL');
      });
    }
  }

  if (hasBaixas && hasContasBancarias) {
    const hasContaBancariaId = await knex.schema.hasColumn('contas_pagar_baixas', 'conta_bancaria_id');
    if (hasContaBancariaId) {
      const baixaContaFk = await hasForeignKey(
        knex,
        'contas_pagar_baixas',
        'conta_bancaria_id',
        'contas_bancarias'
      );
      if (!baixaContaFk) {
        await knex.schema.alterTable('contas_pagar_baixas', (t) => {
          t.foreign('conta_bancaria_id', 'fk_baixas_conta_bancaria')
            .references('id')
            .inTable('contas_bancarias')
            .onDelete('SET NULL');
        });
      }
    }
  }

  if (hasDocumentoPagamentos && hasContasBancarias) {
    const hasContaBancariaId = await knex.schema.hasColumn('contas_pagar_baixa_documento_pagamentos', 'conta_bancaria_id');
    if (hasContaBancariaId) {
      const docPagFk = await hasForeignKey(
        knex,
        'contas_pagar_baixa_documento_pagamentos',
        'conta_bancaria_id',
        'contas_bancarias'
      );
      if (!docPagFk) {
        await knex.schema.alterTable('contas_pagar_baixa_documento_pagamentos', (t) => {
          t.foreign('conta_bancaria_id', 'fk_baixa_doc_pagamento_conta_bancaria')
            .references('id')
            .inTable('contas_bancarias')
            .onDelete('SET NULL');
        });
      }
    }
  }
};

exports.down = async function () {
  // Migration de reconciliação: não remove estruturas no down.
};
