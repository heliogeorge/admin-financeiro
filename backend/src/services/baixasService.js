const { adminDb } = require('../config/database');
const { toNumber } = require('./reconciliationService');
const { hasTable, getExistingColumns } = require('./schemaCompatService');

const CONTAS = 'contas_pagar';
const BAIXAS = 'contas_pagar_baixas';
const BANCOS = 'contas_bancarias';
const DOCUMENTOS = 'contas_pagar_baixa_documentos';

/**
 * Recalcula totais da conta a partir das baixas registradas (soma).
 * Atualiza valor_pago, valor_desconto, valor_juros, saldo_aberto, status e data_pagamento.
 */
async function recalcContaFromBaixas(contaId) {
  const conta = await adminDb(CONTAS).where('id', contaId).first();
  if (!conta) return null;

  const valorConta = toNumber(conta.valor);
  const hasBaixas = await hasTable(BAIXAS);
  if (!hasBaixas) return null;

  const baixaCols = await getExistingColumns(BAIXAS, [
    'conta_pagar_id',
    'estornada',
    'data_pagamento',
    'valor_pago',
    'valor_desconto',
    'valor_juros',
    'valor_multa',
  ]);
  if (!baixaCols.conta_pagar_id) return null;

  let query = adminDb(BAIXAS).where('conta_pagar_id', contaId);
  if (baixaCols.estornada) {
    query = query.where('estornada', false);
  }
  if (baixaCols.data_pagamento) {
    query = query.orderBy('data_pagamento', 'asc');
  }
  const baixas = await query.orderBy('id', 'asc');

  const totalPago = baixaCols.valor_pago
    ? toNumber(baixas.reduce((s, b) => s + toNumber(b.valor_pago), 0))
    : 0;
  const totalDesconto = baixaCols.valor_desconto
    ? toNumber(baixas.reduce((s, b) => s + toNumber(b.valor_desconto), 0))
    : 0;
  const totalJuros = baixaCols.valor_juros
    ? toNumber(baixas.reduce((s, b) => s + toNumber(b.valor_juros), 0))
    : 0;
  const totalMulta = baixaCols.valor_multa
    ? toNumber(baixas.reduce((s, b) => s + toNumber(b.valor_multa), 0))
    : 0;

  const saldoAberto = Math.max(0, toNumber(valorConta - totalPago - totalDesconto));
  const estaQuitada = saldoAberto < 0.01 && (totalPago > 0 || totalDesconto > 0);

  let statusFinal = conta.status;
  let dataPgto = conta.data_pagamento;

  if (estaQuitada) {
    statusFinal = 'pago';
    // data do último pagamento
    const ultima = baixas[baixas.length - 1];
    dataPgto = ultima ? ultima.data_pagamento : (dataPgto || new Date().toISOString().slice(0, 10));
  } else if (conta.status === 'pago') {
    // foi revertida (baixa estornada ou editada para menor): reabre
    const hoje = new Date().toISOString().slice(0, 10);
    statusFinal = conta.data_vencimento && conta.data_vencimento < hoje ? 'vencido' : 'pendente';
    dataPgto = null;
  }

  // Última baixa não estornada vira referência de forma/banco para display
  const ultimaBaixa = baixas[baixas.length - 1];

  await adminDb(CONTAS).where('id', contaId).update({
    valor_pago: totalPago,
    valor_desconto: totalDesconto,
    valor_juros: toNumber(totalJuros + totalMulta),
    saldo_aberto: saldoAberto,
    status: statusFinal,
    data_pagamento: dataPgto,
    forma_pagamento: ultimaBaixa?.forma_pagamento || conta.forma_pagamento || null,
    banco_baixa: ultimaBaixa?.banco_baixa || conta.banco_baixa || null,
  });

  return {
    totalPago,
    totalDesconto,
    totalJuros,
    totalMulta,
    saldoAberto,
    status: statusFinal,
    totalBaixas: baixas.length,
  };
}

/**
 * Lista baixas de uma conta com JOIN na conta bancária quando houver.
 */
async function listBaixas(contaId) {
  const hasBaixas = await hasTable(BAIXAS);
  if (!hasBaixas) return [];

  const baixaCols = await getExistingColumns(BAIXAS, [
    'conta_pagar_id',
    'conta_bancaria_id',
    'documento_baixa_id',
    'data_pagamento',
  ]);
  if (!baixaCols.conta_pagar_id) return [];

  let query = adminDb(BAIXAS).select(`${BAIXAS}.*`);

  const hasBancos = await hasTable(BANCOS);
  if (hasBancos && baixaCols.conta_bancaria_id) {
    query = query
      .leftJoin(BANCOS, `${BAIXAS}.conta_bancaria_id`, `${BANCOS}.id`)
      .select(
        `${BANCOS}.nome as conta_bancaria_nome`,
        `${BANCOS}.banco_codigo as conta_bancaria_codigo`
      );
  }

  const hasDocumentos = await hasTable(DOCUMENTOS);
  if (hasDocumentos && baixaCols.documento_baixa_id) {
    query = query
      .leftJoin(DOCUMENTOS, `${BAIXAS}.documento_baixa_id`, `${DOCUMENTOS}.id`)
      .select(
        `${DOCUMENTOS}.codigo as documento_baixa_codigo`,
        `${DOCUMENTOS}.status as documento_baixa_status`,
        `${DOCUMENTOS}.quantidade_contas as documento_total_contas`,
        `${DOCUMENTOS}.total_pagamentos as documento_total_pagamentos`
      );
  }

  query = query.where(`${BAIXAS}.conta_pagar_id`, contaId);
  if (baixaCols.data_pagamento) {
    query = query.orderBy(`${BAIXAS}.data_pagamento`, 'asc');
  }
  return query.orderBy(`${BAIXAS}.id`, 'asc');
}

/**
 * Calcula juros/multa automáticos baseado na regra do fornecedor e
 * quantos dias a data_pagamento está após o vencimento.
 *
 * Retorna { valor_multa, valor_juros, dias_atraso, regra } ou null se
 * não houver atraso ou regra.
 */
async function calcJurosMultaAuto({ fornecedor, cnpj, codiforn, valor, data_vencimento, data_pagamento }) {
  if (!data_vencimento || !data_pagamento) return null;

  const venc = new Date(data_vencimento);
  const pgto = new Date(data_pagamento);
  const diffMs = pgto - venc;
  const diasAtraso = Math.floor(diffMs / 86400000);
  if (diasAtraso <= 0) return null;

  let regra = null;
  if (codiforn) {
    regra = await adminDb('fornecedor_regras_juros')
      .where('codiforn', codiforn).where('ativo', true).first();
  }
  if (!regra && cnpj) {
    regra = await adminDb('fornecedor_regras_juros')
      .where('cnpj', cnpj).where('ativo', true).first();
  }
  if (!regra && fornecedor) {
    regra = await adminDb('fornecedor_regras_juros')
      .where('fornecedor', 'like', `%${fornecedor}%`).where('ativo', true).first();
  }
  if (!regra) return null;

  const carencia = parseInt(regra.carencia_dias, 10) || 0;
  const diasCobraveis = Math.max(0, diasAtraso - carencia);
  if (diasCobraveis === 0) {
    return { valor_multa: 0, valor_juros: 0, dias_atraso: diasAtraso, dias_cobraveis: 0, regra };
  }

  const valorBase = toNumber(valor);
  const multa = toNumber(valorBase * (parseFloat(regra.multa_percentual) / 100));
  const juros = toNumber(valorBase * (parseFloat(regra.juros_diario_percentual) / 100) * diasCobraveis);

  return {
    valor_multa: multa,
    valor_juros: juros,
    dias_atraso: diasAtraso,
    dias_cobraveis: diasCobraveis,
    regra,
  };
}

module.exports = {
  recalcContaFromBaixas,
  listBaixas,
  calcJurosMultaAuto,
};
