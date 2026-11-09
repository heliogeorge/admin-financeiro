/**
 * F2 da remodelagem do Contas a Pagar — Cadastro de Fornecedores.
 *
 * `fornecedores`: espelho do CADFOR do ERP (campos-base sincronizados, somente
 * leitura) + campos de REGRA do app (complemento "por fora", aliases), que o
 * sync nunca sobrescreve.
 *
 * `contas_pagar` ganha:
 *  - tipo_titulo: duplicata (boleto/parcela do ERP, default) | complemento
 *    ("por fora", gerado na F3) | avulso (manual sem NF)
 *  - fornecedor_id: fk para o cadastro novo (backfill via codiforn no sync)
 */
exports.up = async function (knex) {
  const hasFornecedores = await knex.schema.hasTable('fornecedores');
  if (!hasFornecedores) {
    await knex.schema.createTable('fornecedores', (t) => {
      t.increments('id').primary();

      // ===== espelho do ERP (CADFOR) — atualizado pelo sync =====
      t.string('codiforn', 10).notNullable().unique('uk_fornecedores_codiforn');
      t.string('nome', 80).notNullable();
      t.string('razao_social', 120).nullable();
      t.string('cnpj_cpf', 20).nullable();
      t.string('cidade', 40).nullable();
      t.string('uf', 2).nullable();
      t.string('telefone', 20).nullable();
      t.string('email', 250).nullable();
      t.string('situacao_erp', 1).nullable(); // A = ativo no ERP
      t.datetime('ultima_sync_at').nullable();

      // ===== regras do app — NUNCA sobrescritas pelo sync =====
      t.text('aliases').nullable(); // nomes alternativos p/ match em extrato/DDA (um por linha)
      t.enum('complemento_tipo', ['nenhum', 'fator', 'valor_informado'])
        .notNullable().defaultTo('nenhum');
      t.decimal('complemento_fator', 8, 4).nullable(); // ex.: 0.30 = +30% sobre a base
      t.enum('complemento_base', ['total_faturado', 'total_produtos'])
        .notNullable().defaultTo('total_faturado');
      t.enum('complemento_vencimento', ['junto_parcelas', 'data_fixa'])
        .notNullable().defaultTo('junto_parcelas');
      t.integer('complemento_dias').nullable(); // p/ data_fixa: venc = entrada + N dias
      t.text('complemento_obs').nullable();
      t.boolean('ativo').notNullable().defaultTo(true);

      t.timestamp('criado_em').defaultTo(knex.fn.now());
      t.timestamp('atualizado_em').defaultTo(knex.fn.now());
      t.string('atualizado_por', 50).nullable();

      t.index(['nome'], 'idx_fornecedores_nome');
    });
  }

  const hasTipoTitulo = await knex.schema.hasColumn('contas_pagar', 'tipo_titulo');
  const hasFornecedorId = await knex.schema.hasColumn('contas_pagar', 'fornecedor_id');
  if (!hasTipoTitulo || !hasFornecedorId) {
    await knex.schema.alterTable('contas_pagar', (t) => {
      if (!hasTipoTitulo) {
        t.enum('tipo_titulo', ['duplicata', 'complemento', 'avulso'])
          .notNullable().defaultTo('duplicata');
      }
      if (!hasFornecedorId) {
        t.integer('fornecedor_id').unsigned().nullable()
          .references('id').inTable('fornecedores').onDelete('SET NULL');
        t.index(['fornecedor_id'], 'idx_contas_pagar_fornecedor_id');
      }
    });
  }
};

exports.down = async function (knex) {
  const hasFornecedorId = await knex.schema.hasColumn('contas_pagar', 'fornecedor_id');
  const hasTipoTitulo = await knex.schema.hasColumn('contas_pagar', 'tipo_titulo');
  if (hasFornecedorId || hasTipoTitulo) {
    await knex.schema.alterTable('contas_pagar', (t) => {
      if (hasFornecedorId) {
        t.dropForeign(['fornecedor_id']);
        t.dropIndex(['fornecedor_id'], 'idx_contas_pagar_fornecedor_id');
        t.dropColumn('fornecedor_id');
      }
      if (hasTipoTitulo) t.dropColumn('tipo_titulo');
    });
  }
  await knex.schema.dropTableIfExists('fornecedores');
};
