/**
 * Complementos "por fora" (F3 da remodelagem do Contas a Pagar).
 *
 * Para fornecedores com regra `complemento_tipo='fator'`, cada entrada de
 * mercadoria gera conta(s) a pagar do tipo `complemento` (sem boleto), e a
 * entrada passa a medir-se pelo total esperado (NF + complemento).
 *
 * Regras:
 *  - só entradas emitidas a partir de `fornecedores.complemento_desde`;
 *  - `junto_parcelas`: um complemento por parcela (duplicata do ERP achada
 *    pela referência EM-xx-xxxxxx), vencendo com cada boleto, valor rateado
 *    proporcionalmente; exige as parcelas já sincronizadas (soma = NF);
 *  - `data_fixa`: um complemento único, vencendo N dias após a entrada —
 *    não depende das parcelas;
 *  - idempotente: entrada que já tem complemento vinculado nunca é regerada
 *    (edições manuais são preservadas; o sync não sobrescreve);
 *  - `valor_informado`: nada é gerado — o valor entra pelo botão na entrada
 *    (criarComplementoManual).
 */
const { adminDb } = require('../config/database');
const { recalcContaDependencies, toNumber, TOLERANCIA } = require('./reconciliationService');

const CONTAS = 'contas_pagar';
const ITENS = 'contas_pagar_itens';
const ENTRADAS = 'entradas_mercadoria';
const ENTRADAS_CONTAS = 'entradas_contas';
const FORNECEDORES = 'fornecedores';

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

function inferStatus(dataVencimento) {
  return String(dataVencimento) < hojeISO() ? 'vencido' : 'pendente';
}

function addDias(dataISO, dias) {
  const d = new Date(`${String(dataISO).slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + (parseInt(dias, 10) || 0));
  return d.toISOString().slice(0, 10);
}

function baseDaRegra(entrada, fornecedor) {
  return fornecedor.complemento_base === 'total_produtos'
    ? toNumber(entrada.total_produtos)
    : toNumber(entrada.total_faturado);
}

/** Duplicatas do ERP que pertencem à entrada, achadas pela referência EM-xx-xxxxxx. */
async function parcelasDaEntrada(entrada) {
  if (!entrada.numerorr) return [];
  return adminDb(CONTAS)
    .where('status', '!=', 'cancelado')
    .where('tipo_titulo', 'duplicata')
    .where('erp_fornecedor_id', String(entrada.codiforn))
    .where((b) => {
      b.where('referencia', entrada.numerorr)
        .orWhere('referencia', 'like', `${entrada.numerorr}-%`);
    })
    .orderBy('data_vencimento', 'asc')
    .orderBy('id', 'asc');
}

/** Vincula uma conta à entrada (entradas_contas + item), se ainda não vinculada. */
async function vincularContaEntrada(conta, entrada, { origemMatch, username, observacoes = null }) {
  const temVinculo = await adminDb(ENTRADAS_CONTAS)
    .where('entrada_id', entrada.id)
    .where('conta_pagar_id', conta.id)
    .first();
  if (!temVinculo) {
    await adminDb(ENTRADAS_CONTAS).insert({ entrada_id: entrada.id, conta_pagar_id: conta.id });
  }

  const temItem = await adminDb(ITENS)
    .where('entrada_id', entrada.id)
    .where('conta_pagar_id', conta.id)
    .first();
  if (temItem) return false;

  // não alocar conta que já está presa em outra entrada
  const jaAlocado = await adminDb(ITENS)
    .where('conta_pagar_id', conta.id)
    .sum('valor_item as total')
    .first();
  if (toNumber(jaAlocado.total) > 0.01) return false;

  await adminDb(ITENS).insert({
    conta_pagar_id: conta.id,
    tipo_origem: 'entrada_mercadoria',
    entrada_id: entrada.id,
    descricao_item: `Alocação da entrada ${entrada.numeronf || entrada.numerorr}`,
    documento_referencia: entrada.numeronf || entrada.numerorr || null,
    valor_item: toNumber(conta.valor),
    origem_match: origemMatch,
    observacoes,
    criado_por: username,
    atualizado_por: username,
  });
  return true;
}

async function entradaTemComplemento(entradaId) {
  const row = await adminDb(ITENS)
    .join(CONTAS, `${ITENS}.conta_pagar_id`, `${CONTAS}.id`)
    .where(`${ITENS}.entrada_id`, entradaId)
    .where(`${CONTAS}.tipo_titulo`, 'complemento')
    .where(`${CONTAS}.status`, '!=', 'cancelado')
    .first(`${CONTAS}.id`);
  return Boolean(row);
}

async function criarContaComplemento({ entrada, fornecedor, valor, dataVencimento, sufixo, descricao, username, observacoes }) {
  const status = inferStatus(dataVencimento);
  const [contaId] = await adminDb(CONTAS).insert({
    origem: 'manual',
    tipo_titulo: 'complemento',
    natureza: 'mercadoria',
    fornecedor: fornecedor.nome,
    fornecedor_id: fornecedor.id,
    erp_fornecedor_id: fornecedor.codiforn,
    descricao,
    documento: entrada.numeronf ? `NF-${entrada.numeronf}/PF` : null,
    referencia: `${entrada.numerorr || `ENT-${entrada.id}`}-${sufixo}`,
    valor: toNumber(valor),
    data_emissao: entrada.data_emissao || null,
    data_vencimento: dataVencimento,
    status,
    forma_pagamento: 'transferencia',
    codiloja: entrada.codiloja || null,
    valor_pago: 0,
    saldo_aberto: toNumber(valor),
    status_conciliacao: 'sem_itens',
    observacoes: observacoes || null,
    criado_por: username,
  });
  const conta = await adminDb(CONTAS).where('id', contaId).first();
  try {
    // origem_match é enum fechado (manual|sugestao|confirmado|legado):
    // 'confirmado' marca vínculo criado automaticamente com certeza.
    await vincularContaEntrada(conta, entrada, {
      origemMatch: 'confirmado',
      username,
      observacoes: 'Complemento "por fora" gerado pela regra do fornecedor.',
    });
  } catch (err) {
    // não deixa conta órfã se o vínculo falhar
    await adminDb(ITENS).where('conta_pagar_id', contaId).del();
    await adminDb(ENTRADAS_CONTAS).where('conta_pagar_id', contaId).del();
    await adminDb(CONTAS).where('id', contaId).del();
    throw err;
  }
  return conta;
}

/**
 * Gera os complementos de UMA entrada (regra fator). Retorna:
 *  { gerado: bool, motivo?: string, contas?: [...] }
 */
async function gerarComplementosEntrada(entrada, fornecedor, { username = 'system' } = {}) {
  if (fornecedor.complemento_tipo !== 'fator') return { gerado: false, motivo: 'regra_nao_fator' };
  const fator = toNumber(fornecedor.complemento_fator);
  if (!(fator > 0)) return { gerado: false, motivo: 'fator_invalido' };

  if (fornecedor.complemento_desde) {
    const emissao = String(entrada.data_emissao || '').slice(0, 10);
    const desde = String(fornecedor.complemento_desde).slice(0, 10);
    if (!emissao || emissao < desde) return { gerado: false, motivo: 'antes_da_regra' };
  }

  if (await entradaTemComplemento(entrada.id)) return { gerado: false, motivo: 'ja_tem_complemento' };

  const base = baseDaRegra(entrada, fornecedor);
  if (!(base > 0)) return { gerado: false, motivo: 'base_zerada' };
  const valorTotal = toNumber(base * fator);
  if (!(valorTotal > 0)) return { gerado: false, motivo: 'valor_zerado' };

  const nf = entrada.numeronf || entrada.numerorr || `entrada ${entrada.id}`;
  const contasCriadas = [];

  if (fornecedor.complemento_vencimento === 'data_fixa') {
    const baseData = entrada.data_entrada || entrada.data_emissao || hojeISO();
    const venc = addDias(baseData, fornecedor.complemento_dias || 0);
    const conta = await criarContaComplemento({
      entrada,
      fornecedor,
      valor: valorTotal,
      dataVencimento: venc,
      sufixo: 'C1',
      descricao: `Complemento "por fora" da NF ${nf} (${(fator * 100).toFixed(2)}% s/ ${fornecedor.complemento_base === 'total_produtos' ? 'produtos' : 'NF'})`,
      username,
    });
    contasCriadas.push(conta);
  } else {
    // junto_parcelas: precisa das duplicatas do ERP já sincronizadas
    const parcelas = await parcelasDaEntrada(entrada);
    if (parcelas.length === 0) return { gerado: false, motivo: 'aguardando_parcelas' };

    const somaParcelas = toNumber(parcelas.reduce((s, p) => s + toNumber(p.valor), 0));
    if (Math.abs(somaParcelas - toNumber(entrada.total_faturado)) > TOLERANCIA) {
      return { gerado: false, motivo: 'parcelas_incompletas' };
    }

    // de passagem, amarra as duplicatas à entrada (mesma regra conservadora
    // do vínculo manual: referência exata + soma batendo com a NF)
    for (const p of parcelas) {
      const vinculou = await vincularContaEntrada(p, entrada, {
        origemMatch: 'confirmado',
        username,
        observacoes: `Vínculo pela referência ${p.referencia}.`,
      });
      if (vinculou) await recalcContaDependencies(p.id);
    }

    let restante = valorTotal;
    for (let i = 0; i < parcelas.length; i++) {
      const p = parcelas[i];
      const ultimo = i === parcelas.length - 1;
      const valorParc = ultimo
        ? toNumber(restante)
        : toNumber(valorTotal * (toNumber(p.valor) / somaParcelas));
      restante = toNumber(restante - valorParc);
      if (!(valorParc > 0)) continue;

      const conta = await criarContaComplemento({
        entrada,
        fornecedor,
        valor: valorParc,
        dataVencimento: String(p.data_vencimento).slice(0, 10),
        sufixo: `C${i + 1}`,
        descricao: `Complemento "por fora" da NF ${nf} — parcela ${i + 1}/${parcelas.length}`,
        username,
      });
      contasCriadas.push(conta);
    }
  }

  for (const conta of contasCriadas) {
    await recalcContaDependencies(conta.id);
  }

  return { gerado: contasCriadas.length > 0, contas: contasCriadas };
}

/**
 * Varre as entradas de fornecedores com regra `fator` ativa e gera o que falta.
 * Chamado ao fim do sync de entradas e sob demanda.
 */
async function gerarComplementosPendentes({ username = 'system' } = {}) {
  const stats = { entradas_avaliadas: 0, geradas: 0, contas_criadas: 0, aguardando_parcelas: 0, erros: 0 };

  const fornecedores = await adminDb(FORNECEDORES)
    .where('complemento_tipo', 'fator')
    .where('ativo', true);
  if (fornecedores.length === 0) return stats;

  for (const fornecedor of fornecedores) {
    let q = adminDb(ENTRADAS).where('codiforn', fornecedor.codiforn);
    if (fornecedor.complemento_desde) {
      q = q.where('data_emissao', '>=', String(fornecedor.complemento_desde).slice(0, 10));
    }
    const entradas = await q.orderBy('data_emissao', 'asc');

    for (const entrada of entradas) {
      stats.entradas_avaliadas += 1;
      try {
        const r = await gerarComplementosEntrada(entrada, fornecedor, { username });
        if (r.gerado) {
          stats.geradas += 1;
          stats.contas_criadas += r.contas.length;
        } else if (r.motivo === 'aguardando_parcelas' || r.motivo === 'parcelas_incompletas') {
          stats.aguardando_parcelas += 1;
        }
      } catch (err) {
        stats.erros += 1;
        console.error(`❌ Complemento entrada ${entrada.numerorr || entrada.id}:`, err.message);
      }
    }
  }

  if (stats.contas_criadas > 0 || stats.aguardando_parcelas > 0) {
    console.log(`💸 Complementos: ${stats.contas_criadas} contas geradas em ${stats.geradas} entradas`
      + ` | ${stats.aguardando_parcelas} aguardando parcelas do ERP`);
  }
  return stats;
}

/**
 * Complemento manual (regra `valor_informado`, ou exceção pontual):
 * cria UMA conta complemento com valor/vencimento informados.
 */
async function criarComplementoManual(entradaId, { valor, data_vencimento, observacoes, username }) {
  const entrada = await adminDb(ENTRADAS).where('id', entradaId).first();
  if (!entrada) throw Object.assign(new Error('Entrada não encontrada.'), { status: 404 });

  const valorNum = toNumber(valor);
  if (!(valorNum > 0)) throw Object.assign(new Error('Informe um valor maior que zero.'), { status: 400 });
  const venc = String(data_vencimento || '').slice(0, 10) || hojeISO();

  let fornecedor = await adminDb(FORNECEDORES).where('codiforn', String(entrada.codiforn)).first();
  if (!fornecedor) {
    // fallback: sem cadastro espelho ainda — cria conta sem fornecedor_id
    fornecedor = { id: null, nome: entrada.fornecedor, codiforn: String(entrada.codiforn || '') || null };
  }

  // sufixo após os já existentes (C1, C2...)
  const existentes = await adminDb(ITENS)
    .join(CONTAS, `${ITENS}.conta_pagar_id`, `${CONTAS}.id`)
    .where(`${ITENS}.entrada_id`, entradaId)
    .where(`${CONTAS}.tipo_titulo`, 'complemento')
    .count('* as n')
    .first();
  const sufixo = `C${Number(existentes.n) + 1}`;

  const nf = entrada.numeronf || entrada.numerorr || `entrada ${entrada.id}`;
  const conta = await criarContaComplemento({
    entrada,
    fornecedor,
    valor: valorNum,
    dataVencimento: venc,
    sufixo,
    descricao: `Complemento "por fora" da NF ${nf} (valor informado)`,
    username,
    observacoes,
  });
  await recalcContaDependencies(conta.id);
  return adminDb(CONTAS).where('id', conta.id).first();
}

module.exports = {
  gerarComplementosEntrada,
  gerarComplementosPendentes,
  criarComplementoManual,
};
