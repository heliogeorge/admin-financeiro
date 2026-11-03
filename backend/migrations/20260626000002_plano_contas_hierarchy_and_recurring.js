async function indexExists(knex, tableName, indexName) {
  const result = await knex.raw(
    `SELECT COUNT(1) AS total
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND index_name = ?`,
    [tableName, indexName]
  );
  const rows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
  return Number(rows?.[0]?.total || 0) > 0;
}

async function ensureColumn(knex, tableName, columnName, addColumn) {
  const hasColumn = await knex.schema.hasColumn(tableName, columnName);
  if (!hasColumn) {
    await knex.schema.alterTable(tableName, addColumn);
  }
}

exports.up = async function (knex) {
  const hasPlano = await knex.schema.hasTable('plano_contas_erp');
  if (hasPlano) {
    await ensureColumn(knex, 'plano_contas_erp', 'codiempr', (table) => table.string('codiempr', 2).nullable().after('id'));
    await ensureColumn(knex, 'plano_contas_erp', 'codiloja', (table) => table.string('codiloja', 2).nullable().after('codiempr'));
    await ensureColumn(knex, 'plano_contas_erp', 'codigo_pai', (table) => table.string('codigo_pai', 30).nullable().after('codigo_erp'));
    await ensureColumn(knex, 'plano_contas_erp', 'nivel', (table) => table.integer('nivel').notNullable().defaultTo(1).after('codigo_pai'));
    await ensureColumn(knex, 'plano_contas_erp', 'analitica', (table) => table.boolean('analitica').notNullable().defaultTo(true).after('nivel'));
    await ensureColumn(knex, 'plano_contas_erp', 'pagareci', (table) => table.string('pagareci', 1).nullable().after('tipo'));
    await ensureColumn(knex, 'plano_contas_erp', 'codibala', (table) => table.string('codibala', 3).nullable().after('pagareci'));
    await ensureColumn(knex, 'plano_contas_erp', 'codi_dre', (table) => table.string('codi_dre', 3).nullable().after('codibala'));
    await ensureColumn(knex, 'plano_contas_erp', 'codifscf', (table) => table.string('codifscf', 3).nullable().after('codi_dre'));
    await ensureColumn(knex, 'plano_contas_erp', 'codiccus', (table) => table.string('codiccus', 3).nullable().after('codifscf'));
    await ensureColumn(knex, 'plano_contas_erp', 'diasvenc', (table) => table.integer('diasvenc').notNullable().defaultTo(0).after('codiccus'));
    await ensureColumn(knex, 'plano_contas_erp', 'contproj', (table) => table.string('contproj', 30).nullable().after('diasvenc'));

    const hasOldUnique = await indexExists(knex, 'plano_contas_erp', 'uk_plano_contas_codigo');
    if (hasOldUnique) {
      await knex.schema.alterTable('plano_contas_erp', (table) => {
        table.dropUnique(['codigo_erp'], 'uk_plano_contas_codigo');
      });
    }

    const hasNewUnique = await indexExists(knex, 'plano_contas_erp', 'uk_plano_contas_empresa_loja_codigo');
    if (!hasNewUnique) {
      await knex.schema.alterTable('plano_contas_erp', (table) => {
        table.unique(['codiempr', 'codiloja', 'codigo_erp'], 'uk_plano_contas_empresa_loja_codigo');
        table.index(['codigo_pai'], 'idx_plano_contas_pai');
        table.index(['analitica'], 'idx_plano_contas_analitica');
      });
    }
  }

  const hasRecorrentes = await knex.schema.hasTable('contas_recorrentes');
  if (!hasRecorrentes) {
    await knex.schema.createTable('contas_recorrentes', (table) => {
      table.increments('id').primary();
      table.string('fornecedor', 200).notNullable();
      table.text('descricao').nullable();
      table.decimal('valor', 12, 2).notNullable().defaultTo(0);
      table.integer('dia_vencimento').unsigned().notNullable().defaultTo(1);
      table.enum('frequencia', ['mensal']).notNullable().defaultTo('mensal');
      table.date('proxima_data').nullable();
      table.string('forma_pagamento', 50).nullable();
      table.string('codiloja', 2).nullable();
      table.enum('natureza', ['mercadoria', 'despesa_geral', 'nao_classificada'])
        .notNullable()
        .defaultTo('despesa_geral');
      table.integer('plano_conta_id').unsigned().nullable()
        .references('id').inTable('plano_contas_erp').onDelete('SET NULL');
      table.integer('categoria_id').unsigned().nullable()
        .references('id').inTable('categorias').onDelete('SET NULL');
      table.boolean('ativo').notNullable().defaultTo(true);
      table.integer('meses_antecedencia').unsigned().notNullable().defaultTo(1);
      table.text('observacoes').nullable();
      table.string('criado_por', 50).nullable();
      table.string('atualizado_por', 50).nullable();
      table.timestamps(true, true);

      table.index(['ativo', 'proxima_data'], 'idx_recorrentes_ativo_data');
      table.index(['plano_conta_id'], 'idx_recorrentes_plano');
    });
  }

  await ensureColumn(knex, 'contas_pagar', 'recorrencia_id', (table) => {
    table.integer('recorrencia_id').unsigned().nullable()
      .references('id').inTable('contas_recorrentes').onDelete('SET NULL');
  });
};

exports.down = async function (knex) {
  const hasContas = await knex.schema.hasTable('contas_pagar');
  if (hasContas && await knex.schema.hasColumn('contas_pagar', 'recorrencia_id')) {
    await knex.schema.alterTable('contas_pagar', (table) => {
      table.dropColumn('recorrencia_id');
    });
  }

  await knex.schema.dropTableIfExists('contas_recorrentes');
};
