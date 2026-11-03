const { adminDb } = require('../config/database');
const { toNumber, recalcContaDependencies } = require('./reconciliationService');
const { hasTable, hasColumn } = require('./schemaCompatService');

const CONTAS = 'contas_pagar';
const BAIXAS = 'contas_pagar_baixas';
const BANCOS = 'contas_bancarias';
const DOCUMENTOS = 'contas_pagar_baixa_documentos';
const DOCUMENTO_PAGAMENTOS = 'contas_pagar_baixa_documento_pagamentos';

async function assertDocumentoSchemaReady() {
  const hasDocumentos = await hasTable(DOCUMENTOS);
  const hasPagamentos = await hasTable(DOCUMENTO_PAGAMENTOS);
  const hasBaixas = await hasTable(BAIXAS);
  const hasDocumentoBaixaId = hasBaixas && await hasColumn(BAIXAS, 'documento_baixa_id');

  if (!hasDocumentos || !hasPagamentos || !hasDocumentoBaixaId) {
    throw new Error('Estrutura de documentos de baixa ainda não foi criada. Rode as migrations pendentes.');
  }
}

function getSaldoAbertoConta(conta) {
  if (conta?.saldo_aberto !== undefined && conta?.saldo_aberto !== null) {
    return Math.max(0, toNumber(conta.saldo_aberto));
  }

  const valor = toNumber(conta?.valor || 0);
  const pago = toNumber(conta?.valor_pago || 0);
  const desconto = toNumber(conta?.valor_desconto || 0);
  return Math.max(0, toNumber(valor - pago - desconto));
}

function buildDocumentoResumoPagamentos(pagamentos) {
  const formas = [...new Set(pagamentos.map((item) => item.forma_pagamento).filter(Boolean))];
  const formaPagamento = formas.length === 1 ? formas[0] : 'multiplo';

  if (pagamentos.length === 1) {
    return {
      forma_pagamento: formaPagamento,
      conta_bancaria_id: pagamentos[0].conta_bancaria_id || null,
      banco_baixa: pagamentos[0].banco_baixa || null,
    };
  }

  return {
    forma_pagamento: formaPagamento,
    conta_bancaria_id: null,
    banco_baixa: `${pagamentos.length} formas no documento`,
  };
}

function normalizePagamentosInput(payloadPagamentos, payload, totalEsperado) {
  let pagamentos = Array.isArray(payloadPagamentos) ? payloadPagamentos : [];

  if (pagamentos.length === 0 && payload?.forma_pagamento) {
    pagamentos = [{
      forma_pagamento: payload.forma_pagamento,
      valor: totalEsperado,
      conta_bancaria_id: payload.conta_bancaria_id || null,
      banco_baixa: payload.banco_baixa || null,
      observacoes: payload.observacoes || null,
      referencia_externa: payload.referencia_externa || null,
    }];
  }

  if (pagamentos.length === 0) {
    throw new Error('Informe ao menos uma forma de pagamento para o documento.');
  }

  const normalized = pagamentos.map((item, index) => {
    const formaPagamento = item.forma_pagamento || item.forma || '';
    const valor = toNumber(item.valor);
    const contaBancariaId = item.conta_bancaria_id ? parseInt(item.conta_bancaria_id, 10) : null;

    if (!formaPagamento) {
      throw new Error(`Forma de pagamento da linha ${index + 1} não informada.`);
    }
    if (valor <= 0) {
      throw new Error(`Valor da forma de pagamento ${index + 1} deve ser maior que zero.`);
    }

    return {
      ordem: index + 1,
      forma_pagamento: formaPagamento,
      valor,
      conta_bancaria_id: Number.isNaN(contaBancariaId) ? null : contaBancariaId,
      banco_baixa: item.banco_baixa || null,
      referencia_externa: item.referencia_externa || null,
      observacoes: item.observacoes || null,
    };
  });

  const totalPagamentos = toNumber(normalized.reduce((sum, item) => sum + item.valor, 0));
  if (Math.abs(totalPagamentos - totalEsperado) > 0.05) {
    throw new Error(`A soma das formas (${totalPagamentos.toFixed(2)}) precisa bater com o total pago (${totalEsperado.toFixed(2)}).`);
  }

  return normalized;
}

async function normalizeContasInput(payloadContas, payload, existingByConta = new Map()) {
  let contas = Array.isArray(payloadContas) ? payloadContas : [];

  if (contas.length === 0 && Array.isArray(payload?.contas_ids)) {
    const valores = payload?.valores || {};
    const descontos = payload?.descontos || {};
    const juros = payload?.juros || {};
    const multas = payload?.multas || {};

    contas = payload.contas_ids.map((contaId) => ({
      conta_id: contaId,
      valor_pago: payload?.quitar_total === false ? valores[contaId] : undefined,
      valor_desconto: descontos[contaId],
      valor_juros: juros[contaId],
      valor_multa: multas[contaId],
    }));
  }

  if (contas.length === 0) {
    throw new Error('Informe ao menos uma conta para o documento de baixa.');
  }

  const normalizedIds = [...new Set(
    contas
      .map((item) => parseInt(item.conta_id ?? item.id, 10))
      .filter((id) => !Number.isNaN(id))
  )];

  if (normalizedIds.length !== contas.length) {
    throw new Error('Há contas duplicadas ou inválidas na seleção.');
  }

  const contasDb = await adminDb(CONTAS).whereIn('id', normalizedIds);
  const contaMap = new Map(contasDb.map((conta) => [conta.id, conta]));

  const normalized = contas.map((item, index) => {
    const contaId = parseInt(item.conta_id ?? item.id, 10);
    const conta = contaMap.get(contaId);
    if (!conta) throw new Error(`Conta ${contaId} não encontrada.`);

    const existingBaixa = existingByConta.get(contaId);
    const saldoAtual = getSaldoAbertoConta(conta);
    const limiteCobertura = toNumber(
      saldoAtual
      + toNumber(existingBaixa?.valor_pago || 0)
      + toNumber(existingBaixa?.valor_desconto || 0)
    );

    if (!existingBaixa && conta.status === 'cancelado') {
      throw new Error(`Conta ${contaId} está cancelada e não pode receber baixa.`);
    }
    if (!existingBaixa && conta.status === 'pago' && limiteCobertura <= 0.01) {
      throw new Error(`Conta ${contaId} já está quitada.`);
    }

    const valorPago = item.valor_pago !== undefined && item.valor_pago !== null && item.valor_pago !== ''
      ? toNumber(item.valor_pago)
      : (existingBaixa ? toNumber(existingBaixa.valor_pago) : saldoAtual);
    const desconto = item.valor_desconto !== undefined && item.valor_desconto !== null && item.valor_desconto !== ''
      ? toNumber(item.valor_desconto)
      : toNumber(existingBaixa?.valor_desconto || 0);
    const juros = item.valor_juros !== undefined && item.valor_juros !== null && item.valor_juros !== ''
      ? toNumber(item.valor_juros)
      : toNumber(existingBaixa?.valor_juros || 0);
    const multa = item.valor_multa !== undefined && item.valor_multa !== null && item.valor_multa !== ''
      ? toNumber(item.valor_multa)
      : toNumber(existingBaixa?.valor_multa || 0);

    if (valorPago <= 0 && desconto <= 0) {
      throw new Error(`Conta ${contaId}: informe valor pago ou desconto maior que zero.`);
    }

    const cobertura = toNumber(valorPago + desconto);
    if (cobertura > limiteCobertura + 0.05) {
      throw new Error(
        `Conta ${contaId}: cobertura ${cobertura.toFixed(2)} excede o saldo disponível ${limiteCobertura.toFixed(2)}.`
      );
    }

    return {
      ordem: index + 1,
      conta_id: contaId,
      valor_pago: valorPago,
      valor_desconto: desconto,
      valor_juros: juros,
      valor_multa: multa,
      observacoes: item.observacoes || null,
      conta,
      limite_cobertura: limiteCobertura,
      total_saida: toNumber(valorPago + juros + multa),
      total_cobertura: cobertura,
    };
  });

  return normalized;
}

async function normalizeDocumentoPayload(payload, existingByConta = new Map()) {
  const contas = await normalizeContasInput(payload?.contas, payload, existingByConta);
  const totalPagamentosEsperado = toNumber(contas.reduce((sum, item) => sum + item.total_saida, 0));
  const pagamentos = normalizePagamentosInput(payload?.pagamentos, payload, totalPagamentosEsperado);

  return {
    data_documento: payload?.data_documento || payload?.data_pagamento || new Date().toISOString().slice(0, 10),
    observacoes: payload?.observacoes || null,
    contas,
    pagamentos,
    totals: {
      quantidade_contas: contas.length,
      total_contas: toNumber(contas.reduce((sum, item) => sum + item.total_cobertura, 0)),
      total_pagamentos: totalPagamentosEsperado,
    },
  };
}

async function getBaixaDocumento(documentoId) {
  await assertDocumentoSchemaReady();
  const documento = await adminDb(DOCUMENTOS)
    .where('id', documentoId)
    .first();

  if (!documento) return null;

  const pagamentos = await adminDb(DOCUMENTO_PAGAMENTOS)
    .select(
      `${DOCUMENTO_PAGAMENTOS}.*`,
      `${BANCOS}.nome as conta_bancaria_nome`,
      `${BANCOS}.banco_codigo as conta_bancaria_codigo`
    )
    .leftJoin(BANCOS, `${DOCUMENTO_PAGAMENTOS}.conta_bancaria_id`, `${BANCOS}.id`)
    .where(`${DOCUMENTO_PAGAMENTOS}.documento_baixa_id`, documentoId)
    .orderBy(`${DOCUMENTO_PAGAMENTOS}.ordem`, 'asc')
    .orderBy(`${DOCUMENTO_PAGAMENTOS}.id`, 'asc');

  const baixas = await adminDb(BAIXAS)
    .select(
      `${BAIXAS}.*`,
      `${CONTAS}.fornecedor`,
      `${CONTAS}.documento`,
      `${CONTAS}.historico`,
      `${CONTAS}.data_vencimento`,
      `${CONTAS}.valor as valor_conta`,
      `${CONTAS}.saldo_aberto as conta_saldo_aberto`
    )
    .leftJoin(CONTAS, `${BAIXAS}.conta_pagar_id`, `${CONTAS}.id`)
    .where(`${BAIXAS}.documento_baixa_id`, documentoId)
    .orderBy(`${BAIXAS}.id`, 'asc');

  return {
    ...documento,
    pagamentos,
    baixas,
  };
}

async function createBaixaDocumento({ payload, username }) {
  await assertDocumentoSchemaReady();
  const normalized = await normalizeDocumentoPayload(payload);
  const resumo = buildDocumentoResumoPagamentos(normalized.pagamentos);
  let documentoId = null;
  const contaIds = normalized.contas.map((item) => item.conta_id);

  await adminDb.transaction(async (trx) => {
    const [newId] = await trx(DOCUMENTOS).insert({
      data_documento: normalized.data_documento,
      quantidade_contas: normalized.totals.quantidade_contas,
      total_contas: normalized.totals.total_contas,
      total_pagamentos: normalized.totals.total_pagamentos,
      observacoes: normalized.observacoes,
      criado_por: username,
      atualizado_por: username,
    });
    documentoId = newId;

    await trx(DOCUMENTOS)
      .where('id', documentoId)
      .update({
        codigo: `BDX-${String(documentoId).padStart(6, '0')}`,
        atualizado_por: username,
      });

    const pagamentosInserts = normalized.pagamentos.map((item) => ({
      documento_baixa_id: documentoId,
      ordem: item.ordem,
      forma_pagamento: item.forma_pagamento,
      valor: item.valor,
      conta_bancaria_id: item.conta_bancaria_id,
      banco_baixa: item.banco_baixa,
      referencia_externa: item.referencia_externa,
      observacoes: item.observacoes,
    }));
    await trx(DOCUMENTO_PAGAMENTOS).insert(pagamentosInserts);

    const baixasInserts = normalized.contas.map((item) => ({
      documento_baixa_id: documentoId,
      conta_pagar_id: item.conta_id,
      data_pagamento: normalized.data_documento,
      valor_pago: item.valor_pago,
      valor_desconto: item.valor_desconto,
      valor_juros: item.valor_juros,
      valor_multa: item.valor_multa,
      forma_pagamento: resumo.forma_pagamento,
      conta_bancaria_id: resumo.conta_bancaria_id,
      banco_baixa: resumo.banco_baixa,
      origem: normalized.contas.length > 1 || normalized.pagamentos.length > 1 ? 'lote' : 'manual',
      observacoes: item.observacoes || normalized.observacoes,
      criado_por: username,
      atualizado_por: username,
    }));
    await trx(BAIXAS).insert(baixasInserts);
  });

  for (const contaId of contaIds) {
    await recalcContaDependencies(contaId);
  }

  return getBaixaDocumento(documentoId);
}

async function updateBaixaDocumento(documentoId, { payload, username }) {
  await assertDocumentoSchemaReady();
  const documentoAtual = await adminDb(DOCUMENTOS).where('id', documentoId).first();
  if (!documentoAtual) {
    throw new Error('Documento de baixa não encontrado.');
  }
  if (documentoAtual.status === 'estornado') {
    throw new Error('Documento de baixa estornado não pode ser editado.');
  }

  const baixasAtuais = await adminDb(BAIXAS)
    .where('documento_baixa_id', documentoId)
    .where('estornada', false);
  const existingByConta = new Map(baixasAtuais.map((item) => [item.conta_pagar_id, item]));

  const normalized = await normalizeDocumentoPayload(payload, existingByConta);
  const resumo = buildDocumentoResumoPagamentos(normalized.pagamentos);
  const novasContasMap = new Map(normalized.contas.map((item) => [item.conta_id, item]));
  const contasAfetadas = new Set([
    ...baixasAtuais.map((item) => item.conta_pagar_id),
    ...normalized.contas.map((item) => item.conta_id),
  ]);

  await adminDb.transaction(async (trx) => {
    await trx(DOCUMENTOS)
      .where('id', documentoId)
      .update({
        data_documento: normalized.data_documento,
        quantidade_contas: normalized.totals.quantidade_contas,
        total_contas: normalized.totals.total_contas,
        total_pagamentos: normalized.totals.total_pagamentos,
        observacoes: normalized.observacoes,
        atualizado_por: username,
      });

    await trx(DOCUMENTO_PAGAMENTOS)
      .where('documento_baixa_id', documentoId)
      .del();

    await trx(DOCUMENTO_PAGAMENTOS).insert(
      normalized.pagamentos.map((item) => ({
        documento_baixa_id: documentoId,
        ordem: item.ordem,
        forma_pagamento: item.forma_pagamento,
        valor: item.valor,
        conta_bancaria_id: item.conta_bancaria_id,
        banco_baixa: item.banco_baixa,
        referencia_externa: item.referencia_externa,
        observacoes: item.observacoes,
      }))
    );

    for (const baixaAtual of baixasAtuais) {
      const novaConta = novasContasMap.get(baixaAtual.conta_pagar_id);
      if (!novaConta) {
        await trx(BAIXAS)
          .where('id', baixaAtual.id)
          .update({
            estornada: true,
            estornada_em: new Date(),
            estornada_por: username,
            estorno_motivo: `Removida na edição do documento ${documentoAtual.codigo || documentoId}`,
            atualizado_por: username,
          });
        continue;
      }

      await trx(BAIXAS)
        .where('id', baixaAtual.id)
        .update({
          data_pagamento: normalized.data_documento,
          valor_pago: novaConta.valor_pago,
          valor_desconto: novaConta.valor_desconto,
          valor_juros: novaConta.valor_juros,
          valor_multa: novaConta.valor_multa,
          forma_pagamento: resumo.forma_pagamento,
          conta_bancaria_id: resumo.conta_bancaria_id,
          banco_baixa: resumo.banco_baixa,
          observacoes: novaConta.observacoes || normalized.observacoes,
          atualizado_por: username,
        });
        novasContasMap.delete(baixaAtual.conta_pagar_id);
    }

    if (novasContasMap.size > 0) {
      await trx(BAIXAS).insert(
        Array.from(novasContasMap.values()).map((item) => ({
          documento_baixa_id: documentoId,
          conta_pagar_id: item.conta_id,
          data_pagamento: normalized.data_documento,
          valor_pago: item.valor_pago,
          valor_desconto: item.valor_desconto,
          valor_juros: item.valor_juros,
          valor_multa: item.valor_multa,
          forma_pagamento: resumo.forma_pagamento,
          conta_bancaria_id: resumo.conta_bancaria_id,
          banco_baixa: resumo.banco_baixa,
          origem: normalized.contas.length > 1 || normalized.pagamentos.length > 1 ? 'lote' : 'manual',
          observacoes: item.observacoes || normalized.observacoes,
          criado_por: username,
          atualizado_por: username,
        }))
      );
    }
  });

  for (const contaId of contasAfetadas) {
    await recalcContaDependencies(contaId);
  }

  return getBaixaDocumento(documentoId);
}

async function estornarBaixaDocumento(documentoId, { username, motivo = null }) {
  await assertDocumentoSchemaReady();
  const documentoAtual = await adminDb(DOCUMENTOS).where('id', documentoId).first();
  if (!documentoAtual) {
    throw new Error('Documento de baixa não encontrado.');
  }
  if (documentoAtual.status === 'estornado') {
    throw new Error('Documento de baixa já está estornado.');
  }

  const baixasAtuais = await adminDb(BAIXAS)
    .where('documento_baixa_id', documentoId)
    .where('estornada', false);
  const contaIds = [...new Set(baixasAtuais.map((item) => item.conta_pagar_id))];

  await adminDb.transaction(async (trx) => {
    await trx(DOCUMENTOS)
      .where('id', documentoId)
      .update({
        status: 'estornado',
        estornado_em: new Date(),
        estornado_por: username,
        estorno_motivo: motivo || null,
        atualizado_por: username,
      });

    await trx(BAIXAS)
      .where('documento_baixa_id', documentoId)
      .where('estornada', false)
      .update({
        estornada: true,
        estornada_em: new Date(),
        estornada_por: username,
        estorno_motivo: motivo || `Documento ${documentoAtual.codigo || documentoId} estornado`,
        atualizado_por: username,
      });
  });

  for (const contaId of contaIds) {
    await recalcContaDependencies(contaId);
  }

  return getBaixaDocumento(documentoId);
}

module.exports = {
  getBaixaDocumento,
  createBaixaDocumento,
  updateBaixaDocumento,
  estornarBaixaDocumento,
  getSaldoAbertoConta,
};
