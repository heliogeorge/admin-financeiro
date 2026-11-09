/**
 * F3 da remodelagem — complementos "por fora".
 *
 * A entrada passa a medir titulação/pagamento contra o TOTAL ESPERADO
 * (NF + complementos), não só o total_faturado:
 *  - total_complemento: soma das contas tipo_titulo='complemento' vinculadas
 *  - total_esperado: total_faturado + total_complemento (recalculado pelo
 *    reconciliationService a cada mudança)
 */
exports.up = async function (knex) {
  const hasComplemento = await knex.schema.hasColumn('entradas_mercadoria', 'total_complemento');
  const hasEsperado = await knex.schema.hasColumn('entradas_mercadoria', 'total_esperado');

  if (!hasComplemento || !hasEsperado) {
    await knex.schema.alterTable('entradas_mercadoria', (t) => {
      if (!hasComplemento) t.decimal('total_complemento', 14, 2).notNullable().defaultTo(0);
      if (!hasEsperado) t.decimal('total_esperado', 14, 2).nullable();
    });
  }

  // backfill: sem complementos, o esperado é o próprio faturado
  await knex('entradas_mercadoria')
    .whereNull('total_esperado')
    .update({ total_esperado: knex.raw('total_faturado') });

  // Data de corte da regra: só gera complemento para entradas emitidas a partir
  // daqui (evita criar "por fora" retroativo para notas antigas já acertadas).
  const hasDesde = await knex.schema.hasColumn('fornecedores', 'complemento_desde');
  if (!hasDesde) {
    await knex.schema.alterTable('fornecedores', (t) => {
      t.date('complemento_desde').nullable();
    });
  }
};

exports.down = async function (knex) {
  const hasComplemento = await knex.schema.hasColumn('entradas_mercadoria', 'total_complemento');
  const hasEsperado = await knex.schema.hasColumn('entradas_mercadoria', 'total_esperado');
  if (hasComplemento || hasEsperado) {
    await knex.schema.alterTable('entradas_mercadoria', (t) => {
      if (hasComplemento) t.dropColumn('total_complemento');
      if (hasEsperado) t.dropColumn('total_esperado');
    });
  }
  const hasDesde = await knex.schema.hasColumn('fornecedores', 'complemento_desde');
  if (hasDesde) {
    await knex.schema.alterTable('fornecedores', (t) => {
      t.dropColumn('complemento_desde');
    });
  }
};
