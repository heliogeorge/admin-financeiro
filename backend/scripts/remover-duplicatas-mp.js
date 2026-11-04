/**
 * Remove duplicatas em mp_movimentos causadas por relatórios do MP gerados
 * em fusos diferentes (mesmo source_id/tipo/valor líquido, datas com ~1h de
 * diferença em arquivos distintos). Mantém o registro importado primeiro.
 *
 * Uso:  node scripts/remover-duplicatas-mp.js          (dry-run, só lista)
 *       node scripts/remover-duplicatas-mp.js --apply  (remove de fato)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { adminDb } = require('../src/config/database');

const APPLY = process.argv.includes('--apply');

(async () => {
  const grupos = await adminDb('mp_movimentos')
    .groupBy('conta_bancaria_id', 'source_id', 'transaction_type', 'net_amount')
    .havingRaw('COUNT(*) > 1 AND COUNT(DISTINCT file_name) > 1 AND COUNT(DISTINCT transaction_date) > 1')
    .select('conta_bancaria_id', 'source_id', 'transaction_type', 'net_amount',
      adminDb.raw('MIN(id) as manter'));

  let removidos = 0;
  for (const g of grupos) {
    const rows = await adminDb('mp_movimentos')
      .where({
        conta_bancaria_id: g.conta_bancaria_id,
        source_id: g.source_id,
        transaction_type: g.transaction_type,
      })
      .whereBetween('net_amount', [g.net_amount - 0.001, g.net_amount + 0.001])
      .orderBy('id')
      .select('id', 'transaction_date', 'file_name');

    // só é duplicata de fuso quando a diferença entre as cópias é pequena
    const difH = Math.abs(new Date(rows[rows.length - 1].transaction_date)
      - new Date(rows[0].transaction_date)) / 3600000;
    if (difH === 0 || difH >= 3) continue;

    const ids = rows.filter((r) => r.id !== g.manter).map((r) => r.id);
    console.log(`conta=${g.conta_bancaria_id} src=${g.source_id} net=${g.net_amount}: `
      + `${APPLY ? 'removendo' : 'removeria'} ids ${ids.join(',')} (mantém ${g.manter})`);
    if (APPLY) removidos += await adminDb('mp_movimentos').whereIn('id', ids).del();
    else removidos += ids.length;
  }

  console.log(APPLY
    ? `\n${removidos} duplicata(s) removida(s).`
    : `\n${removidos} duplicata(s) encontrada(s). Rode com --apply para remover.`);
  process.exit(0);
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
