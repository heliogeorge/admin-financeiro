/**
 * Cadastro de contas bancárias (para conciliação OFX e seleção de origem
 * do pagamento) e regras automáticas de juros/multa por fornecedor.
 *
 * Também cria a ligação (FK) da nova coluna conta_bancaria_id em
 * contas_pagar_baixas com esta tabela.
 */
exports.up = async function (knex) {
  const hasContasBancarias = await knex.schema.hasTable('contas_bancarias');
  if (!hasContasBancarias) {
    await knex.schema.createTable('contas_bancarias', (t) => {
      t.increments('id').primary();
      t.string('nome', 120).notNullable();        // Ex: "Itaú Matriz"
      t.string('banco_codigo', 10).nullable();    // Ex: "341"
      t.string('banco_nome', 80).nullable();      // Ex: "Itaú"
      t.string('agencia', 20).nullable();
      t.string('conta', 30).nullable();
      t.enum('tipo', ['corrente', 'poupanca', 'aplicacao', 'caixa'])
        .notNullable()
        .defaultTo('corrente');
      t.string('codiloja', 10).nullable();
      t.decimal('saldo_inicial', 14, 2).notNullable().defaultTo(0);
      t.date('data_saldo_inicial').nullable();
      t.boolean('ativo').notNullable().defaultTo(true);
      t.string('observacoes', 500).nullable();
      t.timestamps(true, true);

      t.index(['ativo'], 'idx_contas_bancarias_ativo');
      t.unique(['banco_codigo', 'agencia', 'conta'], 'uk_contas_bancarias_ident');
    });
  }

  // Foreign Key em contas_pagar_baixas.conta_bancaria_id -> contas_bancarias
  const hasBaixas = await knex.schema.hasTable('contas_pagar_baixas');
  if (hasBaixas) {
    try {
      await knex.schema.alterTable('contas_pagar_baixas', (t) => {
        t.foreign('conta_bancaria_id').references('id').inTable('contas_bancarias')
          .onDelete('SET NULL');
      });
    } catch (err) {
      // FK pode já existir em re-runs
    }
  }

  // Regras de juros/multa por fornecedor
  const hasRegras = await knex.schema.hasTable('fornecedor_regras_juros');
  if (!hasRegras) {
    await knex.schema.createTable('fornecedor_regras_juros', (t) => {
      t.increments('id').primary();
      t.string('fornecedor', 180).notNullable();  // nome (match por like) ou CNPJ
      t.string('cnpj', 20).nullable();
      t.string('codiforn', 10).nullable();        // id do fornecedor no ERP

      // Multa fixa após o vencimento: 2% é o padrão de mercado
      t.decimal('multa_percentual', 6, 3).notNullable().defaultTo(2);

      // Juros diários em %: 0,033% ao dia (≈ 1% ao mês) é o padrão
      t.decimal('juros_diario_percentual', 6, 4).notNullable().defaultTo(0.0333);

      t.integer('carencia_dias').notNullable().defaultTo(0); // dias sem juros após venc
      t.boolean('ativo').notNullable().defaultTo(true);
      t.string('observacoes', 255).nullable();
      t.timestamps(true, true);

      t.index(['fornecedor'], 'idx_regras_fornecedor');
      t.index(['cnpj'], 'idx_regras_cnpj');
      t.index(['codiforn'], 'idx_regras_codiforn');
    });
  }

  // Extratos bancários OFX (importados para conciliação)
  const hasExtratos = await knex.schema.hasTable('extratos_bancarios');
  if (!hasExtratos) {
    await knex.schema.createTable('extratos_bancarios', (t) => {
      t.increments('id').primary();
      t.integer('conta_bancaria_id').unsigned().notNullable()
        .references('id').inTable('contas_bancarias').onDelete('CASCADE');

      t.string('fit_id', 80).nullable(); // ID único da transação no OFX
      t.date('data_transacao').notNullable();
      t.decimal('valor', 14, 2).notNullable();
      t.enum('tipo', ['debito', 'credito']).notNullable();
      t.string('descricao', 255).nullable();
      t.string('documento', 80).nullable();

      t.enum('status', ['pendente', 'conciliado', 'ignorado', 'divergente'])
        .notNullable()
        .defaultTo('pendente');

      t.integer('baixa_id').unsigned().nullable()
        .references('id').inTable('contas_pagar_baixas').onDelete('SET NULL');

      t.datetime('importado_em').notNullable().defaultTo(knex.fn.now());
      t.string('importado_por', 50).nullable();
      t.timestamps(true, true);

      t.unique(['conta_bancaria_id', 'fit_id'], 'uk_extrato_fit');
      t.index(['data_transacao'], 'idx_extrato_data');
      t.index(['status'], 'idx_extrato_status');
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('extratos_bancarios');
  await knex.schema.dropTableIfExists('fornecedor_regras_juros');

  const hasBaixas = await knex.schema.hasTable('contas_pagar_baixas');
  if (hasBaixas) {
    try {
      await knex.schema.alterTable('contas_pagar_baixas', (t) => {
        t.dropForeign('conta_bancaria_id');
      });
    } catch (err) { /* noop */ }
  }

  await knex.schema.dropTableIfExists('contas_bancarias');
};
