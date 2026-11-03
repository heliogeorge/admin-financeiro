/**
 * Módulo "Informações da Loja" — cofre centralizado de anotações,
 * informações e documentos da empresa (contas de luz/água/telefone,
 * contratos, documentos dos sócios, etc.).
 *
 * Usa SOMENTE o banco admin (adminDb). Nenhuma relação com o ERP.
 *
 * Tabelas:
 *  - loja_info:            registros/anotações organizados por categoria
 *  - loja_info_campos:     pares chave-valor por registro (dados estruturados)
 *  - loja_info_documentos: anexos (PDF, imagens, etc.) por registro
 */
exports.up = async function (knex) {
  const hasInfo = await knex.schema.hasTable('loja_info');
  if (!hasInfo) {
    await knex.schema.createTable('loja_info', (t) => {
      t.increments('id').primary();
      t.string('titulo', 180).notNullable();
      t.string('categoria', 40).notNullable().defaultTo('outros');
      t.text('descricao').nullable();
      t.string('criado_por', 50).nullable();
      t.string('atualizado_por', 50).nullable();
      t.timestamps(true, true);

      t.index(['categoria'], 'idx_loja_info_categoria');
      t.index(['titulo'], 'idx_loja_info_titulo');
    });
  }

  const hasCampos = await knex.schema.hasTable('loja_info_campos');
  if (!hasCampos) {
    await knex.schema.createTable('loja_info_campos', (t) => {
      t.increments('id').primary();
      t.integer('info_id').unsigned().notNullable()
        .references('id').inTable('loja_info').onDelete('CASCADE');
      t.string('chave', 120).notNullable();
      t.string('valor', 500).nullable();
      t.integer('ordem').notNullable().defaultTo(0);

      t.index(['info_id'], 'idx_loja_info_campos_info');
      t.index(['chave'], 'idx_loja_info_campos_chave');
    });
  }

  const hasDocs = await knex.schema.hasTable('loja_info_documentos');
  if (!hasDocs) {
    await knex.schema.createTable('loja_info_documentos', (t) => {
      t.increments('id').primary();
      t.integer('info_id').unsigned().notNullable()
        .references('id').inTable('loja_info').onDelete('CASCADE');
      t.string('arquivo_url', 500).notNullable();
      t.string('caminho_arquivo', 500).nullable();
      t.string('nome_arquivo', 255).nullable();
      t.string('mime_type', 120).nullable();
      t.integer('tamanho_bytes').nullable();
      t.string('descricao', 255).nullable();
      t.string('criado_por', 50).nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());

      t.index(['info_id'], 'idx_loja_info_docs_info');
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('loja_info_documentos');
  await knex.schema.dropTableIfExists('loja_info_campos');
  await knex.schema.dropTableIfExists('loja_info');
};
