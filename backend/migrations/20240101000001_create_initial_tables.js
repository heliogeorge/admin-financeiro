/**
 * Migration: Tabelas iniciais do Admin Financeiro
 *
 * Cria:
 * - categorias: categorias de despesas
 * - contas_pagar: controle de contas a pagar (com vínculos ao ERP)
 * - vinculos_pagamento: vincula PAGAME ↔ RELREC ↔ contas_pagar
 */

exports.up = async function (knex) {
  // ============================================
  // Categorias de despesa
  // ============================================
  await knex.schema.createTable('categorias', (table) => {
    table.increments('id').primary();
    table.string('nome', 100).notNullable();
    table.string('cor', 7).defaultTo('#6366f1'); // hex color
    table.string('icone', 50).nullable();
    table.boolean('ativo').defaultTo(true);
    table.timestamps(true, true);
  });

  // Categorias padrão
  await knex('categorias').insert([
    { nome: 'Mercadoria / Estoque', cor: '#3b82f6', icone: 'package' },
    { nome: 'Aluguel', cor: '#ef4444', icone: 'home' },
    { nome: 'Energia / Água / Gás', cor: '#f59e0b', icone: 'zap' },
    { nome: 'Telefone / Internet', cor: '#8b5cf6', icone: 'wifi' },
    { nome: 'Impostos / Taxas', cor: '#dc2626', icone: 'file-text' },
    { nome: 'Salários / RH', cor: '#10b981', icone: 'users' },
    { nome: 'Frete / Transporte', cor: '#06b6d4', icone: 'truck' },
    { nome: 'Marketing / Propaganda', cor: '#ec4899', icone: 'megaphone' },
    { nome: 'Manutenção', cor: '#6b7280', icone: 'wrench' },
    { nome: 'Outros', cor: '#9ca3af', icone: 'more-horizontal' },
  ]);

  // ============================================
  // Contas a Pagar (módulo admin)
  // ============================================
  await knex.schema.createTable('contas_pagar', (table) => {
    table.increments('id').primary();

    // Dados da conta
    table.string('fornecedor', 200).notNullable();
    table.text('descricao').nullable();
    table.decimal('valor', 12, 2).notNullable();
    table.date('data_vencimento').notNullable();
    table.date('data_pagamento').nullable();
    table
      .enum('status', ['pendente', 'pago', 'vencido', 'cancelado'])
      .defaultTo('pendente')
      .index();
    table.string('forma_pagamento', 50).nullable(); // boleto, pix, transferencia, cheque, dinheiro
    table.text('observacoes').nullable();

    // Categoria
    table.integer('categoria_id').unsigned().nullable()
      .references('id').inTable('categorias');

    // Comprovante
    table.string('comprovante_path', 500).nullable();

    // Vínculos com ERP (chaves lógicas, não FK real pois é outro banco)
    table.string('erp_lancamento', 10).nullable().comment('lancamen da tabela PAGAME');
    table.string('erp_numerorr', 12).nullable().comment('numerorr da tabela RELREC');
    table.string('erp_fornecedor_id', 6).nullable().comment('forncie da PAGAME ou codiforn da RELREC');

    // DDA / Boleto bancário (para futuro)
    table.string('codigo_barras', 60).nullable();
    table.string('linha_digitavel', 60).nullable();
    table.string('nosso_numero', 30).nullable();

    // Auditoria
    table.string('criado_por', 30).nullable();
    table.string('atualizado_por', 30).nullable();
    table.timestamps(true, true);

    // Índices
    table.index('data_vencimento');
    table.index('fornecedor');
    table.index('erp_lancamento');
    table.index('erp_numerorr');
  });

  // ============================================
  // Vínculos: PAGAME ↔ RELREC ↔ Conta Admin
  // Tabela de ligação para resolver o problema central:
  // "qual pagamento corresponde a qual entrada de mercadoria?"
  // ============================================
  await knex.schema.createTable('vinculos_pagamento', (table) => {
    table.increments('id').primary();

    // Referências ao ERP (chaves lógicas)
    table.string('erp_lancamento', 10).nullable().comment('lancamen da PAGAME');
    table.string('erp_numerorr', 12).nullable().comment('numerorr da RELREC');
    table.string('erp_numero_nf', 15).nullable().comment('numeronf da RELREC ou document da PAGAME');
    table.string('erp_chave_nfe', 44).nullable().comment('nfe_chav da RELREC');
    table.string('erp_fornecedor', 6).nullable();

    // Referência à conta admin
    table.integer('conta_pagar_id').unsigned().nullable()
      .references('id').inTable('contas_pagar');

    // Valores para quando um boleto cobre parcial de uma NF ou vice-versa
    table.decimal('valor_vinculado', 12, 2).nullable();

    // Tipo de vínculo
    table
      .enum('tipo', ['automatico', 'manual', 'dda'])
      .defaultTo('manual');

    // Confiança do match (para matching automático futuro)
    table.decimal('score_match', 5, 2).nullable().comment('0-100, confiança do match');

    table.text('observacoes').nullable();
    table.string('criado_por', 30).nullable();
    table.timestamps(true, true);

    // Índices
    table.index('erp_lancamento');
    table.index('erp_numerorr');
    table.index('erp_numero_nf');
    table.index('erp_chave_nfe');
    table.index('conta_pagar_id');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('vinculos_pagamento');
  await knex.schema.dropTableIfExists('contas_pagar');
  await knex.schema.dropTableIfExists('categorias');
};
