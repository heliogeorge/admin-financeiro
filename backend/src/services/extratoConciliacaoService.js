/**
 * Status do extrato a partir das baixas ligadas a ele (F4 — baixa em lote).
 *
 * Um extrato pode ter N baixas (contas_pagar_baixas.extrato_id). O status é
 * derivado da soma das baixas NÃO estornadas:
 *   soma = 0            → pendente
 *   soma ≈ valor        → conciliado
 *   0 < soma < valor    → parcial
 *   soma > valor        → divergente
 * 'ignorado' é decisão manual e nunca é alterado aqui.
 *
 * extratos_bancarios.baixa_id segue como legado (primeira baixa ativa).
 */
const { adminDb } = require('../config/database');
const { toNumber } = require('./reconciliationService');

const EXTRATOS = 'extratos_bancarios';
const BAIXAS = 'contas_pagar_baixas';

const TOLERANCIA_EXTRATO = 0.05;

async function recalcExtrato(extratoId) {
  const extrato = await adminDb(EXTRATOS).where('id', extratoId).first();
  if (!extrato) return null;
  if (extrato.status === 'ignorado') return extrato.status;

  const baixas = await adminDb(BAIXAS)
    .where('extrato_id', extratoId)
    .where('estornada', false)
    .orderBy('id', 'asc')
    .select('id', 'valor_pago');

  const soma = toNumber(baixas.reduce((s, b) => s + toNumber(b.valor_pago), 0));
  const valor = toNumber(extrato.valor);

  let status = 'pendente';
  if (soma > 0.009) {
    if (Math.abs(soma - valor) <= TOLERANCIA_EXTRATO) status = 'conciliado';
    else if (soma < valor) status = 'parcial';
    else status = 'divergente';
  }

  await adminDb(EXTRATOS).where('id', extratoId).update({
    status,
    baixa_id: baixas.length > 0 ? baixas[0].id : null,
  });

  return status;
}

module.exports = { recalcExtrato, TOLERANCIA_EXTRATO };
