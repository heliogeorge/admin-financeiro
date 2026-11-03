/**
 * Central de Compras - MVP do anotador de pedidos.
 *
 * O modulo e deliberadamente desacoplado do SAS. Campos produto_sas_id sao
 * referencias logicas e opcionais para vinculacao futura, sem FK externa.
 */
exports.up = async function (knex) {
  const hasFornecedores = await knex.schema.hasTable('compras_fornecedores');
  if (!hasFornecedores) {
    await knex.schema.createTable('compras_fornecedores', (t) => {
      t.increments('id').primary();
      t.string('nome', 200).notNullable();
      t.string('nome_fantasia', 200).nullable();
      t.string('cnpj_cpf', 20).nullable();
      t.string('telefone', 40).nullable();
      t.string('email', 120).nullable();
      t.string('contato', 120).nullable();
      t.text('observacoes').nullable();
      t.boolean('ativo').notNullable().defaultTo(true);
      t.string('criado_por', 50).nullable();
      t.string('atualizado_por', 50).nullable();
      t.timestamps(true, true);

      t.index(['nome'], 'idx_compras_fornecedores_nome');
      t.index(['cnpj_cpf'], 'idx_compras_fornecedores_doc');
    });
  }

  const hasPedidos = await knex.schema.hasTable('compras_pedidos');
  if (!hasPedidos) {
    await knex.schema.createTable('compras_pedidos', (t) => {
      t.increments('id').primary();
      t.string('numero_interno', 30).nullable().unique();
      t.integer('fornecedor_id').unsigned().nullable()
        .references('id').inTable('compras_fornecedores').onDelete('SET NULL');
      t.string('fornecedor_nome_snapshot', 200).nullable();
      t.enum('loja_destino', ['embalatti', 'vivenda', 'ambas'])
        .notNullable()
        .defaultTo('embalatti');
      t.string('comprador', 100).nullable();
      t.date('data_pedido').notNullable();
      t.date('previsao_entrega').nullable();
      t.date('previsao_pagamento').nullable();
      t.enum('origem', ['visita', 'whatsapp', 'telefone', 'email', 'feira', 'sugestao_interna'])
        .nullable();
      t.decimal('valor_total_estimado', 14, 2).notNullable().defaultTo(0);
      t.enum('status', [
        'rascunho',
        'aguardando_aprovacao',
        'aprovado',
        'enviado_fornecedor',
        'confirmado_fornecedor',
        'parcialmente_recebido',
        'recebido',
        'cancelado',
        'fechado',
      ]).notNullable().defaultTo('rascunho');
      t.text('observacoes').nullable();
      t.string('criado_por', 50).nullable();
      t.string('atualizado_por', 50).nullable();
      t.timestamps(true, true);

      t.index(['fornecedor_id'], 'idx_compras_pedidos_fornecedor');
      t.index(['loja_destino'], 'idx_compras_pedidos_loja');
      t.index(['status'], 'idx_compras_pedidos_status');
      t.index(['data_pedido'], 'idx_compras_pedidos_data');
      t.index(['comprador'], 'idx_compras_pedidos_comprador');
    });
  }

  const hasItens = await knex.schema.hasTable('compras_itens');
  if (!hasItens) {
    await knex.schema.createTable('compras_itens', (t) => {
      t.increments('id').primary();
      t.integer('pedido_id').unsigned().notNullable()
        .references('id').inTable('compras_pedidos').onDelete('CASCADE');
      t.string('produto_sas_id', 50).nullable();
      t.string('descricao_livre', 255).nullable();
      t.string('familia', 120).nullable();
      t.string('marca', 120).nullable();
      t.string('cor', 80).nullable();
      t.string('medida', 80).nullable();
      t.decimal('quantidade', 12, 3).notNullable().defaultTo(0);
      t.string('unidade', 20).nullable();
      t.decimal('custo_unitario_estimado', 14, 4).notNullable().defaultTo(0);
      t.decimal('total_estimado', 14, 2).notNullable().defaultTo(0);
      t.decimal('preco_venda_sugerido', 14, 2).nullable();
      t.text('observacoes').nullable();
      t.enum('status_item', ['pendente', 'confirmado', 'parcialmente_recebido', 'recebido', 'cancelado'])
        .notNullable()
        .defaultTo('pendente');
      t.timestamps(true, true);

      t.index(['pedido_id'], 'idx_compras_itens_pedido');
      t.index(['produto_sas_id'], 'idx_compras_itens_produto_sas');
      t.index(['descricao_livre'], 'idx_compras_itens_descricao');
    });
  }

  const hasAnexos = await knex.schema.hasTable('compras_anexos');
  if (!hasAnexos) {
    await knex.schema.createTable('compras_anexos', (t) => {
      t.increments('id').primary();
      t.integer('pedido_id').unsigned().notNullable()
        .references('id').inTable('compras_pedidos').onDelete('CASCADE');
      t.integer('item_id').unsigned().nullable()
        .references('id').inTable('compras_itens').onDelete('SET NULL');
      t.enum('tipo', ['foto', 'pdf', 'whatsapp', 'catalogo', 'outro'])
        .notNullable()
        .defaultTo('outro');
      t.string('arquivo_url', 500).notNullable();
      t.string('caminho_arquivo', 500).nullable();
      t.string('nome_arquivo', 255).nullable();
      t.string('mime_type', 120).nullable();
      t.integer('tamanho_bytes').nullable();
      t.string('descricao', 255).nullable();
      t.string('criado_por', 50).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());

      t.index(['pedido_id'], 'idx_compras_anexos_pedido');
      t.index(['item_id'], 'idx_compras_anexos_item');
    });
  }

  const hasLog = await knex.schema.hasTable('compras_status_log');
  if (!hasLog) {
    await knex.schema.createTable('compras_status_log', (t) => {
      t.increments('id').primary();
      t.integer('pedido_id').unsigned().notNullable()
        .references('id').inTable('compras_pedidos').onDelete('CASCADE');
      t.string('status_anterior', 40).nullable();
      t.string('status_novo', 40).notNullable();
      t.string('usuario', 50).nullable();
      t.string('motivo', 500).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());

      t.index(['pedido_id'], 'idx_compras_status_log_pedido');
      t.index(['status_novo'], 'idx_compras_status_log_status');
    });
  }

  const hasVinculos = await knex.schema.hasTable('compras_item_vinculos_sas');
  if (!hasVinculos) {
    await knex.schema.createTable('compras_item_vinculos_sas', (t) => {
      t.increments('id').primary();
      t.integer('item_id').unsigned().notNullable()
        .references('id').inTable('compras_itens').onDelete('CASCADE');
      t.string('produto_sas_id', 50).notNullable();
      t.string('usuario', 50).nullable();
      t.string('observacao', 500).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());

      t.index(['item_id'], 'idx_compras_vinculos_item');
      t.index(['produto_sas_id'], 'idx_compras_vinculos_produto');
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('compras_item_vinculos_sas');
  await knex.schema.dropTableIfExists('compras_status_log');
  await knex.schema.dropTableIfExists('compras_anexos');
  await knex.schema.dropTableIfExists('compras_itens');
  await knex.schema.dropTableIfExists('compras_pedidos');
  await knex.schema.dropTableIfExists('compras_fornecedores');
};
