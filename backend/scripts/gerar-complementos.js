/**
 * Gera os complementos "por fora" pendentes (regras de fator por fornecedor).
 * O mesmo processo roda automaticamente ao fim de cada sync de entradas;
 * este script serve para disparar manualmente:
 *
 *   cd backend && node scripts/gerar-complementos.js
 */
const { adminDb } = require('../src/config/database');
const { gerarComplementosPendentes } = require('../src/services/complementosService');

async function main() {
  const stats = await gerarComplementosPendentes({ username: 'script-manual' });
  console.log('\nResultado:');
  console.log(`  entradas avaliadas:   ${stats.entradas_avaliadas}`);
  console.log(`  entradas com geração: ${stats.geradas}`);
  console.log(`  contas criadas:       ${stats.contas_criadas}`);
  console.log(`  aguardando parcelas:  ${stats.aguardando_parcelas}`);
  console.log(`  erros:                ${stats.erros}`);
  await adminDb.destroy();
  process.exit(stats.erros > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
