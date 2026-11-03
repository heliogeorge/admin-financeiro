import { useEffect, useMemo, useState } from 'react';
import { Check, CreditCard, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { formatCurrency, formatDate } from '../lib/utils';

const FORMAS_PAGAMENTO = [
  { value: 'pix', label: 'PIX' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'debito_auto', label: 'Débito automático' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'cartao_credito', label: 'Cartão de crédito' },
  { value: 'cartao_debito', label: 'Cartão de débito' },
  { value: 'dinheiro', label: 'Dinheiro' },
];

function toNumber(value) {
  return Math.round((parseFloat(value || 0) + Number.EPSILON) * 100) / 100;
}

function getContaSaldo(conta) {
  if (conta?.saldo_aberto !== undefined && conta?.saldo_aberto !== null && conta?.saldo_aberto !== '') {
    return Math.max(0, toNumber(conta.saldo_aberto));
  }
  return Math.max(0, toNumber(conta?.valor));
}

function buildContaRow(conta) {
  const saldo = getContaSaldo(conta);
  return {
    conta_id: conta.id,
    fornecedor: conta.fornecedor,
    documento: conta.documento,
    historico: conta.historico || conta.descricao,
    data_vencimento: conta.data_vencimento,
    saldo_disponivel: saldo,
    valor_pago: saldo.toFixed(2),
    valor_desconto: '0.00',
    valor_juros: '0.00',
    valor_multa: '0.00',
    observacoes: '',
  };
}

function buildContaRowFromDocumento(baixa) {
  const saldoDisponivel = Math.max(
    0,
    toNumber(baixa.conta_saldo_aberto) + toNumber(baixa.valor_pago) + toNumber(baixa.valor_desconto)
  );

  return {
    conta_id: baixa.conta_pagar_id,
    fornecedor: baixa.fornecedor,
    documento: baixa.documento,
    historico: baixa.historico,
    data_vencimento: baixa.data_vencimento,
    saldo_disponivel: saldoDisponivel,
    valor_pago: toNumber(baixa.valor_pago).toFixed(2),
    valor_desconto: toNumber(baixa.valor_desconto).toFixed(2),
    valor_juros: toNumber(baixa.valor_juros).toFixed(2),
    valor_multa: toNumber(baixa.valor_multa).toFixed(2),
    observacoes: baixa.observacoes || '',
  };
}

function emptyPagamento(total = 0) {
  return {
    forma_pagamento: '',
    valor: total > 0 ? total.toFixed(2) : '',
    conta_bancaria_id: '',
    banco_baixa: '',
    observacoes: '',
    referencia_externa: '',
  };
}

export default function BaixaLoteModal({
  isOpen,
  onClose,
  onConfirm,
  contasSelecionadas = [],
  contasBancarias = [],
  editDocumento = null,
}) {
  const isEdit = !!editDocumento;
  const [dataDocumento, setDataDocumento] = useState(new Date().toISOString().slice(0, 10));
  const [observacoes, setObservacoes] = useState('');
  const [contas, setContas] = useState([]);
  const [pagamentos, setPagamentos] = useState([emptyPagamento()]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    if (isEdit && editDocumento) {
      const contasDocumento = (editDocumento.baixas || [])
        .filter((item) => !item.estornada)
        .map(buildContaRowFromDocumento);
      const totalDocumento = contasDocumento.reduce(
        (sum, item) => sum + toNumber(item.valor_pago) + toNumber(item.valor_juros) + toNumber(item.valor_multa),
        0
      );

      setDataDocumento((editDocumento.data_documento || '').slice(0, 10) || new Date().toISOString().slice(0, 10));
      setObservacoes(editDocumento.observacoes || '');
      setContas(contasDocumento);
      setPagamentos(
        (editDocumento.pagamentos || []).length > 0
          ? editDocumento.pagamentos.map((item) => ({
            forma_pagamento: item.forma_pagamento || '',
            valor: toNumber(item.valor).toFixed(2),
            conta_bancaria_id: item.conta_bancaria_id || '',
            banco_baixa: item.banco_baixa || '',
            observacoes: item.observacoes || '',
            referencia_externa: item.referencia_externa || '',
          }))
          : [emptyPagamento(totalDocumento)]
      );
      return;
    }

    const contasBase = contasSelecionadas.map(buildContaRow);
    const totalBase = contasBase.reduce((sum, item) => sum + toNumber(item.valor_pago), 0);
    setDataDocumento(new Date().toISOString().slice(0, 10));
    setObservacoes('');
    setContas(contasBase);
    setPagamentos([emptyPagamento(totalBase)]);
  }, [isOpen, isEdit, editDocumento, contasSelecionadas]);

  const totais = useMemo(() => {
    const totalContas = contas.reduce(
      (sum, item) => sum + toNumber(item.valor_pago) + toNumber(item.valor_desconto),
      0
    );
    const totalSaindo = contas.reduce(
      (sum, item) => sum + toNumber(item.valor_pago) + toNumber(item.valor_juros) + toNumber(item.valor_multa),
      0
    );
    const totalPagamentos = pagamentos.reduce((sum, item) => sum + toNumber(item.valor), 0);
    return {
      totalContas,
      totalSaindo,
      totalPagamentos,
      diferenca: toNumber(totalSaindo - totalPagamentos),
    };
  }, [contas, pagamentos]);

  if (!isOpen) return null;

  const updateConta = (contaId, field, value) => {
    setContas((prev) => prev.map((item) => (
      item.conta_id === contaId ? { ...item, [field]: value } : item
    )));
  };

  const removeConta = (contaId) => {
    setContas((prev) => prev.filter((item) => item.conta_id !== contaId));
  };

  const addPagamento = () => {
    setPagamentos((prev) => [...prev, emptyPagamento()]);
  };

  const updatePagamento = (index, field, value) => {
    setPagamentos((prev) => prev.map((item, idx) => (
      idx === index ? { ...item, [field]: value } : item
    )));
  };

  const removePagamento = (index) => {
    if (pagamentos.length === 1) return;
    setPagamentos((prev) => prev.filter((_, idx) => idx !== index));
  };

  const preencherPagamentoTotal = () => {
    if (pagamentos.length === 0) return;
    setPagamentos((prev) => prev.map((item, index) => (
      index === 0
        ? { ...item, valor: totais.totalSaindo.toFixed(2) }
        : { ...item, valor: '0.00' }
    )));
  };

  const handleSubmit = async () => {
    if (contas.length === 0) {
      toast.error('Selecione ao menos uma conta para a baixa.');
      return;
    }

    for (const conta of contas) {
      const valorPago = toNumber(conta.valor_pago);
      const valorDesconto = toNumber(conta.valor_desconto);
      const cobertura = toNumber(valorPago + valorDesconto);
      if (cobertura <= 0) {
        toast.error(`Conta ${conta.conta_id}: informe valor pago ou desconto.`);
        return;
      }
      if (cobertura > toNumber(conta.saldo_disponivel) + 0.05) {
        toast.error(`Conta ${conta.conta_id}: valor excede o saldo disponível.`);
        return;
      }
    }

    for (let index = 0; index < pagamentos.length; index += 1) {
      const pagamento = pagamentos[index];
      if (!pagamento.forma_pagamento) {
        toast.error(`Forma de pagamento ${index + 1} não informada.`);
        return;
      }
      if (toNumber(pagamento.valor) <= 0) {
        toast.error(`Valor da forma de pagamento ${index + 1} deve ser maior que zero.`);
        return;
      }
    }

    if (Math.abs(totais.diferenca) > 0.05) {
      toast.error('A soma das formas de pagamento precisa bater com o total da baixa.');
      return;
    }

    setSubmitting(true);
    try {
      await onConfirm({
        documento_id: editDocumento?.id || null,
        data_documento: dataDocumento,
        observacoes: observacoes || null,
        contas: contas.map((item) => ({
          conta_id: item.conta_id,
          valor_pago: toNumber(item.valor_pago),
          valor_desconto: toNumber(item.valor_desconto),
          valor_juros: toNumber(item.valor_juros),
          valor_multa: toNumber(item.valor_multa),
          observacoes: item.observacoes || null,
        })),
        pagamentos: pagamentos.map((item) => ({
          forma_pagamento: item.forma_pagamento,
          valor: toNumber(item.valor),
          conta_bancaria_id: item.conta_bancaria_id || null,
          banco_baixa: item.banco_baixa || null,
          observacoes: item.observacoes || null,
          referencia_externa: item.referencia_externa || null,
        })),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[94vh] flex flex-col">
        <div className="p-5 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                {isEdit ? `Editar Documento ${editDocumento?.codigo || ''}` : 'Baixa em Lote'}
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {contas.length} conta{contas.length !== 1 ? 's' : ''} selecionada{contas.length !== 1 ? 's' : ''}
              </p>
            </div>
            <button onClick={onClose} className="p-1 rounded-md hover:bg-gray-100 text-gray-400">
              <X size={20} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4">
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-[10px] uppercase text-gray-400 font-semibold">Cobertura</p>
              <p className="text-sm font-bold text-gray-900 mt-0.5">{formatCurrency(totais.totalContas)}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-[10px] uppercase text-gray-400 font-semibold">Saída Financeira</p>
              <p className="text-sm font-bold text-gray-900 mt-0.5">{formatCurrency(totais.totalSaindo)}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-[10px] uppercase text-gray-400 font-semibold">Formas</p>
              <p className="text-sm font-bold text-gray-900 mt-0.5">{formatCurrency(totais.totalPagamentos)}</p>
            </div>
            <div className={`rounded-xl p-3 ${Math.abs(totais.diferenca) <= 0.05 ? 'bg-emerald-50' : 'bg-amber-50'}`}>
              <p className="text-[10px] uppercase text-gray-400 font-semibold">Diferença</p>
              <p className={`text-sm font-bold mt-0.5 ${Math.abs(totais.diferenca) <= 0.05 ? 'text-emerald-700' : 'text-amber-700'}`}>
                {formatCurrency(Math.abs(totais.diferenca))}
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          <div className="grid grid-cols-1 xl:grid-cols-[1.7fr_1fr] gap-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-gray-500 uppercase">Contas Selecionadas</h3>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500">Data do documento</label>
                  <input
                    type="date"
                    value={dataDocumento}
                    onChange={(e) => setDataDocumento(e.target.value)}
                    className="input-field text-sm"
                  />
                </div>
              </div>

              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <div className="max-h-[360px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50/60 border-b border-gray-100 text-xs text-gray-500">
                        <th className="px-3 py-2 text-left">Conta</th>
                        <th className="px-3 py-2 text-left">Venc.</th>
                        <th className="px-3 py-2 text-right">Saldo</th>
                        <th className="px-3 py-2 text-right">Baixar</th>
                        <th className="px-3 py-2 text-center w-16">Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contas.map((conta) => (
                        <tr key={conta.conta_id} className="border-b border-gray-50 last:border-0">
                          <td className="px-3 py-2">
                            <p className="font-medium text-gray-900">{conta.fornecedor}</p>
                            <p className="text-xs text-gray-400 truncate">
                              {conta.documento || '—'} {conta.historico ? `• ${conta.historico}` : ''}
                            </p>
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">{formatDate(conta.data_vencimento)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-amber-700">
                            {formatCurrency(conta.saldo_disponivel)}
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={conta.valor_pago}
                              onChange={(e) => updateConta(conta.conta_id, 'valor_pago', e.target.value)}
                              className="input-field text-right"
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            {contas.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeConta(conta.conta_id)}
                                className="p-1 rounded hover:bg-red-50 text-red-400"
                                title="Remover conta"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-gray-500 uppercase">Pagamentos do Documento</h3>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={preencherPagamentoTotal} className="text-xs text-brand-600 hover:text-brand-700 font-medium">
                    Usar total
                  </button>
                  <button type="button" onClick={addPagamento} className="text-xs text-brand-600 hover:text-brand-700 font-medium">
                    <Plus size={12} className="inline mr-1" />Forma
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {pagamentos.map((pagamento, index) => (
                  <div key={`pagamento-${index}`} className="border border-gray-200 rounded-xl p-4 bg-gray-50/60">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-semibold text-gray-700 flex items-center gap-1">
                        <CreditCard size={13} /> Pagamento {index + 1}
                      </span>
                      {pagamentos.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removePagamento(index)}
                          className="text-xs text-red-400 hover:text-red-600"
                        >
                          Remover
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Forma</label>
                        <select
                          value={pagamento.forma_pagamento}
                          onChange={(e) => updatePagamento(index, 'forma_pagamento', e.target.value)}
                          className="input-field"
                        >
                          <option value="">Selecione</option>
                          {FORMAS_PAGAMENTO.map((item) => (
                            <option key={item.value} value={item.value}>{item.label}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Valor</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={pagamento.valor}
                          onChange={(e) => updatePagamento(index, 'valor', e.target.value)}
                          className="input-field text-right"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Conta bancária</label>
                        {contasBancarias.length > 0 ? (
                          <select
                            value={pagamento.conta_bancaria_id}
                            onChange={(e) => updatePagamento(index, 'conta_bancaria_id', e.target.value)}
                            className="input-field"
                          >
                            <option value="">— sem vínculo —</option>
                            {contasBancarias.map((conta) => (
                              <option key={conta.id} value={conta.id}>
                                {conta.nome}{conta.agencia || conta.conta ? ` — ${conta.agencia}/${conta.conta}` : ''}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={pagamento.banco_baixa}
                            onChange={(e) => updatePagamento(index, 'banco_baixa', e.target.value)}
                            className="input-field"
                            placeholder="Banco/conta"
                          />
                        )}
                      </div>

                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Referência</label>
                        <input
                          type="text"
                          value={pagamento.referencia_externa}
                          onChange={(e) => updatePagamento(index, 'referencia_externa', e.target.value)}
                          className="input-field"
                          placeholder="Doc, NSU, TED, etc."
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Observações do documento</label>
            <textarea
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              className="input-field"
              rows={2}
              placeholder="Ex: pagamento consolidado da remessa do dia"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 p-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <div className={`text-xs font-medium ${Math.abs(totais.diferenca) <= 0.05 ? 'text-emerald-700' : 'text-amber-700'}`}>
            {Math.abs(totais.diferenca) <= 0.05
              ? 'Documento balanceado.'
              : `Ajuste ${formatCurrency(Math.abs(totais.diferenca))} nas formas de pagamento.`}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="button" onClick={handleSubmit} disabled={submitting} className="btn-primary disabled:opacity-50">
              {submitting ? <RefreshCw size={16} className="animate-spin" /> : <Check size={16} />}
              {isEdit ? 'Salvar Documento' : 'Gerar Documento de Baixa'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
