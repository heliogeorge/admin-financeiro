import { useState, useEffect, useRef } from 'react';
import {
  contasPagarApi, syncApi, chequesApi, inboxApi, contasBancariasApi, planoContasApi,
} from '../lib/api';
import BaixaLoteModal from '../components/BaixaLoteModal';
import {
  formatCurrency, formatDate, formatDateRelative, getDefaultDateRange,
  getStatusLabel, getStatusBadge,
} from '../lib/utils';
import {
  Plus, Search, ChevronLeft, ChevronRight, RefreshCw,
  X, Check, Trash2, Download, Pencil, Database, FileText,
  BookOpen, CreditCard, Inbox, Link2, Paperclip, Upload,
  Clock, AlertTriangle, Undo2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import LojaSelect from '../components/LojaSelect';
import LojaLabel from '../components/LojaLabel';

const CONCILIACAO_META = {
  sem_itens: { label: 'Sem itens', badge: 'bg-gray-100 text-gray-600' },
  parcial: { label: 'Parcial', badge: 'bg-amber-100 text-amber-700' },
  conciliado: { label: 'Conciliado', badge: 'bg-emerald-100 text-emerald-700' },
  divergente: { label: 'Divergente', badge: 'bg-red-100 text-red-700' },
};

const NATUREZA_LABELS = {
  mercadoria: 'Mercadoria',
  despesa_geral: 'Despesa geral',
  nao_classificada: 'Nao classificada',
};

function getConciliacaoMeta(status) {
  return CONCILIACAO_META[status] || CONCILIACAO_META.sem_itens;
}

function formatNaturezaLabel(natureza) {
  if (!natureza) return '—';
  return NATUREZA_LABELS[natureza] || natureza.replaceAll('_', ' ');
}

function getSaldoContaAberto(conta) {
  if (conta?.saldo_aberto !== undefined && conta?.saldo_aberto !== null && conta?.saldo_aberto !== '') {
    return Math.max(0, parseFloat(conta.saldo_aberto) || 0);
  }
  return Math.max(0, parseFloat(conta?.valor) || 0);
}

function buildPlanoContasParams(codiloja) {
  const params = { pagareci: 'P', ativo: 'true', analitica: 'true', limit: 800 };
  if (codiloja) params.codiloja = codiloja;
  return params;
}

function formatPlanoOptionLabel(plano) {
  const base = plano?.label || `${plano?.codigo_erp || ''} - ${plano?.descricao || ''}`;
  return plano?.codiloja ? `${base} [Loja ${plano.codiloja}]` : base;
}

function formatContaPlanoLabel(conta) {
  if (!conta?.plano_codigo && !conta?.plano_descricao) return '—';
  return [conta.plano_codigo, conta.plano_descricao].filter(Boolean).join(' - ');
}

function buildContaFormState(conta = null) {
  return {
    fornecedor: conta?.fornecedor || '',
    descricao: conta?.descricao || '',
    valor: conta?.valor || '',
    data_vencimento: conta?.data_vencimento?.slice(0, 10) || '',
    forma_pagamento: conta?.forma_pagamento || '',
    categoria_id: conta?.categoria_id || '',
    natureza: conta?.natureza || 'despesa_geral',
    plano_conta_id: conta?.plano_conta_id || '',
    observacoes: conta?.observacoes || '',
    codiloja: conta?.codiloja || '',
    recorrente: false,
    recorrencia_quantidade: 12,
    recorrencia_dia_vencimento: '',
  };
}

function buildContaPayload(form, { allowRecorrencia = false } = {}) {
  const payload = {
    fornecedor: form.fornecedor,
    descricao: form.descricao || null,
    valor: form.valor,
    data_vencimento: form.data_vencimento,
    forma_pagamento: form.forma_pagamento || null,
    categoria_id: form.categoria_id || null,
    natureza: form.natureza || 'despesa_geral',
    plano_conta_id: form.plano_conta_id || null,
    observacoes: form.observacoes || null,
    codiloja: form.codiloja || null,
  };

  if (allowRecorrencia && form.recorrente) {
    const diaPadrao = form.data_vencimento
      ? new Date(`${form.data_vencimento}T12:00:00`).getDate()
      : 1;
    payload.recorrencia = {
      ativa: true,
      quantidade: form.recorrencia_quantidade || 12,
      dia_vencimento: form.recorrencia_dia_vencimento || diaPadrao,
    };
  }

  return payload;
}

function ContaDetailEditor({ form, setForm, onCancel, onSave }) {
  const [planoContas, setPlanoContas] = useState([]);
  const [loadingPlanoContas, setLoadingPlanoContas] = useState(false);

  useEffect(() => {
    let active = true;

    const loadPlanoContas = async () => {
      setLoadingPlanoContas(true);
      try {
        const res = await planoContasApi.list(buildPlanoContasParams(form.codiloja));
        if (active) setPlanoContas(res.data || []);
      } catch {
        if (active) setPlanoContas([]);
      } finally {
        if (active) setLoadingPlanoContas(false);
      }
    };

    loadPlanoContas();
    return () => { active = false; };
  }, [form.codiloja]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    await onSave(buildContaPayload(form));
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-brand-100 bg-brand-50/30 p-4 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between mb-4">
        <div>
          <h4 className="text-base font-semibold text-gray-900">Editar conta</h4>
          <p className="text-sm text-gray-500">Ajuste os dados da conta sem sair do detalhe.</p>
        </div>
        <button type="button" onClick={onCancel} className="btn-secondary self-start">
          Cancelar edicao
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-600 mb-1">Fornecedor *</label>
          <input
            type="text"
            value={form.fornecedor}
            onChange={(e) => setForm((prev) => ({ ...prev, fornecedor: e.target.value }))}
            className="input-field"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Valor *</label>
          <input
            type="number"
            step="0.01"
            value={form.valor}
            onChange={(e) => setForm((prev) => ({ ...prev, valor: e.target.value }))}
            className="input-field"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Vencimento *</label>
          <input
            type="date"
            value={form.data_vencimento}
            onChange={(e) => setForm((prev) => ({ ...prev, data_vencimento: e.target.value }))}
            className="input-field"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Loja</label>
          <LojaSelect
            value={form.codiloja}
            onChange={(e) => setForm((prev) => ({ ...prev, codiloja: e.target.value, plano_conta_id: '' }))}
            className="input-field"
            includeAll={false}
            emptyLabel="-"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Forma Pagamento</label>
          <select
            value={form.forma_pagamento}
            onChange={(e) => setForm((prev) => ({ ...prev, forma_pagamento: e.target.value }))}
            className="input-field"
          >
            <option value="">Selecione</option>
            <option value="boleto">Boleto</option>
            <option value="pix">PIX</option>
            <option value="transferencia">Transferencia</option>
            <option value="cheque">Cheque</option>
            <option value="cartao_credito">Cartao de Credito</option>
            <option value="cartao_debito">Cartao de Debito</option>
            <option value="dinheiro">Dinheiro</option>
            <option value="debito_auto">Debito Automatico</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Natureza</label>
          <select
            value={form.natureza}
            onChange={(e) => setForm((prev) => ({ ...prev, natureza: e.target.value }))}
            className="input-field"
          >
            <option value="despesa_geral">Despesa geral</option>
            <option value="mercadoria">Mercadoria</option>
            <option value="nao_classificada">Nao classificada</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-600 mb-1">Plano de contas</label>
          <select
            value={form.plano_conta_id}
            onChange={(e) => setForm((prev) => ({ ...prev, plano_conta_id: e.target.value }))}
            className="input-field"
          >
            <option value="">{loadingPlanoContas ? 'Carregando...' : 'Sem classificacao'}</option>
            {planoContas.map((plano) => (
              <option key={plano.id} value={plano.id}>
                {formatPlanoOptionLabel(plano)}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-600 mb-1">Descricao</label>
          <input
            type="text"
            value={form.descricao}
            onChange={(e) => setForm((prev) => ({ ...prev, descricao: e.target.value }))}
            className="input-field"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-600 mb-1">Observacoes</label>
          <textarea
            value={form.observacoes}
            onChange={(e) => setForm((prev) => ({ ...prev, observacoes: e.target.value }))}
            className="input-field"
            rows={3}
          />
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-5">
        <button type="submit" className="btn-primary">
          Salvar alteracoes
        </button>
      </div>
    </form>
  );
}

// ============================================
// Modal de criação/edição manual
// ============================================
function FormModal({ isOpen, onClose, onSave, editData = null }) {
  const [form, setForm] = useState(buildContaFormState());
  const [planoContas, setPlanoContas] = useState([]);
  const [loadingPlanoContas, setLoadingPlanoContas] = useState(false);
  const [syncingPlanoContas, setSyncingPlanoContas] = useState(false);

  useEffect(() => {
    if (editData) {
      setForm(buildContaFormState(editData));
    } else {
      setForm(buildContaFormState());
    }
  }, [editData, isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    let active = true;

    const loadPlanoContas = async () => {
      setLoadingPlanoContas(true);
      try {
        const res = await planoContasApi.list(buildPlanoContasParams(form.codiloja));
        if (active) setPlanoContas(res.data || []);
      } catch {
        if (active) setPlanoContas([]);
      } finally {
        if (active) setLoadingPlanoContas(false);
      }
    };

    loadPlanoContas();
    return () => { active = false; };
  }, [isOpen, form.codiloja]);

  const handleSyncPlanoContas = async () => {
    setSyncingPlanoContas(true);
    try {
      const payload = form.codiloja ? { codiloja: form.codiloja } : {};
      const syncRes = await planoContasApi.sync(payload);
      const listRes = await planoContasApi.list(buildPlanoContasParams(form.codiloja));
      setPlanoContas(listRes.data || []);
      toast.success(`Plano sincronizado: ${syncRes.data.inserted} novos, ${syncRes.data.updated} atualizados`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao sincronizar plano de contas');
    } finally {
      setSyncingPlanoContas(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(buildContaPayload(form, { allowRecorrencia: !editData }));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">{editData ? 'Editar Conta' : 'Nova Conta Manual'}</h2>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-gray-100 text-gray-400"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-600 mb-1">Fornecedor *</label>
              <input type="text" value={form.fornecedor} onChange={(e) => setForm(f => ({ ...f, fornecedor: e.target.value }))} className="input-field" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Valor *</label>
              <input type="number" step="0.01" value={form.valor} onChange={(e) => setForm(f => ({ ...f, valor: e.target.value }))} className="input-field" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Vencimento *</label>
              <input type="date" value={form.data_vencimento} onChange={(e) => setForm(f => ({ ...f, data_vencimento: e.target.value }))} className="input-field" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Loja</label>
              <LojaSelect
                value={form.codiloja}
                onChange={(e) => setForm(f => ({ ...f, codiloja: e.target.value, plano_conta_id: '' }))}
                className="input-field"
                includeAll={false}
                emptyLabel="—"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Forma Pagamento</label>
              <select value={form.forma_pagamento} onChange={(e) => setForm(f => ({ ...f, forma_pagamento: e.target.value }))} className="input-field">
                <option value="">Selecione</option>
                <option value="boleto">Boleto</option><option value="pix">PIX</option>
                <option value="transferencia">Transferência</option><option value="cheque">Cheque</option>
                <option value="cartao_credito">Cartão de Crédito</option><option value="cartao_debito">Cartão de Débito</option>
                <option value="dinheiro">Dinheiro</option><option value="debito_auto">Débito Automático</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Natureza</label>
              <select value={form.natureza} onChange={(e) => setForm(f => ({ ...f, natureza: e.target.value }))} className="input-field">
                <option value="despesa_geral">Despesa geral</option>
                <option value="mercadoria">Mercadoria</option>
                <option value="nao_classificada">Nao classificada</option>
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="block text-sm font-medium text-gray-600">Plano de contas</label>
                <button
                  type="button"
                  onClick={handleSyncPlanoContas}
                  disabled={syncingPlanoContas}
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
                >
                  <RefreshCw size={12} className={syncingPlanoContas ? 'animate-spin' : ''} />
                  Sincronizar
                </button>
              </div>
              <select value={form.plano_conta_id} onChange={(e) => setForm(f => ({ ...f, plano_conta_id: e.target.value }))} className="input-field">
                <option value="">{loadingPlanoContas ? 'Carregando...' : 'Sem classificacao'}</option>
                {planoContas.map((plano) => (
                  <option key={plano.id} value={plano.id}>
                    {formatPlanoOptionLabel(plano)}
                  </option>
                ))}
              </select>
            </div>
            {!editData && (
              <div className="sm:col-span-2 border-t border-gray-100 pt-4">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.recorrente}
                    onChange={(e) => setForm(f => ({ ...f, recorrente: e.target.checked }))}
                    className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                  />
                  Conta recorrente mensal
                </label>
                {form.recorrente && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1">Gerar meses</label>
                      <input
                        type="number"
                        min="1"
                        max="60"
                        value={form.recorrencia_quantidade}
                        onChange={(e) => setForm(f => ({ ...f, recorrencia_quantidade: e.target.value }))}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1">Dia vencimento</label>
                      <input
                        type="number"
                        min="1"
                        max="31"
                        value={form.recorrencia_dia_vencimento}
                        onChange={(e) => setForm(f => ({ ...f, recorrencia_dia_vencimento: e.target.value }))}
                        className="input-field"
                        placeholder={form.data_vencimento ? String(new Date(`${form.data_vencimento}T12:00:00`).getDate()) : '1'}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-600 mb-1">Descrição</label>
              <input type="text" value={form.descricao} onChange={(e) => setForm(f => ({ ...f, descricao: e.target.value }))} className="input-field" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-600 mb-1">Observações</label>
              <textarea value={form.observacoes} onChange={(e) => setForm(f => ({ ...f, observacoes: e.target.value }))} className="input-field" rows={2} />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" className="btn-primary">{editData ? 'Salvar' : 'Criar Conta'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================
// Modal de baixa — suporta pagamento parcial, desconto, juros,
// comprovante, contas bancárias cadastradas, preview de juros
// e EDIÇÃO de baixas já registradas.
// ============================================
function BaixaModal({ isOpen, onClose, onConfirm, conta, editBaixa = null, contasBancarias = [] }) {
  const isEdit = !!editBaixa;

  const [form, setForm] = useState({
    data_pagamento: new Date().toISOString().slice(0, 10),
    forma_pagamento: '',
    valor_pago: '',
    valor_desconto: '',
    valor_juros: '',
    valor_multa: '',
    banco_baixa: '',
    conta_bancaria_id: '',
    observacoes: '',
  });
  const [arquivo, setArquivo] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef(null);

  const valorConta = parseFloat(conta?.valor) || 0;
  // Ao editar, tira esta baixa da soma "já pago" para não double-count
  const valorJaPago = Math.max(0,
    (parseFloat(conta?.valor_pago) || 0) - (isEdit ? (parseFloat(editBaixa.valor_pago) || 0) : 0)
  );
  const descontoJa = Math.max(0,
    (parseFloat(conta?.valor_desconto) || 0) - (isEdit ? (parseFloat(editBaixa.valor_desconto) || 0) : 0)
  );
  const saldoAtual = Math.max(0, valorConta - valorJaPago - descontoJa);

  // Reset quando abrir modal com conta diferente ou entrar em modo edit
  useEffect(() => {
    if (!isOpen || !conta) return;
    if (isEdit) {
      setForm({
        data_pagamento: (editBaixa.data_pagamento || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
        forma_pagamento: editBaixa.forma_pagamento || '',
        valor_pago: (parseFloat(editBaixa.valor_pago) || 0).toFixed(2),
        valor_desconto: (parseFloat(editBaixa.valor_desconto) || 0).toFixed(2),
        valor_juros: (parseFloat(editBaixa.valor_juros) || 0).toFixed(2),
        valor_multa: (parseFloat(editBaixa.valor_multa) || 0).toFixed(2),
        banco_baixa: editBaixa.banco_baixa || '',
        conta_bancaria_id: editBaixa.conta_bancaria_id || '',
        observacoes: editBaixa.observacoes || '',
      });
    } else {
      setForm({
        data_pagamento: new Date().toISOString().slice(0, 10),
        forma_pagamento: conta.forma_pagamento || '',
        valor_pago: saldoAtual.toFixed(2),
        valor_desconto: '',
        valor_juros: '',
        valor_multa: '',
        banco_baixa: conta.banco_baixa || '',
        conta_bancaria_id: '',
        observacoes: '',
      });
    }
    setArquivo(null);
  }, [isOpen, conta?.id, editBaixa?.id]); // eslint-disable-line

  if (!isOpen || !conta) return null;

  const valorPago = parseFloat(form.valor_pago) || 0;
  const desconto = parseFloat(form.valor_desconto) || 0;
  const juros = parseFloat(form.valor_juros) || 0;
  const multa = parseFloat(form.valor_multa) || 0;
  const saldoAposPagamento = Math.max(0, saldoAtual - valorPago - desconto);
  const isParcial = saldoAposPagamento > 0.01;
  const totalSaindoDaConta = valorPago + juros + multa;

  const hoje = new Date().toISOString().slice(0, 10);
  const vencimento = conta.data_vencimento?.slice(0, 10);
  const pagamentoAtrasado = vencimento && form.data_pagamento > vencimento;
  const diasAtraso = pagamentoAtrasado
    ? Math.round((new Date(form.data_pagamento) - new Date(vencimento)) / 86400000)
    : 0;

  const handleFile = (file) => {
    if (!file) return;
    const ok = /\.(jpeg|jpg|png|gif|webp|pdf)$/i.test(file.name);
    if (!ok) { toast.error('Use JPEG, PNG, GIF, WEBP ou PDF'); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error('Arquivo maior que 10MB'); return; }
    setArquivo(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  const handlePreviewJuros = async () => {
    try {
      const res = await contasPagarApi.previewJuros(conta.id, form.data_pagamento);
      if (res.data?.regra) {
        setForm(f => ({
          ...f,
          valor_multa: (parseFloat(res.data.valor_multa) || 0).toFixed(2),
          valor_juros: (parseFloat(res.data.valor_juros) || 0).toFixed(2),
        }));
        toast.success(`Juros/multa calculado (${res.data.dias_atraso} dias de atraso)`);
      } else {
        toast('Sem regra ou sem atraso', { icon: '📋' });
      }
    } catch {
      toast.error('Erro ao calcular juros');
    }
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (valorPago <= 0 && desconto <= 0) {
      toast.error('Informe o valor pago ou desconto');
      return;
    }
    if (!form.forma_pagamento) {
      toast.error('Selecione a forma de pagamento');
      return;
    }
    if (!isEdit && valorPago > saldoAtual + juros + 0.01) {
      if (!confirm(`Valor pago (${formatCurrency(valorPago)}) é maior que o saldo (${formatCurrency(saldoAtual)}). Continuar?`)) return;
    }
    setSubmitting(true);
    try {
      await onConfirm({
        conta_id: conta.id,
        baixa_id: isEdit ? editBaixa.id : null,
        data: {
          data_pagamento: form.data_pagamento,
          forma_pagamento: form.forma_pagamento,
          valor_pago: valorPago,
          valor_desconto: desconto,
          valor_juros: juros,
          valor_multa: multa,
          banco_baixa: form.banco_baixa || null,
          conta_bancaria_id: form.conta_bancaria_id || null,
          observacoes: form.observacoes || null,
        },
        arquivo,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleSubmit(e);
  };

  const preencherTotal = () => setForm(f => ({ ...f, valor_pago: saldoAtual.toFixed(2) }));
  const preencherMetade = () => setForm(f => ({ ...f, valor_pago: (saldoAtual / 2).toFixed(2) }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onKeyDown={handleKeyDown}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                {isEdit ? 'Editar Baixa' : 'Dar Baixa'}
                {!isEdit && valorJaPago > 0 && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                    Pagamento adicional
                  </span>
                )}
                {isEdit && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                    Baixa #{editBaixa.id}
                  </span>
                )}
              </h2>
              <p className="text-sm text-gray-500 mt-0.5 truncate">{conta.fornecedor}</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={18} /></button>
          </div>

          {/* Mini resumo */}
          <div className="grid grid-cols-4 gap-3 mt-4">
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-[10px] uppercase text-gray-400 font-semibold">Valor Total</p>
              <p className="text-sm font-bold text-gray-900 mt-0.5">{formatCurrency(valorConta)}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-[10px] uppercase text-gray-400 font-semibold">
                {isEdit ? 'Pago (outras)' : 'Já Pago'}
              </p>
              <p className="text-sm font-bold text-emerald-600 mt-0.5">{formatCurrency(valorJaPago)}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-[10px] uppercase text-gray-400 font-semibold">Saldo Aberto</p>
              <p className="text-sm font-bold text-amber-600 mt-0.5">{formatCurrency(saldoAtual)}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-[10px] uppercase text-gray-400 font-semibold">Vencimento</p>
              <p className="text-sm font-bold text-gray-900 mt-0.5">{formatDate(conta.data_vencimento)}</p>
              {pagamentoAtrasado && (
                <p className="text-[10px] text-red-500 font-medium mt-0.5">{diasAtraso} dias atraso</p>
              )}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Seção: Valores */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-500 uppercase">Valores</h3>
              <div className="flex gap-2">
                <button type="button" onClick={preencherTotal} className="text-xs text-brand-600 hover:text-brand-700 font-medium">Pagar total</button>
                <span className="text-gray-200">•</span>
                <button type="button" onClick={preencherMetade} className="text-xs text-brand-600 hover:text-brand-700 font-medium">50%</button>
                {pagamentoAtrasado && (
                  <>
                    <span className="text-gray-200">•</span>
                    <button type="button" onClick={handlePreviewJuros} className="text-xs text-red-600 hover:text-red-700 font-medium">
                      Calcular juros/multa
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Valor Pago *</label>
                <input
                  type="number" step="0.01" min="0"
                  value={form.valor_pago}
                  onChange={(e) => setForm(f => ({ ...f, valor_pago: e.target.value }))}
                  className="input-field font-semibold text-right"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Desconto</label>
                <input
                  type="number" step="0.01" min="0"
                  value={form.valor_desconto}
                  onChange={(e) => setForm(f => ({ ...f, valor_desconto: e.target.value }))}
                  className="input-field text-right"
                  placeholder="0,00"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Juros</label>
                <input
                  type="number" step="0.01" min="0"
                  value={form.valor_juros}
                  onChange={(e) => setForm(f => ({ ...f, valor_juros: e.target.value }))}
                  className="input-field text-right"
                  placeholder="0,00"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Multa</label>
                <input
                  type="number" step="0.01" min="0"
                  value={form.valor_multa}
                  onChange={(e) => setForm(f => ({ ...f, valor_multa: e.target.value }))}
                  className="input-field text-right"
                  placeholder="0,00"
                />
              </div>
            </div>

            {/* Resumo calculado */}
            <div className={`mt-3 rounded-xl p-3 text-sm flex items-center justify-between ${isParcial ? 'bg-amber-50 border border-amber-100' : 'bg-emerald-50 border border-emerald-100'}`}>
              <div>
                <p className="text-xs text-gray-500">Total saindo da conta</p>
                <p className="font-bold text-gray-900">{formatCurrency(totalSaindoDaConta)}</p>
              </div>
              <div className="text-right">
                {isParcial ? (
                  <>
                    <p className="text-xs text-amber-700 font-semibold">Pagamento parcial</p>
                    <p className="text-amber-700">Saldo restante: <strong>{formatCurrency(saldoAposPagamento)}</strong></p>
                  </>
                ) : (
                  <p className="text-emerald-700 font-semibold flex items-center gap-1 justify-end">
                    <Check size={14} /> Conta será quitada
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Seção: Pagamento */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Pagamento</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Data *</label>
                <input type="date" value={form.data_pagamento}
                  onChange={(e) => setForm(f => ({ ...f, data_pagamento: e.target.value }))}
                  className="input-field" max={hoje} required />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Forma *</label>
                <select value={form.forma_pagamento}
                  onChange={(e) => setForm(f => ({ ...f, forma_pagamento: e.target.value }))}
                  className="input-field" required>
                  <option value="">Selecione</option>
                  <option value="pix">PIX</option>
                  <option value="boleto">Boleto</option>
                  <option value="transferencia">Transferência</option>
                  <option value="debito_auto">Débito Automático</option>
                  <option value="cheque">Cheque</option>
                  <option value="cartao_credito">Cartão de Crédito</option>
                  <option value="cartao_debito">Cartão de Débito</option>
                  <option value="dinheiro">Dinheiro</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Conta Bancária</label>
                {contasBancarias.length > 0 ? (
                  <select
                    value={form.conta_bancaria_id}
                    onChange={(e) => setForm(f => ({ ...f, conta_bancaria_id: e.target.value }))}
                    className="input-field"
                  >
                    <option value="">— sem vínculo —</option>
                    {contasBancarias.map((cb) => (
                      <option key={cb.id} value={cb.id}>
                        {cb.nome}{cb.agencia || cb.conta ? ` — ${cb.agencia}/${cb.conta}` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input type="text" value={form.banco_baixa}
                    onChange={(e) => setForm(f => ({ ...f, banco_baixa: e.target.value }))}
                    className="input-field" placeholder="Ex: Itaú CC 12345-6 (cadastre em /contas-bancarias)" />
                )}
              </div>
            </div>
          </div>

          {/* Seção: Comprovante */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">
              Comprovante {isEdit && editBaixa.comprovante_path && <span className="text-[10px] text-emerald-600 ml-1">(já existe — envie outro para substituir)</span>}
            </h3>
            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.gif,.webp,.pdf"
              onChange={(e) => handleFile(e.target.files?.[0])}
              className="hidden"
            />
            {arquivo ? (
              <div className="flex items-center gap-3 p-3 rounded-xl border-2 border-emerald-200 bg-emerald-50">
                <Paperclip size={18} className="text-emerald-600" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{arquivo.name}</p>
                  <p className="text-xs text-gray-500">{(arquivo.size / 1024).toFixed(0)} KB</p>
                </div>
                <button type="button" onClick={() => setArquivo(null)} className="text-xs text-red-500 hover:text-red-700 font-medium">
                  Remover
                </button>
              </div>
            ) : (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-1 py-5 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
                  dragOver ? 'border-brand-400 bg-brand-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <Upload size={18} className="text-gray-400" />
                <p className="text-xs text-gray-500">
                  <span className="text-brand-600 font-medium">Escolher arquivo</span> ou arrastar aqui
                </p>
                <p className="text-[10px] text-gray-400">JPG, PNG, PDF (até 10MB)</p>
              </div>
            )}
          </div>

          {/* Observações */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Observações</label>
            <textarea value={form.observacoes}
              onChange={(e) => setForm(f => ({ ...f, observacoes: e.target.value }))}
              className="input-field" rows={2}
              placeholder="Ex: pago com antecedência / negociação com fornecedor" />
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 p-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <p className="text-[11px] text-gray-400 hidden md:block">Dica: Ctrl+Enter para confirmar</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="button" onClick={handleSubmit} disabled={submitting} className="btn-primary disabled:opacity-50">
              {submitting ? <RefreshCw size={16} className="animate-spin" /> : <Check size={16} />}
              {isEdit ? 'Salvar Alterações' : (isParcial ? 'Registrar Pagamento Parcial' : 'Confirmar Baixa')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Modal PAGAR COM CHEQUES (o principal!)
// Fluxo: contas selecionadas → criar vários cheques pré-datados
// ============================================
function PagarComChequesModal({ isOpen, onClose, onConfirm, contasSelecionadas = [] }) {
  const totalContas = contasSelecionadas.reduce((sum, c) => sum + getSaldoContaAberto(c), 0);
  const fornecedor = contasSelecionadas[0]?.fornecedor || '';
  const codiloja = contasSelecionadas[0]?.codiloja || '';
  const erpFornId = contasSelecionadas[0]?.erp_fornecedor_id || '';

  const [cheques, setCheques] = useState([{
    numero_cheque: '', banco: '', agencia: '', conta: '',
    valor: '', data_emissao: new Date().toISOString().slice(0, 10),
    data_bom_para: '',
  }]);
  const [darBaixa, setDarBaixa] = useState(true);
  const [obs, setObs] = useState('');

  // Reset ao abrir
  useEffect(() => {
    if (isOpen) {
      setCheques([{
        numero_cheque: '', banco: '', agencia: '', conta: '',
        valor: '', data_emissao: new Date().toISOString().slice(0, 10),
        data_bom_para: '',
      }]);
      setDarBaixa(true);
      setObs('');
    }
  }, [isOpen]);

  const totalCheques = cheques.reduce((sum, ch) => sum + (parseFloat(ch.valor) || 0), 0);
  const diferenca = totalContas - totalCheques;

  const addCheque = () => {
    const last = cheques[cheques.length - 1];
    setCheques(prev => [...prev, {
      numero_cheque: last.numero_cheque ? String(parseInt(last.numero_cheque) + 1).padStart(last.numero_cheque.length, '0') : '',
      banco: last.banco, agencia: last.agencia, conta: last.conta,
      valor: '', data_emissao: last.data_emissao,
      data_bom_para: '',
    }]);
  };

  const removeCheque = (idx) => {
    if (cheques.length <= 1) return;
    setCheques(prev => prev.filter((_, i) => i !== idx));
  };

  const updateCheque = (idx, field, value) => {
    setCheques(prev => prev.map((ch, i) => i === idx ? { ...ch, [field]: value } : ch));
  };

  // Distribuir valor igualmente
  const distribuirIgual = () => {
    const valorCada = (totalContas / cheques.length).toFixed(2);
    setCheques(prev => prev.map((ch, i) => ({
      ...ch,
      valor: i === prev.length - 1
        ? (totalContas - valorCada * (prev.length - 1)).toFixed(2) // último pega o resto
        : valorCada,
    })));
  };

  const handleSubmit = () => {
    // Validar
    for (let i = 0; i < cheques.length; i++) {
      if (!cheques[i].numero_cheque || !cheques[i].valor || !cheques[i].data_bom_para) {
        toast.error(`Cheque ${i + 1}: preencha número, valor e data bom-para`);
        return;
      }
    }
    onConfirm({
      contas_ids: contasSelecionadas.map(c => c.id),
      cheques,
      fornecedor,
      erp_fornecedor_id: erpFornId,
      codiloja,
      dar_baixa: darBaixa,
      observacoes: obs,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Pagar com Cheques</h2>
              <p className="text-sm text-gray-500 mt-0.5">{fornecedor} — {contasSelecionadas.length} contas selecionadas</p>
            </div>
            <button onClick={onClose} className="p-1 rounded-md hover:bg-gray-100 text-gray-400"><X size={20} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Resumo das contas */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Contas a pagar ({contasSelecionadas.length})</h3>
            <div className="border border-gray-100 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
              <table className="w-full">
                <tbody>
                  {contasSelecionadas.map((c) => (
                    <tr key={c.id} className="border-b border-gray-50 last:border-0">
                      <td className="px-3 py-2 text-xs font-mono text-gray-500">{c.documento || c.erp_lancamento || '—'}</td>
                      <td className="px-3 py-2 text-xs text-gray-600 truncate max-w-[200px]">{c.historico || c.descricao || '—'}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{formatDate(c.data_vencimento)}</td>
                      <td className="px-3 py-2 text-xs text-right font-semibold text-gray-900">{formatCurrency(getSaldoContaAberto(c))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end mt-1">
              <span className="text-sm font-bold text-gray-900">Total: {formatCurrency(totalContas)}</span>
            </div>
          </div>

          {/* Cheques */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-500 uppercase">Cheques pré-datados ({cheques.length})</h3>
              <div className="flex gap-2">
                <button type="button" onClick={distribuirIgual} className="text-xs text-brand-600 hover:text-brand-700 font-medium">
                  Distribuir igual
                </button>
                <button type="button" onClick={addCheque} className="text-xs text-brand-600 hover:text-brand-700 font-medium">
                  + Adicionar cheque
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {cheques.map((ch, idx) => (
                <div key={idx} className="border border-gray-200 rounded-xl p-4 bg-gray-50/50">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-gray-700">Cheque {idx + 1}</span>
                    {cheques.length > 1 && (
                      <button onClick={() => removeCheque(idx)} className="text-xs text-red-400 hover:text-red-600">Remover</button>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Nº Cheque *</label>
                      <input type="text" value={ch.numero_cheque} onChange={(e) => updateCheque(idx, 'numero_cheque', e.target.value)}
                        className="input-field text-sm font-mono" placeholder="000001" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Valor *</label>
                      <input type="number" step="0.01" value={ch.valor} onChange={(e) => updateCheque(idx, 'valor', e.target.value)}
                        className="input-field text-sm" placeholder="0,00" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Emissão</label>
                      <input type="date" value={ch.data_emissao} onChange={(e) => updateCheque(idx, 'data_emissao', e.target.value)}
                        className="input-field text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Bom Para *</label>
                      <input type="date" value={ch.data_bom_para} onChange={(e) => updateCheque(idx, 'data_bom_para', e.target.value)}
                        className="input-field text-sm" />
                    </div>
                    {idx === 0 && (
                      <>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Banco</label>
                          <input type="text" value={ch.banco} onChange={(e) => updateCheque(idx, 'banco', e.target.value)}
                            className="input-field text-sm" placeholder="Itaú" />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Agência</label>
                          <input type="text" value={ch.agencia} onChange={(e) => updateCheque(idx, 'agencia', e.target.value)}
                            className="input-field text-sm font-mono" />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Conta</label>
                          <input type="text" value={ch.conta} onChange={(e) => updateCheque(idx, 'conta', e.target.value)}
                            className="input-field text-sm font-mono" />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Totalizador */}
            <div className={`flex items-center justify-between mt-3 p-3 rounded-lg ${Math.abs(diferenca) < 0.01 ? 'bg-emerald-50' : 'bg-amber-50'}`}>
              <span className="text-sm text-gray-600">Total cheques: <strong>{formatCurrency(totalCheques)}</strong></span>
              {Math.abs(diferenca) < 0.01 ? (
                <span className="text-sm text-emerald-600 font-medium flex items-center gap-1"><Check size={14} /> Valores conferem</span>
              ) : (
                <span className="text-sm text-amber-600 font-medium">
                  Diferença: {formatCurrency(Math.abs(diferenca))} {diferenca > 0 ? '(falta)' : '(sobra)'}
                </span>
              )}
            </div>
          </div>

          {/* Opções */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" checked={darBaixa} onChange={(e) => setDarBaixa(e.target.checked)}
                className="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
              Dar baixa nas contas selecionadas
            </label>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Observações gerais</label>
              <input type="text" value={obs} onChange={(e) => setObs(e.target.value)}
                className="input-field text-sm" placeholder="Ex: Pagamento ref. jan/fev 2026" />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={handleSubmit} className="btn-primary">
            <BookOpen size={16} /> Emitir {cheques.length} Cheque{cheques.length > 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Página principal
// ============================================
export default function ContasPagarPage() {
  const [data, setData] = useState([]);
  const [resumo, setResumo] = useState(null);
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showBaixa, setShowBaixa] = useState(null);      // conta para nova baixa
  const [editBaixa, setEditBaixa] = useState(null);      // baixa em edição
  const [showBaixaLote, setShowBaixaLote] = useState(false);
  const [editDocumentoBaixa, setEditDocumentoBaixa] = useState(null);
  const [showCheques, setShowCheques] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null); // detalhe
  const [isEditingSelected, setIsEditingSelected] = useState(false);
  const [selectedForm, setSelectedForm] = useState(buildContaFormState());
  const [checked, setChecked] = useState([]); // multi-select IDs
  const [contasBancarias, setContasBancarias] = useState([]);

  const [filters, setFilters] = useState({
    status: '', origem: '', codiloja: '', fornecedor: '',
    ...getDefaultDateRange(), page: 1, perPage: 30,
  });

  const [inbox, setInbox] = useState([]);
  const [inboxOpen, setInboxOpen] = useState(true);
  const [inboxVinculando, setInboxVinculando] = useState(null); // id do item sendo vinculado
  const [inboxContaId, setInboxContaId] = useState({});

  const loadSelectedDetail = async (id, { reset = false } = {}) => {
    if (!id) {
      setSelected(null);
      return;
    }

    if (reset) setSelected(null);

    setLoadingDetail(true);
    try {
      const res = await contasPagarApi.rastreio(id);
      setSelected(res.data);
    } catch (err) {
      if (err.response?.status === 404) {
        setSelectedId(null);
        setSelected(null);
        return;
      }

      toast.error('Erro ao carregar detalhe da conta');
    } finally {
      setLoadingDetail(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = { ...filters };
      Object.keys(params).forEach(k => { if (params[k] === '') delete params[k]; });

      const [listRes, resumoRes, statusRes] = await Promise.all([
        contasPagarApi.list(params),
        contasPagarApi.resumo({ codiloja: filters.codiloja || undefined, dataInicio: filters.dataInicio, dataFim: filters.dataFim }),
        syncApi.status(),
      ]);

      setData(listRes.data.data);
      setPagination(listRes.data.pagination);
      setResumo(resumoRes.data);
      setSyncStatus(statusRes.data);
      if (selectedId) {
        await loadSelectedDetail(selectedId);
      }
    } catch (err) {
      console.error('Erro:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchInbox = async () => {
    try {
      const res = await inboxApi.list();
      setInbox(res.data.data.filter(i => !i.vinculado));
    } catch { /* silencioso */ }
  };

  const handleVincularInbox = async (inboxId) => {
    const contaId = inboxContaId[inboxId];
    if (!contaId) return toast.error('Selecione uma conta primeiro');
    setInboxVinculando(inboxId);
    try {
      const res = await inboxApi.vincular(inboxId, contaId);
      toast.success(res.data.mensagem);
      fetchInbox();
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao vincular');
    } finally {
      setInboxVinculando(null);
    }
  };

  const handleDeleteInbox = async (inboxId) => {
    if (!confirm('Remover este comprovante da caixa de entrada?')) return;
    try {
      await inboxApi.delete(inboxId);
      fetchInbox();
    } catch { toast.error('Erro ao remover'); }
  };

  const fetchContasBancarias = async () => {
    try {
      const res = await contasBancariasApi.list({ ativo: true });
      setContasBancarias(res.data.data || []);
    } catch { /* silencioso */ }
  };

  useEffect(() => { fetchData(); }, [filters]);
  useEffect(() => { fetchInbox(); fetchContasBancarias(); }, []);
  useEffect(() => { setChecked([]); }, [data]); // limpa seleção ao trocar dados

  useEffect(() => {
    const fetchDetail = async () => {
      if (!selectedId) {
        setSelected(null);
        setIsEditingSelected(false);
        setSelectedForm(buildContaFormState());
        return;
      }

      await loadSelectedDetail(selectedId, { reset: true });
    };

    fetchDetail();
  }, [selectedId]);

  useEffect(() => {
    if (!selected) {
      setIsEditingSelected(false);
      setSelectedForm(buildContaFormState());
      return;
    }
    setIsEditingSelected(false);
    setSelectedForm(buildContaFormState(selected));
  }, [selected]);

  // Multi-select helpers
  const checkedContas = data.filter(c => checked.includes(c.id));
  const checkedTotal = checkedContas.reduce((sum, c) => sum + getSaldoContaAberto(c), 0);
  const canPay = checkedContas.length > 0 && checkedContas.every((c) => {
    const isPayable = c.status === 'pendente' || c.status === 'vencido';
    return isPayable && getSaldoContaAberto(c) > 0.01;
  });

  const toggleCheck = (id) => {
    setChecked(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleAll = () => {
    const payable = data.filter(
      (c) => (c.status === 'pendente' || c.status === 'vencido') && getSaldoContaAberto(c) > 0.01
    );
    if (checked.length === payable.length) setChecked([]);
    else setChecked(payable.map(c => c.id));
  };

  // Actions
  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncApi.syncPagame({
        dataInicio: filters.dataInicio || undefined,
        dataFim: filters.dataFim || undefined,
        codiloja: filters.codiloja || undefined,
      });
      toast.success(`Sync: ${result.data.inserted} novos, ${result.data.updated} atualizados`, { duration: 5000 });
      fetchData();
    } catch (err) {
      toast.error('Erro na sincronização');
    } finally {
      setSyncing(false);
    }
  };

  const handleSave = async (formData) => {
    try {
      if (editItem) {
        await contasPagarApi.update(editItem.id, formData);
        toast.success('Conta atualizada!');
      } else {
        const res = await contasPagarApi.create(formData);
        const geradas = parseInt(res.data?.contas_geradas, 10) || 1;
        toast.success(geradas > 1 ? `${geradas} contas geradas!` : 'Conta criada!');
      }
      setShowForm(false); setEditItem(null); fetchData();
    } catch (err) { toast.error(err.response?.data?.error || 'Erro ao salvar'); }
  };

  const handleSaveSelectedConta = async (formData) => {
    if (!selected?.id) return false;
    try {
      await contasPagarApi.update(selected.id, formData);
      toast.success('Conta atualizada!');
      await fetchData();
      return true;
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao salvar');
      return false;
    }
  };

  const handleBaixa = async ({ conta_id, baixa_id, data, arquivo }) => {
    try {
      let res;
      if (baixa_id) {
        res = await contasPagarApi.updateBaixa(conta_id, baixa_id, data, arquivo);
        toast.success('Baixa atualizada');
      } else {
        res = await contasPagarApi.createBaixa(conta_id, data, arquivo);
        const quitado = res.data?.status === 'pago';
        toast.success(quitado ? 'Conta quitada!' : 'Pagamento parcial registrado');
      }
      setShowBaixa(null);
      setEditBaixa(null);
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao dar baixa');
    }
  };

  const handleBaixaLote = async (payload) => {
    try {
      if (payload.documento_id) {
        await contasPagarApi.updateBaixaDocumento(payload.documento_id, payload);
        toast.success('Documento de baixa atualizado');
      } else {
        await contasPagarApi.baixaLote(payload);
        toast.success('Documento de baixa gerado');
      }

      setShowBaixaLote(false);
      setEditDocumentoBaixa(null);
      setChecked([]);
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao processar documento de baixa');
    }
  };

  const handleEditarDocumentoBaixa = async (documentoId) => {
    try {
      const res = await contasPagarApi.getBaixaDocumento(documentoId);
      setEditDocumentoBaixa(res.data);
      setShowBaixaLote(true);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao carregar documento de baixa');
    }
  };

  const handleEstornarDocumentoBaixa = async (documentoId) => {
    const motivo = prompt('Motivo do estorno do documento (opcional):');
    if (motivo === null) return;
    try {
      await contasPagarApi.deleteBaixaDocumento(documentoId, motivo || '');
      toast.success('Documento de baixa estornado');
      setEditDocumentoBaixa(null);
      setShowBaixaLote(false);
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao estornar documento');
    }
  };

  const handleEstornarBaixa = async (contaId, baixaId) => {
    const baixa = selected?.baixas?.find((item) => item.id === baixaId);
    if (baixa?.documento_baixa_id) {
      handleEstornarDocumentoBaixa(baixa.documento_baixa_id);
      return;
    }

    const motivo = prompt('Motivo do estorno (opcional):');
    if (motivo === null) return;
    try {
      await contasPagarApi.deleteBaixa(contaId, baixaId, motivo || '');
      toast.success('Baixa estornada');
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao estornar');
    }
  };

  const handleEditarBaixa = (conta, baixa) => {
    if (baixa.documento_baixa_id) {
      handleEditarDocumentoBaixa(baixa.documento_baixa_id);
      return;
    }
    setEditBaixa(baixa);
    setShowBaixa(conta);
  };

  const handlePagarComCheques = async (payload) => {
    try {
      const res = await chequesApi.createLote(payload);
      toast.success(res.data.message, { duration: 5000 });
      setShowCheques(false);
      setChecked([]);
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao criar cheques');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Confirma o cancelamento desta conta?')) return;
    try {
      await contasPagarApi.delete(id);
      toast.success('Conta cancelada');
      if (selectedId === id) {
        setSelectedId(null);
        setSelected(null);
      }
      fetchData();
    }
    catch (err) { toast.error('Erro ao cancelar'); }
  };

  const updateFilter = (key, value) => setFilters(prev => ({ ...prev, [key]: value, page: 1 }));

  const handleSelectRow = (id) => {
    setSelectedId(prev => (prev === id ? null : id));
  };

  const closeDetailModal = () => {
    setSelectedId(null);
    setSelected(null);
    setIsEditingSelected(false);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Contas a Pagar</h1>
          <p className="text-sm text-gray-500 mt-1">
            Visão consolidada — ERP + manual
            {syncStatus?.lastSync && <span className="ml-2 text-xs text-gray-400">(sync: {formatDate(syncStatus.lastSync, 'DD/MM HH:mm')})</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchData} className="btn-secondary" disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={handleSync} disabled={syncing}
            className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 transition-all disabled:opacity-50">
            <Download size={16} className={syncing ? 'animate-bounce' : ''} />
            {syncing ? 'Sincronizando...' : 'Sincronizar ERP'}
          </button>
          <button onClick={() => { setEditItem(null); setShowForm(true); }} className="btn-primary">
            <Plus size={16} /> Nova Manual
          </button>
        </div>
      </div>

      {/* Resumo Cards */}
      {resumo && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
          <div className="card p-4">
            <p className="text-xs text-gray-500 font-medium uppercase">Vencido</p>
            <p className="text-xl font-bold text-red-600 mt-1">{formatCurrency(resumo.vencido.total)}</p>
            <p className="text-xs text-gray-400">{resumo.vencido.qtd} títulos</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500 font-medium uppercase">Pendente</p>
            <p className="text-xl font-bold text-amber-600 mt-1">{formatCurrency(resumo.pendente.total)}</p>
            <p className="text-xs text-gray-400">{resumo.pendente.qtd} títulos</p>
          </div>
          <div className="card p-4 border-l-4 border-amber-400">
            <p className="text-xs text-amber-700 font-bold uppercase flex items-center gap-1">
              <Clock size={12} /> Pgto. Parcial
            </p>
            <p className="text-xl font-bold text-amber-700 mt-1">{formatCurrency(resumo.parcial?.total || 0)}</p>
            <p className="text-xs text-amber-600">{resumo.parcial?.qtd || 0} títulos em aberto</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500 font-medium uppercase">Pago</p>
            <p className="text-xl font-bold text-emerald-600 mt-1">{formatCurrency(resumo.pago.total)}</p>
            <p className="text-xs text-gray-400">{resumo.pago.qtd} títulos</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500 font-medium uppercase">Registros</p>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xs"><Database size={12} className="inline text-amber-500" /> ERP: {syncStatus?.counts?.erp || 0}</span>
              <span className="text-xs"><FileText size={12} className="inline text-brand-500" /> Manual: {syncStatus?.counts?.manual || 0}</span>
            </div>
          </div>
        </div>
      )}

      {resumo?.porConciliacao && (
        <div className="flex flex-wrap gap-2 mb-4">
          {['sem_itens', 'parcial', 'conciliado', 'divergente'].map((status) => {
            const meta = getConciliacaoMeta(status);
            return (
              <span
                key={status}
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${meta.badge}`}
              >
                {meta.label}
                <span className="font-semibold">{resumo.porConciliacao[status] || 0}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* Inbox de Comprovantes */}
      {inbox.length > 0 && (
        <div className="card mb-4 border-l-4 border-amber-400">
          <button
            className="w-full flex items-center justify-between px-4 py-3 text-left"
            onClick={() => setInboxOpen(o => !o)}
          >
            <div className="flex items-center gap-2">
              <Inbox size={16} className="text-amber-500" />
              <span className="text-sm font-semibold text-gray-800">
                Caixa de Entrada — {inbox.length} comprovante{inbox.length > 1 ? 's' : ''} aguardando vinculação
              </span>
            </div>
            <ChevronLeft size={16} className={`text-gray-400 transition-transform ${inboxOpen ? '-rotate-90' : 'rotate-90'}`} />
          </button>

          {inboxOpen && (
            <div className="px-4 pb-4 space-y-3">
              {inbox.map(item => (
                <div key={item.id} className="flex flex-wrap items-center gap-3 p-3 bg-amber-50 rounded-lg border border-amber-100">
                  <FileText size={20} className="text-amber-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-500">
                      Recebido em {new Date(item.criado_em).toLocaleString('pt-BR')}
                    </p>
                    <a
                      href={`/uploads/${item.arquivo_path.split('/uploads/')[1]}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-brand-600 hover:underline truncate block"
                    >
                      Ver arquivo
                    </a>
                  </div>
                  <select
                    className="input-field text-sm w-72"
                    value={inboxContaId[item.id] || ''}
                    onChange={e => setInboxContaId(prev => ({ ...prev, [item.id]: e.target.value }))}
                  >
                    <option value="">Selecione a conta...</option>
                    {data
                      .filter(c => ['pendente', 'vencido'].includes(c.status))
                      .map(c => (
                        <option key={c.id} value={c.id}>
                          {c.fornecedor} — {formatCurrency(c.valor)} — {formatDate(c.data_vencimento)}
                        </option>
                      ))}
                  </select>
                  <button
                    onClick={() => handleVincularInbox(item.id)}
                    disabled={inboxVinculando === item.id || !inboxContaId[item.id]}
                    className="btn-primary text-xs py-1.5 px-3 disabled:opacity-50"
                  >
                    <Link2 size={13} />
                    {inboxVinculando === item.id ? 'Vinculando...' : 'Vincular'}
                  </button>
                  <button
                    onClick={() => handleDeleteInbox(item.id)}
                    className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50"
                    title="Remover"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="card p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <LojaSelect value={filters.codiloja} onChange={(e) => updateFilter('codiloja', e.target.value)} className="input-field w-36" />
          <select value={filters.status} onChange={(e) => updateFilter('status', e.target.value)} className="input-field w-36">
            <option value="">Todos status</option><option value="pendente">Pendente</option>
            <option value="vencido">Vencido</option><option value="pago">Pago</option><option value="cancelado">Cancelado</option>
          </select>
          <select value={filters.origem} onChange={(e) => updateFilter('origem', e.target.value)} className="input-field w-36">
            <option value="">Todas origens</option><option value="erp">ERP</option><option value="manual">Manual</option>
          </select>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Fornecedor..." value={filters.fornecedor} onChange={(e) => updateFilter('fornecedor', e.target.value)} className="input-field pl-9 w-52" />
          </div>
          <input type="date" value={filters.dataInicio} onChange={(e) => updateFilter('dataInicio', e.target.value)} className="input-field w-40" />
          <span className="text-gray-400 text-sm">até</span>
          <input type="date" value={filters.dataFim} onChange={(e) => updateFilter('dataFim', e.target.value)} className="input-field w-40" />
        </div>
      </div>

      {/* Floating action bar for multi-select */}
      {checked.length > 0 && (
        <div className="sticky top-0 z-30 mb-3">
          <div className="bg-gray-900 text-white rounded-xl px-5 py-3 flex items-center justify-between shadow-lg">
            <div className="flex items-center gap-4">
              <span className="text-sm">{checked.length} conta{checked.length > 1 ? 's' : ''} selecionada{checked.length > 1 ? 's' : ''}</span>
              <span className="text-sm font-semibold text-brand-300">{formatCurrency(checkedTotal)}</span>
            </div>
            <div className="flex items-center gap-2">
              {canPay && (
                <>
                  <button
                    onClick={() => {
                      setEditDocumentoBaixa(null);
                      setShowBaixaLote(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-500 transition-colors"
                  >
                    <Check size={15} /> Dar baixa selecionadas
                  </button>
                  <button onClick={() => setShowCheques(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-500 transition-colors">
                    <BookOpen size={15} /> Pagar com Cheques
                  </button>
                </>
              )}
              <button onClick={() => setChecked([])} className="px-3 py-1.5 text-sm text-gray-400 hover:text-white transition-colors">
                Limpar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-3 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={
                      checked.length > 0
                      && checked.length === data.filter(
                        (c) => (c.status === 'pendente' || c.status === 'vencido') && getSaldoContaAberto(c) > 0.01
                      ).length
                    }
                    onChange={toggleAll}
                    className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                  />
                </th>
                <th className="table-header px-3 py-3 text-center w-8">Orig.</th>
                <th className="table-header px-3 py-3 text-left">Loja</th>
                <th className="table-header px-3 py-3 text-left">Fornecedor</th>
                <th className="table-header px-3 py-3 text-left">Doc / Histórico</th>
                <th className="table-header px-3 py-3 text-left">Vencimento</th>
                <th className="table-header px-3 py-3 text-right">Valor</th>
                <th className="table-header px-3 py-3 text-center">Forma</th>
                <th className="table-header px-3 py-3 text-center">Status</th>
                <th className="table-header px-3 py-3 text-center w-28">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400"><RefreshCw size={20} className="animate-spin inline mr-2" />Carregando...</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400">
                  Nenhuma conta encontrada. Clique em "Sincronizar ERP" para importar.
                </td></tr>
              ) : (
                data.map((row) => {
                  const saldoNum = getSaldoContaAberto(row);
                  const isPayable = (row.status === 'pendente' || row.status === 'vencido') && saldoNum > 0.01;
                  const isChecked = checked.includes(row.id);
                  const valorPagoNum = parseFloat(row.valor_pago) || 0;
                  const isParcial = isPayable && valorPagoNum > 0 && saldoNum > 0.01;
                  const totalBaixas = parseInt(row.total_baixas, 10) || 0;
                  const pctPago = row.valor > 0 ? Math.min(100, (valorPagoNum / parseFloat(row.valor)) * 100) : 0;
                  return (
                    <tr
                      key={row.id}
                      className={`border-b border-gray-50 hover:bg-gray-50/50 transition-colors
                        ${isChecked ? 'bg-brand-50/40' : ''}
                        ${selectedId === row.id ? 'bg-brand-50/30' : ''}
                        ${isParcial ? 'border-l-4 border-l-amber-400' : ''}`}
                    >
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        {isPayable ? (
                          <input type="checkbox" checked={isChecked} onChange={() => toggleCheck(row.id)}
                            className="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                        ) : <span className="w-4" />}
                      </td>
                      <td className="px-3 py-3 text-center">
                        {row.origem === 'erp' ? (
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-amber-100 text-amber-700" title="ERP"><Database size={13} /></span>
                        ) : (
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-brand-100 text-brand-700" title="Manual"><FileText size={13} /></span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-500"><LojaLabel codiloja={row.codiloja} /></td>
                      <td className="px-3 py-3 text-sm cursor-pointer" onClick={() => handleSelectRow(row.id)}>
                        <p className="font-medium text-gray-900 truncate max-w-[200px]">{row.fornecedor}</p>
                        {row.erp_fornecedor_id && <p className="text-xs text-gray-400 font-mono">{row.erp_fornecedor_id}</p>}
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-600 max-w-[180px] cursor-pointer" onClick={() => handleSelectRow(row.id)}>
                        {row.documento && <p className="font-mono text-xs text-gray-500">{row.documento}</p>}
                        <p className="truncate">{row.historico || row.descricao || '—'}</p>
                        {row.plano_codigo && (
                          <p className="text-[10px] text-gray-400 truncate">
                            {row.plano_codigo} - {row.plano_descricao}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-sm">
                        <p className="text-gray-700 font-medium">{formatDate(row.data_vencimento)}</p>
                        <p className="text-xs text-gray-400">{formatDateRelative(row.data_vencimento)}</p>
                      </td>
                      <td className="px-3 py-3 text-sm text-right">
                        <p className="font-semibold text-gray-900">{formatCurrency(row.valor)}</p>
                        {isParcial && (
                          <>
                            <div className="mt-1 flex items-center gap-1 justify-end">
                              <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                <div className="h-full bg-amber-400" style={{ width: `${pctPago}%` }} />
                              </div>
                              <span className="text-[10px] text-amber-700 font-semibold">{pctPago.toFixed(0)}%</span>
                            </div>
                            <p className="text-[10px] text-amber-700 font-semibold">
                              Falta {formatCurrency(saldoNum)}
                            </p>
                          </>
                        )}
                        {row.status === 'pago' && totalBaixas > 1 && (
                          <p className="text-[10px] text-emerald-600">{totalBaixas} pagamentos</p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-sm text-center text-gray-500 capitalize">{row.forma_pagamento?.replace('_', ' ') || '—'}</td>
                      <td className="px-3 py-3 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(row.status)}`}>
                            {getStatusLabel(row.status)}
                          </span>
                          {isParcial && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-400 text-white">
                              <Clock size={10} /> PARCIAL {totalBaixas > 0 && `(${totalBaixas}x)`}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-0.5">
                          <button onClick={() => handleSelectRow(row.id)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500" title="Ver detalhe">
                            <Search size={14} />
                          </button>
                          {row.comprovante_path && (
                            <button
                              onClick={() => {
                                const p = row.comprovante_path.replace(/\\/g, '/').replace(/^.*?(uploads\/)/, 'uploads/');
                                window.open(`${window.location.protocol}//${window.location.hostname}:3001/${p}`, '_blank');
                              }}
                              className="p-1.5 rounded hover:bg-blue-50 text-blue-500"
                              title="Ver comprovante"
                            >
                              <Paperclip size={15} />
                            </button>
                          )}
                          {row.status !== 'cancelado' && row.status !== 'pago' && (
                            <button onClick={() => handleDelete(row.id)} className="p-1.5 rounded hover:bg-red-50 text-red-400" title="Cancelar">
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
          <p className="text-xs text-gray-500">{pagination.total ? `${pagination.total} registros` : ''}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setFilters(prev => ({ ...prev, page: prev.page - 1 }))} disabled={filters.page <= 1} className="btn-secondary py-1.5 px-2 text-xs disabled:opacity-40"><ChevronLeft size={14} /></button>
            <span className="text-xs text-gray-600">Pág. {pagination.page || 1} de {pagination.totalPages || 1}</span>
            <button onClick={() => setFilters(prev => ({ ...prev, page: prev.page + 1 }))} disabled={filters.page >= (pagination.totalPages || 1)} className="btn-secondary py-1.5 px-2 text-xs disabled:opacity-40"><ChevronRight size={14} /></button>
          </div>
        </div>
      </div>

      {/* Detail Panel */}
      {selectedId && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4 sm:p-6">
          <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={closeDetailModal} />
          <div className="relative z-10 w-full max-w-6xl max-h-[92vh] overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="max-h-[92vh] overflow-y-auto p-5 sm:p-6">
          {loadingDetail && !selected ? (
            <div className="text-center text-gray-400 py-12">
              <RefreshCw size={18} className="animate-spin inline mr-2" />
              Carregando rastreio da conta...
            </div>
          ) : selected && (
          <>
          <div className="flex flex-col gap-4 border-b border-gray-100 pb-4 mb-5 sm:flex-row sm:items-start sm:justify-between">
            <h3 className="text-sm font-semibold text-gray-700">
              Detalhe — {selected.fornecedor}
              <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${selected.origem === 'erp' ? 'bg-amber-100 text-amber-700' : 'bg-brand-100 text-brand-700'}`}>
                {selected.origem === 'erp' ? 'ERP' : 'Manual'}
              </span>
              <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${getConciliacaoMeta(selected.status_conciliacao).badge}`}>
                {getConciliacaoMeta(selected.status_conciliacao).label}
              </span>
              {loadingDetail && <RefreshCw size={14} className="inline ml-2 animate-spin text-gray-400" />}
            </h3>
            <div className="flex items-center gap-2 self-start">
              {isEditingSelected ? (
                <button
                  onClick={() => {
                    setSelectedForm(buildContaFormState(selected));
                    setIsEditingSelected(false);
                  }}
                  className="btn-secondary"
                >
                  Cancelar edicao
                </button>
              ) : (
                <button onClick={() => setIsEditingSelected(true)} className="btn-secondary">
                  <Pencil size={14} /> Editar conta
                </button>
              )}
              <button onClick={closeDetailModal} className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><span className="text-gray-400 block">Loja</span><LojaLabel codiloja={selected.codiloja} /></div>
            <div><span className="text-gray-400 block">Lançamento ERP</span><span className="font-mono">{selected.erp_lancamento || '—'}</span></div>
            <div><span className="text-gray-400 block">Documento</span>{selected.documento || '—'}</div>
            <div><span className="text-gray-400 block">Referência</span>{selected.referencia || '—'}</div>
            <div><span className="text-gray-400 block">Valor</span>{formatCurrency(selected.valor)}</div>
            <div><span className="text-gray-400 block">Pago</span>{formatCurrency(selected.valor_pago)}</div>
            <div><span className="text-gray-400 block">Desconto</span>{formatCurrency(selected.valor_desconto)}</div>
            <div><span className="text-gray-400 block">Juros</span>{formatCurrency(selected.valor_juros)}</div>
            <div><span className="text-gray-400 block">Forma Pgto</span>{selected.forma_pagamento?.replace('_', ' ') || 'Não informada'}</div>
            <div><span className="text-gray-400 block">Natureza</span>{formatNaturezaLabel(selected.natureza)}</div>
            <div className="col-span-2"><span className="text-gray-400 block">Plano</span>{formatContaPlanoLabel(selected)}</div>
            <div><span className="text-gray-400 block">Recorrência</span>{selected.recorrencia_id ? `#${selected.recorrencia_id}` : '—'}</div>
            <div><span className="text-gray-400 block">Emissão</span>{formatDate(selected.data_emissao)}</div>
            <div><span className="text-gray-400 block">Vencimento</span>{formatDate(selected.data_vencimento)}</div>
            <div><span className="text-gray-400 block">Pagamento</span>{formatDate(selected.data_pagamento)}</div>
            <div><span className="text-gray-400 block">Banco Baixa</span>{selected.banco_baixa || '—'}</div>
            <div><span className="text-gray-400 block">Saldo Aberto</span>{formatCurrency(selected.saldo_aberto)}</div>
            <div><span className="text-gray-400 block">Conciliação</span>{getConciliacaoMeta(selected.status_conciliacao).label}</div>
            <div className="col-span-2"><span className="text-gray-400 block">Histórico</span>{selected.historico || '—'}</div>
            <div className="col-span-2"><span className="text-gray-400 block">Observações</span>{selected.observacoes || selected.descricao || '—'}</div>
          </div>
          {/* Baixas / histórico de pagamentos */}
          {isEditingSelected && (
            <div className="mt-5">
              <ContaDetailEditor
                form={selectedForm}
                setForm={setSelectedForm}
                onCancel={() => {
                  setSelectedForm(buildContaFormState(selected));
                  setIsEditingSelected(false);
                }}
                onSave={async (formData) => {
                  const saved = await handleSaveSelectedConta(formData);
                  if (saved) {
                    setIsEditingSelected(false);
                  }
                }}
              />
            </div>
          )}
          <div className="mt-5 border border-gray-100 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Clock size={15} className="text-amber-500" />
                <h4 className="text-sm font-semibold text-gray-700">
                  Histórico de Baixas {selected.baixas?.length > 0 && `(${selected.baixas.filter(b => !b.estornada).length})`}
                </h4>
              </div>
              {selected.status !== 'cancelado' && (
                <button
                  onClick={() => { setEditBaixa(null); setShowBaixa(selected); }}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                >
                  <Plus size={13} /> Nova Baixa
                </button>
              )}
            </div>

            {selected.baixas?.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50 text-gray-500 text-xs">
                      <th className="px-2 py-2 text-left">Data</th>
                      <th className="px-2 py-2 text-left">Forma</th>
                      <th className="px-2 py-2 text-left">Banco/Conta</th>
                      <th className="px-2 py-2 text-right">Valor Pago</th>
                      <th className="px-2 py-2 text-right">Desc.</th>
                      <th className="px-2 py-2 text-right">Juros/Multa</th>
                      <th className="px-2 py-2 text-left">Origem</th>
                      <th className="px-2 py-2 text-left">Obs.</th>
                      <th className="px-2 py-2 text-center w-28">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.baixas.map((b) => {
                      const isEstornada = !!b.estornada;
                      return (
                        <tr key={b.id} className={`border-b border-gray-50 ${isEstornada ? 'bg-red-50/30 text-gray-400 line-through' : 'hover:bg-gray-50/50'}`}>
                          <td className="px-2 py-2">{formatDate(b.data_pagamento)}</td>
                          <td className="px-2 py-2 capitalize">{b.forma_pagamento?.replace('_', ' ') || '—'}</td>
                          <td className="px-2 py-2 text-xs text-gray-600">
                            {b.conta_bancaria_nome || b.banco_baixa || '—'}
                          </td>
                          <td className="px-2 py-2 text-right font-semibold">{formatCurrency(b.valor_pago)}</td>
                          <td className="px-2 py-2 text-right">{b.valor_desconto > 0 ? formatCurrency(b.valor_desconto) : '—'}</td>
                          <td className="px-2 py-2 text-right">
                            {(parseFloat(b.valor_juros) + parseFloat(b.valor_multa)) > 0
                              ? formatCurrency(parseFloat(b.valor_juros) + parseFloat(b.valor_multa))
                              : '—'}
                          </td>
                          <td className="px-2 py-2 text-xs">
                            <span className={`px-1.5 py-0.5 rounded ${
                              b.origem === 'ofx' ? 'bg-blue-100 text-blue-700' :
                              b.origem === 'lote' ? 'bg-purple-100 text-purple-700' :
                              b.origem === 'cheque' ? 'bg-amber-100 text-amber-700' :
                              'bg-gray-100 text-gray-600'
                            }`}>
                              {b.origem || 'manual'}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-xs text-gray-500 max-w-[160px] truncate" title={b.observacoes}>
                            {isEstornada ? `Estornada: ${b.estorno_motivo || 'sem motivo'}` : (b.observacoes || '—')}
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex items-center justify-center gap-1">
                              {b.comprovante_path && (
                                <button
                                  onClick={() => {
                                    const p = b.comprovante_path.replace(/\\/g, '/').replace(/^.*?(uploads\/)/, 'uploads/');
                                    window.open(`${window.location.protocol}//${window.location.hostname}:3001/${p}`, '_blank');
                                  }}
                                  className="p-1 rounded hover:bg-blue-50 text-blue-500"
                                  title="Ver comprovante"
                                >
                                  <Paperclip size={13} />
                                </button>
                              )}
                              {!isEstornada && (
                                <>
                                  <button
                                    onClick={() => handleEditarBaixa(selected, b)}
                                    className="p-1 rounded hover:bg-gray-100 text-gray-500"
                                    title="Editar baixa"
                                  >
                                    <Pencil size={13} />
                                  </button>
                                  <button
                                    onClick={() => handleEstornarBaixa(selected.id, b.id)}
                                    className="p-1 rounded hover:bg-red-50 text-red-400"
                                    title="Estornar baixa"
                                  >
                                    <Undo2 size={13} />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t-2 border-gray-100 bg-gray-50/50">
                    <tr className="text-sm font-semibold">
                      <td colSpan={3} className="px-2 py-2 text-right text-gray-500">Total</td>
                      <td className="px-2 py-2 text-right">
                        {formatCurrency(selected.baixas.filter(b => !b.estornada).reduce((s, b) => s + parseFloat(b.valor_pago || 0), 0))}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {formatCurrency(selected.baixas.filter(b => !b.estornada).reduce((s, b) => s + parseFloat(b.valor_desconto || 0), 0))}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {formatCurrency(selected.baixas.filter(b => !b.estornada).reduce((s, b) => s + parseFloat(b.valor_juros || 0) + parseFloat(b.valor_multa || 0), 0))}
                      </td>
                      <td colSpan={3} />
                    </tr>
                    {parseFloat(selected.saldo_aberto) > 0.01 && (
                      <tr className="text-sm">
                        <td colSpan={3} className="px-2 py-2 text-right text-amber-700 font-semibold">
                          <AlertTriangle size={13} className="inline mr-1" />Saldo em aberto
                        </td>
                        <td className="px-2 py-2 text-right text-amber-700 font-bold">
                          {formatCurrency(selected.saldo_aberto)}
                        </td>
                        <td colSpan={5} />
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="text-sm text-gray-400">Nenhuma baixa registrada para esta conta.</p>
            )}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-5">
            <div className="border border-gray-100 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <CreditCard size={15} className="text-brand-600" />
                <h4 className="text-sm font-semibold text-gray-700">Alocações</h4>
              </div>
              {selected.itens?.length > 0 ? (
                <div className="space-y-3">
                  {selected.itens.map((item) => (
                    <div key={item.id} className="rounded-lg bg-gray-50 p-3">
                      <p className="text-sm font-medium text-gray-800">{formatCurrency(item.valor_item)}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {item.tipo_origem === 'entrada_mercadoria'
                          ? `Entrada NF ${item.numeronf || '—'} / RR ${item.numerorr || '—'}`
                          : item.plano_descricao || item.descricao_item || 'Despesa avulsa'}
                      </p>
                      {item.plano_codigo && (
                        <p className="text-xs text-gray-400 mt-1 font-mono">{item.plano_codigo}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">Origem: {item.origem_match || 'manual'}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">Nenhuma alocação registrada para esta conta.</p>
              )}
            </div>

            <div className="border border-gray-100 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <FileText size={15} className="text-brand-600" />
                <h4 className="text-sm font-semibold text-gray-700">DDA Vinculados</h4>
              </div>
              {selected.dda_documentos?.length > 0 ? (
                <div className="space-y-3">
                  {selected.dda_documentos.map((doc) => (
                    <div key={doc.id} className="rounded-lg bg-gray-50 p-3">
                      <p className="text-sm font-medium text-gray-800">{formatCurrency(doc.valor_documento)}</p>
                      <p className="text-xs text-gray-500 mt-1">{formatDate(doc.data_vencimento)} • status {doc.status}</p>
                      <p className="text-xs text-gray-400 mt-1 font-mono break-all">{doc.linha_digitavel || doc.codigo_barras || '—'}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">Nenhum DDA vinculado a esta conta.</p>
              )}
            </div>

            <div className="border border-gray-100 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <BookOpen size={15} className="text-brand-600" />
                <h4 className="text-sm font-semibold text-gray-700">Cheques</h4>
              </div>
              {selected.cheques?.length > 0 ? (
                <div className="space-y-3">
                  {selected.cheques.map((cheque) => (
                    <div key={cheque.id} className="rounded-lg bg-gray-50 p-3">
                      <p className="text-sm font-medium text-gray-800">Cheque {cheque.numero_cheque}</p>
                      <p className="text-xs text-gray-500 mt-1">{formatCurrency(cheque.valor)} • {formatDate(cheque.data_bom_para)}</p>
                      <p className="text-xs text-gray-400 mt-1">Status: {cheque.status}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">Nenhum cheque vinculado a esta conta.</p>
              )}
            </div>
          </div>
          </>
          )}
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      <FormModal isOpen={showForm} onClose={() => { setShowForm(false); setEditItem(null); }} onSave={handleSave} editData={editItem} />
      <BaixaModal
        isOpen={!!showBaixa}
        onClose={() => { setShowBaixa(null); setEditBaixa(null); }}
        onConfirm={handleBaixa}
        conta={showBaixa}
        editBaixa={editBaixa}
        contasBancarias={contasBancarias}
      />
      <BaixaLoteModal
        isOpen={showBaixaLote}
        onClose={() => { setShowBaixaLote(false); setEditDocumentoBaixa(null); }}
        onConfirm={handleBaixaLote}
        contasSelecionadas={checkedContas}
        contasBancarias={contasBancarias}
        editDocumento={editDocumentoBaixa}
      />
      <PagarComChequesModal isOpen={showCheques} onClose={() => setShowCheques(false)} onConfirm={handlePagarComCheques} contasSelecionadas={checkedContas} />
    </div>
  );
}
