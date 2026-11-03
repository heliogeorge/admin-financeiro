function roundCurrency(value) {
  return Math.round((parseFloat(value || 0) + Number.EPSILON) * 100) / 100;
}

function splitValue(total, parts, index) {
  const base = roundCurrency(total / parts);
  if (index === parts - 1) {
    return roundCurrency(total - (base * (parts - 1)));
  }
  return base;
}

exports.up = async function (knex) {
  const hasPlanoContas = await knex.schema.hasTable('plano_contas_erp');
  if (!hasPlanoContas) {
    await knex.schema.createTable('plano_contas_erp', (table) => {
      table.increments('id').primary();
      table.string('codigo_erp', 30).notNullable();
      table.string('descricao', 150).notNullable();
      table.string('tipo', 50).nullable();
      table.boolean('ativo').defaultTo(true);
      table.datetime('ultima_sync_at').nullable();
      table.timestamps(true, true);

      table.unique(['codigo_erp'], 'uk_plano_contas_codigo');
      table.index(['descricao'], 'idx_plano_contas_descricao');
    });
  }

  const contaColumns = {
    natureza: await knex.schema.hasColumn('contas_pagar', 'natureza'),
    plano_conta_id: await knex.schema.hasColumn('contas_pagar', 'plano_conta_id'),
    valor_pago: await knex.schema.hasColumn('contas_pagar', 'valor_pago'),
    saldo_aberto: await knex.schema.hasColumn('contas_pagar', 'saldo_aberto'),
    status_conciliacao: await knex.schema.hasColumn('contas_pagar', 'status_conciliacao'),
  };

  if (Object.values(contaColumns).some((exists) => !exists)) {
    await knex.schema.alterTable('contas_pagar', (table) => {
      if (!contaColumns.natureza) {
        table.enum('natureza', ['mercadoria', 'despesa_geral', 'nao_classificada'])
          .notNullable()
          .defaultTo('nao_classificada');
      }
      if (!contaColumns.plano_conta_id) {
        table.integer('plano_conta_id').unsigned().nullable()
          .references('id').inTable('plano_contas_erp');
      }
      if (!contaColumns.valor_pago) {
        table.decimal('valor_pago', 12, 2).notNullable().defaultTo(0);
      }
      if (!contaColumns.saldo_aberto) {
        table.decimal('saldo_aberto', 12, 2).notNullable().defaultTo(0);
      }
      if (!contaColumns.status_conciliacao) {
        table.enum('status_conciliacao', ['sem_itens', 'parcial', 'conciliado', 'divergente'])
          .notNullable()
          .defaultTo('sem_itens');
      }
    });
  }

  const entradaColumns = {
    total_titulado: await knex.schema.hasColumn('entradas_mercadoria', 'total_titulado'),
    total_pago: await knex.schema.hasColumn('entradas_mercadoria', 'total_pago'),
    saldo_sem_titulo: await knex.schema.hasColumn('entradas_mercadoria', 'saldo_sem_titulo'),
    saldo_a_pagar: await knex.schema.hasColumn('entradas_mercadoria', 'saldo_a_pagar'),
    status_titulacao: await knex.schema.hasColumn('entradas_mercadoria', 'status_titulacao'),
  };

  if (Object.values(entradaColumns).some((exists) => !exists)) {
    await knex.schema.alterTable('entradas_mercadoria', (table) => {
      if (!entradaColumns.total_titulado) {
        table.decimal('total_titulado', 14, 2).notNullable().defaultTo(0);
      }
      if (!entradaColumns.total_pago) {
        table.decimal('total_pago', 14, 2).notNullable().defaultTo(0);
      }
      if (!entradaColumns.saldo_sem_titulo) {
        table.decimal('saldo_sem_titulo', 14, 2).notNullable().defaultTo(0);
      }
      if (!entradaColumns.saldo_a_pagar) {
        table.decimal('saldo_a_pagar', 14, 2).notNullable().defaultTo(0);
      }
      if (!entradaColumns.status_titulacao) {
        table.enum('status_titulacao', ['sem_titulo', 'parcial', 'titulado'])
          .notNullable()
          .defaultTo('sem_titulo');
      }
    });
  }

  const hasContaItens = await knex.schema.hasTable('contas_pagar_itens');
  if (!hasContaItens) {
    await knex.schema.createTable('contas_pagar_itens', (table) => {
      table.increments('id').primary();
      table.integer('conta_pagar_id').unsigned().notNullable()
        .references('id').inTable('contas_pagar').onDelete('CASCADE');
      table.enum('tipo_origem', ['entrada_mercadoria', 'despesa_avulsa', 'frete', 'imposto', 'ajuste'])
        .notNullable()
        .defaultTo('despesa_avulsa');
      table.integer('entrada_id').unsigned().nullable()
        .references('id').inTable('entradas_mercadoria').onDelete('SET NULL');
      table.integer('plano_conta_id').unsigned().nullable()
        .references('id').inTable('plano_contas_erp').onDelete('SET NULL');
      table.string('descricao_item', 255).nullable();
      table.string('documento_referencia', 50).nullable();
      table.decimal('valor_item', 12, 2).notNullable();
      table.enum('origem_match', ['manual', 'sugestao', 'confirmado', 'legado'])
        .notNullable()
        .defaultTo('manual');
      table.decimal('score_match', 5, 2).nullable();
      table.text('observacoes').nullable();
      table.string('criado_por', 50).nullable();
      table.string('atualizado_por', 50).nullable();
      table.timestamps(true, true);

      table.index(['conta_pagar_id'], 'idx_conta_itens_conta');
      table.index(['entrada_id'], 'idx_conta_itens_entrada');
      table.index(['tipo_origem'], 'idx_conta_itens_tipo');
    });
  }

  const hasDdaDocumentos = await knex.schema.hasTable('dda_documentos');
  if (!hasDdaDocumentos) {
    await knex.schema.createTable('dda_documentos', (table) => {
      table.increments('id').primary();
      table.string('linha_digitavel', 80).nullable();
      table.string('codigo_barras', 80).nullable();
      table.string('nosso_numero', 50).nullable();
      table.string('banco', 60).nullable();
      table.string('cedente_nome', 160).nullable();
      table.string('cedente_documento', 30).nullable();
      table.decimal('valor_documento', 12, 2).notNullable().defaultTo(0);
      table.date('data_vencimento').nullable();
      table.datetime('data_importacao').notNullable().defaultTo(knex.fn.now());
      table.text('texto_original').nullable();
      table.string('hash_documento', 64).notNullable();
      table.enum('status', ['novo', 'sugerido', 'confirmado', 'divergente', 'descartado'])
        .notNullable()
        .defaultTo('novo');
      table.integer('conta_pagar_id').unsigned().nullable()
        .references('id').inTable('contas_pagar').onDelete('SET NULL');
      table.string('erp_fornecedor_id_sugerido', 10).nullable();
      table.decimal('score_match', 5, 2).nullable();
      table.string('criado_por', 50).nullable();
      table.string('atualizado_por', 50).nullable();
      table.timestamps(true, true);

      table.unique(['hash_documento'], 'uk_dda_hash');
      table.index(['status'], 'idx_dda_status');
      table.index(['data_vencimento'], 'idx_dda_vencimento');
      table.index(['conta_pagar_id'], 'idx_dda_conta');
    });
  }

  const contas = await knex('contas_pagar').select('id', 'origem', 'status', 'valor');
  for (const conta of contas) {
    const valor = roundCurrency(conta.valor);
    const valorPago = conta.status === 'pago' ? valor : 0;
    const saldoAberto = ['pago', 'cancelado'].includes(conta.status) ? 0 : valor;
    const natureza = conta.origem === 'manual' ? 'despesa_geral' : 'nao_classificada';

    await knex('contas_pagar')
      .where('id', conta.id)
      .update({
        natureza,
        valor_pago: valorPago,
        saldo_aberto: saldoAberto,
        status_conciliacao: 'sem_itens',
      });
  }

  const entradas = await knex('entradas_mercadoria').select('id', 'total_faturado');
  for (const entrada of entradas) {
    const totalFaturado = roundCurrency(entrada.total_faturado);
    await knex('entradas_mercadoria')
      .where('id', entrada.id)
      .update({
        total_titulado: 0,
        total_pago: 0,
        saldo_sem_titulo: totalFaturado,
        saldo_a_pagar: 0,
        status_titulacao: 'sem_titulo',
      });
  }

  const hasLegacyLinks = await knex.schema.hasTable('entradas_contas');
  if (hasLegacyLinks) {
    const legacyLinks = await knex('entradas_contas')
      .select('entrada_id', 'conta_pagar_id')
      .orderBy('conta_pagar_id', 'asc');

    if (legacyLinks.length > 0) {
      const contasValores = await knex('contas_pagar').select('id', 'valor');
      const valorMap = new Map(contasValores.map((row) => [row.id, roundCurrency(row.valor)]));

      const groupedByConta = legacyLinks.reduce((acc, link) => {
        if (!acc[link.conta_pagar_id]) acc[link.conta_pagar_id] = [];
        acc[link.conta_pagar_id].push(link.entrada_id);
        return acc;
      }, {});

      const inserts = [];
      for (const [contaIdRaw, entradaIds] of Object.entries(groupedByConta)) {
        const contaId = parseInt(contaIdRaw, 10);
        const totalConta = valorMap.get(contaId) || 0;

        entradaIds.forEach((entradaId, index) => {
          inserts.push({
            conta_pagar_id: contaId,
            tipo_origem: 'entrada_mercadoria',
            entrada_id: entradaId,
            descricao_item: 'Migrado do vinculo legado entrada-conta',
            documento_referencia: null,
            valor_item: splitValue(totalConta, entradaIds.length, index),
            origem_match: 'legado',
            score_match: null,
            observacoes: entradaIds.length > 1
              ? 'Valor rateado automaticamente na migracao do modelo legado.'
              : 'Migrado automaticamente do modelo legado.',
            criado_por: 'migration',
            atualizado_por: 'migration',
          });
        });
      }

      if (inserts.length > 0) {
        const chunkSize = 200;
        for (let i = 0; i < inserts.length; i += chunkSize) {
          await knex('contas_pagar_itens').insert(inserts.slice(i, i + chunkSize));
        }
      }
    }
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('dda_documentos');
  await knex.schema.dropTableIfExists('contas_pagar_itens');

  await knex.schema.alterTable('entradas_mercadoria', (table) => {
    table.dropColumns([
      'total_titulado',
      'total_pago',
      'saldo_sem_titulo',
      'saldo_a_pagar',
      'status_titulacao',
    ]);
  });

  await knex.schema.alterTable('contas_pagar', (table) => {
    table.dropColumns([
      'natureza',
      'plano_conta_id',
      'valor_pago',
      'saldo_aberto',
      'status_conciliacao',
    ]);
  });

  await knex.schema.dropTableIfExists('plano_contas_erp');
};
