/**
 * Histórico detalhado de baixas (pagamentos) de contas a pagar.
 *
 * Cada registro representa UM pagamento individual. Uma conta pode ter
 * várias baixas (pagamentos parciais). Os totais da conta passam a ser
 * calculados a partir da soma dos registros desta tabela.
 *
 * Também faz o backfill das contas já quitadas ou parcialmente pagas
 * para não perder o histórico atual.
 */
exports.up = async function (knex) {
  const hasBaixas = await knex.schema.hasTable('contas_pagar_baixas');
  if (!hasBaixas) {
    await knex.schema.createTable('contas_pagar_baixas', (t) => {
      t.increments('id').primary();
      t.integer('conta_pagar_id').unsigned().notNullable()
        .references('id').inTable('contas_pagar').onDelete('CASCADE');

      t.date('data_pagamento').notNullable();
      t.decimal('valor_pago', 12, 2).notNullable().defaultTo(0);
      t.decimal('valor_desconto', 12, 2).notNullable().defaultTo(0);
      t.decimal('valor_juros', 12, 2).notNullable().defaultTo(0);
      t.decimal('valor_multa', 12, 2).notNullable().defaultTo(0);

      t.string('forma_pagamento', 40).nullable();
      t.integer('conta_bancaria_id').unsigned().nullable();
      t.string('banco_baixa', 120).nullable();
      t.string('comprovante_path', 500).nullable();

      // Origem: manual pelo usuário, OFX (conciliação bancária), lote (pagamento em massa)
      t.enum('origem', ['manual', 'ofx', 'lote', 'cheque', 'estorno_ajuste'])
        .notNullable()
        .defaultTo('manual');

      t.string('referencia_externa', 120).nullable(); // ex: id da transação OFX
      t.text('observacoes').nullable();

      t.boolean('estornada').notNullable().defaultTo(false);
      t.datetime('estornada_em').nullable();
      t.string('estornada_por', 50).nullable();
      t.string('estorno_motivo', 255).nullable();

      t.string('criado_por', 50).nullable();
      t.string('atualizado_por', 50).nullable();
      t.timestamps(true, true);

      t.index(['conta_pagar_id'], 'idx_baixas_conta');
      t.index(['data_pagamento'], 'idx_baixas_data');
      t.index(['forma_pagamento'], 'idx_baixas_forma');
      t.index(['conta_bancaria_id'], 'idx_baixas_conta_bancaria');
      t.index(['estornada'], 'idx_baixas_estornada');
    });
  }

  // Backfill: toda conta com valor_pago > 0 ou status pago vira uma baixa.
  const contas = await knex('contas_pagar')
    .select('id', 'status', 'valor', 'valor_pago', 'valor_desconto', 'valor_juros',
            'data_pagamento', 'data_vencimento', 'forma_pagamento', 'banco_baixa',
            'comprovante_path', 'observacoes', 'atualizado_por', 'criado_por')
    .where(function () {
      this.where('status', 'pago')
        .orWhere('valor_pago', '>', 0);
    });

  for (const conta of contas) {
    // Se já existe baixa para a conta, não reinsere (idempotente)
    const jaExiste = await knex('contas_pagar_baixas').where('conta_pagar_id', conta.id).first();
    if (jaExiste) continue;

    const valorPago = parseFloat(conta.valor_pago || 0) || parseFloat(conta.valor || 0);
    if (valorPago <= 0 && (conta.valor_desconto || 0) <= 0) continue;

    await knex('contas_pagar_baixas').insert({
      conta_pagar_id: conta.id,
      data_pagamento: conta.data_pagamento
        || conta.data_vencimento
        || new Date().toISOString().slice(0, 10),
      valor_pago: valorPago,
      valor_desconto: parseFloat(conta.valor_desconto || 0),
      valor_juros: parseFloat(conta.valor_juros || 0),
      valor_multa: 0,
      forma_pagamento: conta.forma_pagamento || null,
      banco_baixa: conta.banco_baixa || null,
      comprovante_path: conta.comprovante_path || null,
      origem: 'manual',
      observacoes: 'Baixa migrada do modelo antigo (histórico consolidado).',
      criado_por: conta.atualizado_por || conta.criado_por || 'migration',
      atualizado_por: 'migration',
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('contas_pagar_baixas');
};
