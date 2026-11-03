const { adminDb } = require('../config/database');
const { hasTable, getExistingColumns } = require('./schemaCompatService');

const CONTAS = 'contas_pagar';
const ITENS = 'contas_pagar_itens';
const BAIXAS = 'contas_pagar_baixas';
const ENTRADAS = 'entradas_mercadoria';

const TOLERANCIA = 0.05;

function toNumber(value) {
  return Math.round((parseFloat(value || 0) + Number.EPSILON) * 100) / 100;
}

function clampZero(value) {
  return Math.abs(value) < TOLERANCIA ? 0 : toNumber(value);
}

function buildContaSnapshot(conta, itens) {
  const valorConta = toNumber(conta.valor);
  const totalItens = toNumber(itens.reduce((sum, item) => sum + toNumber(item.valor_item), 0));
  const diferenca = clampZero(valorConta - totalItens);

  let statusConciliacao = 'sem_itens';
  if (totalItens === 0) {
    statusConciliacao = 'sem_itens';
  } else if (Math.abs(diferenca) < TOLERANCIA) {
    statusConciliacao = 'conciliado';
  } else if (totalItens < valorConta) {
    statusConciliacao = 'parcial';
  } else {
    statusConciliacao = 'divergente';
  }

  return {
    valorConta,
    totalItens,
    diferenca,
    statusConciliacao,
  };
}

function buildEntradaSnapshot(entrada, itens) {
  const totalEntrada = toNumber(entrada.total_faturado);
  const totalTitulado = toNumber(itens.reduce((sum, item) => sum + toNumber(item.valor_item), 0));
  const totalPago = toNumber(
    itens.reduce((sum, item) => {
      if (item.status_conta === 'pago') return sum + toNumber(item.valor_item);
      return sum;
    }, 0)
  );

  const saldoSemTitulo = clampZero(totalEntrada - totalTitulado);
  const saldoAPagar = clampZero(totalTitulado - totalPago);

  let statusTitulacao = 'sem_titulo';
  if (totalTitulado === 0) statusTitulacao = 'sem_titulo';
  else if (Math.abs(totalEntrada - totalTitulado) < TOLERANCIA || totalTitulado > totalEntrada) statusTitulacao = 'titulado';
  else statusTitulacao = 'parcial';

  let statusPagamento = 'em_aberto';
  if (totalPago >= totalEntrada - TOLERANCIA && totalEntrada > 0) statusPagamento = 'pago';
  else if (totalPago > 0) statusPagamento = 'parcial';

  return {
    totalEntrada,
    totalTitulado,
    totalPago,
    saldoSemTitulo,
    saldoAPagar,
    statusTitulacao,
    statusPagamento,
  };
}

/**
 * Recalcula a conta a partir das suas alocações (itens) e baixas.
 *
 *  - status_conciliacao vem dos itens (alocações x valor).
 *  - valor_pago / saldo_aberto / status / data_pagamento vêm da soma
 *    dos registros em contas_pagar_baixas (tabela de histórico).
 */
async function recalcConta(contaId) {
  const conta = await adminDb(CONTAS).where('id', contaId).first();
  if (!conta) return null;

  const itens = await adminDb(ITENS)
    .select('valor_item')
    .where('conta_pagar_id', contaId);

  const snapshot = buildContaSnapshot(conta, itens);

  // Sempre recomputa status_conciliacao a partir dos itens.
  await adminDb(CONTAS)
    .where('id', contaId)
    .update({ status_conciliacao: snapshot.statusConciliacao });

  // Recomputa totais de pagamento a partir da tabela de baixas.
  const hasBaixasTable = await hasTable(BAIXAS);
  let totaisBaixas = null;

  if (hasBaixasTable) {
    const baixaCols = await getExistingColumns(BAIXAS, [
      'conta_pagar_id',
      'estornada',
      'data_pagamento',
      'valor_pago',
      'valor_desconto',
      'valor_juros',
      'valor_multa',
      'forma_pagamento',
      'banco_baixa',
    ]);

    if (baixaCols.conta_pagar_id) {
      let query = adminDb(BAIXAS).where('conta_pagar_id', contaId);
      if (baixaCols.estornada) {
        query = query.where('estornada', false);
      }
      if (baixaCols.data_pagamento) {
        query = query.orderBy('data_pagamento', 'asc');
      }
      const baixas = await query.orderBy('id', 'asc');

      const valorConta = toNumber(conta.valor);
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
        const ultima = baixas[baixas.length - 1];
        dataPgto = ultima ? ultima.data_pagamento : (dataPgto || new Date().toISOString().slice(0, 10));
      } else if (conta.status === 'pago') {
        const hoje = new Date().toISOString().slice(0, 10);
        statusFinal = conta.data_vencimento && conta.data_vencimento < hoje ? 'vencido' : 'pendente';
        dataPgto = null;
      }

      const ultimaBaixa = baixas[baixas.length - 1];

      await adminDb(CONTAS).where('id', contaId).update({
        valor_pago: totalPago,
        valor_desconto: totalDesconto,
        valor_juros: toNumber(totalJuros + totalMulta),
        saldo_aberto: saldoAberto,
        status: statusFinal,
        data_pagamento: dataPgto,
        forma_pagamento: baixaCols.forma_pagamento
          ? (ultimaBaixa?.forma_pagamento || conta.forma_pagamento || null)
          : (conta.forma_pagamento || null),
        banco_baixa: baixaCols.banco_baixa
          ? (ultimaBaixa?.banco_baixa || conta.banco_baixa || null)
          : (conta.banco_baixa || null),
      });

      totaisBaixas = {
        totalPago, totalDesconto, totalJuros, totalMulta,
        saldoAberto, status: statusFinal, totalBaixas: baixas.length,
      };
    }
  }

  return { ...snapshot, ...totaisBaixas };
}

async function recalcEntrada(entradaId) {
  const entrada = await adminDb(ENTRADAS).where('id', entradaId).first();
  if (!entrada) return null;

  const itens = await adminDb(ITENS)
    .select(`${ITENS}.valor_item`, `${CONTAS}.status as status_conta`)
    .leftJoin(CONTAS, `${ITENS}.conta_pagar_id`, `${CONTAS}.id`)
    .where(`${ITENS}.entrada_id`, entradaId);

  const snapshot = buildEntradaSnapshot(entrada, itens);

  await adminDb(ENTRADAS)
    .where('id', entradaId)
    .update({
      total_titulado: snapshot.totalTitulado,
      total_pago: snapshot.totalPago,
      saldo_sem_titulo: snapshot.saldoSemTitulo,
      saldo_a_pagar: snapshot.saldoAPagar,
      status_titulacao: snapshot.statusTitulacao,
      status_pagamento: snapshot.statusPagamento,
    });

  return snapshot;
}

async function recalcContaDependencies(contaId) {
  await recalcConta(contaId);

  const entradaIds = await adminDb(ITENS)
    .distinct('entrada_id')
    .where('conta_pagar_id', contaId)
    .whereNotNull('entrada_id');

  for (const row of entradaIds) {
    await recalcEntrada(row.entrada_id);
  }
}

module.exports = {
  TOLERANCIA,
  toNumber,
  clampZero,
  buildContaSnapshot,
  buildEntradaSnapshot,
  recalcConta,
  recalcEntrada,
  recalcContaDependencies,
};
