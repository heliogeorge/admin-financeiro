import { useState, useEffect } from 'react';
import { entradasApi, syncApi } from '../lib/api';
import { formatCurrency, formatDate, formatDateRelative, getDefaultDateRange } from '../lib/utils';
import {
  Search, ChevronLeft, ChevronRight, RefreshCw, Download,
  ChevronDown, ChevronUp, X, Pencil, Check, BookOpen,
  Package, CreditCard, CircleDollarSign, Link2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import LojaSelect from '../components/LojaSelect';
import LojaLabel from '../components/LojaLabel';

// ============================================
// Status helpers
// ============================================
function getStatusPgto(status) {
  const map = {
    em_aberto: { label: 'Em Aberto', badge: 'bg-red-100 text-red-700' },
    parcial: { label: 'Parcial', badge: 'bg-amber-100 text-amber-700' },
    pago: { label: 'Pago', badge: 'bg-emerald-100 text-emerald-700' },
  };
  return map[status] || { label: status, badge: 'bg-gray-100 text-gray-500' };
}

// ============================================
// Modal de edição de valores
// ============================================
function EditModal({ isOpen, onClose, onSave, entrada }) {
  const [form, setForm] = useState({});

  useEffect(() => {
    if (entrada) {
      setForm({
        total_produtos: entrada.total_produtos || 0,
        total_faturado: entrada.total_faturado || 0,
        valor_icms: entrada.valor_icms || 0,
        valor_ipi: entrada.valor_ipi || 0,
        valor_frete: entrada.valor_frete || 0,
        valor_seguro: entrada.valor_seguro || 0,
        valor_desconto: entrada.valor_desconto || 0,
        observacoes: entrada.observacoes || '',
      });
    }
  }, [entrada, isOpen]);

  if (!isOpen || !entrada) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="p-5 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Editar Valores</h2>
          <p className="text-sm text-gray-500 mt-0.5">NF {entrada.numeronf || entrada.numerorr} — {entrada.fornecedor}</p>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSave(entrada.id, form); }} className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Total Produtos</label>
              <input type="number" step="0.01" value={form.total_produtos}
                onChange={(e) => setForm(f => ({ ...f, total_produtos: e.target.value }))} className="input-field text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Total Faturado</label>
              <input type="number" step="0.01" value={form.total_faturado}
                onChange={(e) => setForm(f => ({ ...f, total_faturado: e.target.value }))} className="input-field text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">ICMS</label>
              <input type="number" step="0.01" value={form.valor_icms}
                onChange={(e) => setForm(f => ({ ...f, valor_icms: e.target.value }))} className="input-field text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">IPI</label>
              <input type="number" step="0.01" value={form.valor_ipi}
                onChange={(e) => setForm(f => ({ ...f, valor_ipi: e.target.value }))} className="input-field text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Frete</label>
              <input type="number" step="0.01" value={form.valor_frete}
                onChange={(e) => setForm(f => ({ ...f, valor_frete: e.target.value }))} className="input-field text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Desconto</label>
              <input type="number" step="0.01" value={form.valor_desconto}
                onChange={(e) => setForm(f => ({ ...f, valor_desconto: e.target.value }))} className="input-field text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Observações</label>
            <textarea value={form.observacoes} onChange={(e) => setForm(f => ({ ...f, observacoes: e.target.value }))}
              className="input-field text-sm" rows={2} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" className="btn-primary"><Check size={16} /> Salvar</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================
// Dropdown de pagamentos por entrada
// ============================================
function PagamentosDropdown({ entradaId, isOpen }) {
  const [detalhe, setDetalhe] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showCompForm, setShowCompForm] = useState(false);
  const [compForm, setCompForm] = useState({ valor: '', data_vencimento: '', observacoes: '' });
  const [savingComp, setSavingComp] = useState(false);

  const loadDetalhe = () => {
    setLoading(true);
    entradasApi.get(entradaId)
      .then(res => setDetalhe(res.data))
      .catch(() => toast.error('Erro ao carregar pagamentos'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!isOpen || !entradaId) { setDetalhe(null); setShowCompForm(false); return; }
    loadDetalhe();
  }, [isOpen, entradaId]); // eslint-disable-line

  const handleCriarComplemento = async () => {
    const valor = parseFloat(String(compForm.valor).replace(',', '.'));
    if (!valor || valor <= 0) { toast.error('Informe o valor do "por fora"'); return; }
    setSavingComp(true);
    try {
      await entradasApi.criarComplemento(entradaId, {
        valor,
        data_vencimento: compForm.data_vencimento || undefined,
        observacoes: compForm.observacoes || null,
      });
      toast.success('Complemento "por fora" lançado!');
      setShowCompForm(false);
      setCompForm({ valor: '', data_vencimento: '', observacoes: '' });
      loadDetalhe();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao lançar complemento');
    } finally {
      setSavingComp(false);
    }
  };

  if (!isOpen) return null;

  if (loading) return (
    <tr><td colSpan={11} className="px-6 py-4 bg-gray-50">
      <RefreshCw size={16} className="animate-spin inline mr-2 text-gray-400" /> Carregando pagamentos...
    </td></tr>
  );

  if (!detalhe) return null;

  const rp = detalhe.resumo_pagamento;
  const pagamentos = detalhe.pagamentos || [];
  const regra = detalhe.fornecedor_regra;
  const temComplemento = (rp.total_complemento || 0) > 0.01;
  const pendenteInformar = regra?.complemento_tipo === 'valor_informado' && !temComplemento;

  return (
    <tr>
      <td colSpan={11} className="p-0">
        <div className="bg-gray-50 border-t border-b border-gray-200 px-6 py-4">
          {/* Resumo do pagamento */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-3">
            <div className="flex items-center gap-2">
              <CircleDollarSign size={16} className="text-gray-400" />
              <span className="text-sm text-gray-600">Total NF: <strong>{formatCurrency(rp.total_entrada)}</strong></span>
            </div>
            {temComplemento && (
              <>
                <span className="text-sm text-violet-700">Por fora: <strong>{formatCurrency(rp.total_complemento)}</strong></span>
                <span className="text-sm text-gray-700">Esperado: <strong>{formatCurrency(rp.total_esperado)}</strong></span>
              </>
            )}
            <span className="text-sm text-brand-600">Titulado: <strong>{formatCurrency(rp.total_titulado)}</strong></span>
            <span className="text-sm text-emerald-600">Pago: <strong>{formatCurrency(rp.total_pago)}</strong></span>
            <span className="text-sm text-amber-600">Pendente: <strong>{formatCurrency(rp.total_pendente)}</strong></span>
            <span className={`text-sm font-semibold ${rp.saldo_sem_titulo > 0.01 ? 'text-amber-700' : 'text-emerald-600'}`}>
              Sem Título: {formatCurrency(rp.saldo_sem_titulo)}
            </span>
            <span className={`text-sm font-semibold ${rp.saldo_aberto > 0.01 ? 'text-red-600' : 'text-emerald-600'}`}>
              Saldo: {formatCurrency(rp.saldo_aberto)}
            </span>
            <span className="text-xs text-gray-400">{rp.qtd_pagas}/{rp.qtd_parcelas} parcelas pagas</span>
            {pendenteInformar && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-100 text-violet-700">
                "por fora" a informar
              </span>
            )}
            <button
              onClick={() => setShowCompForm(s => !s)}
              className={`text-xs font-medium px-2.5 py-1 rounded-lg transition-colors ${
                pendenteInformar
                  ? 'bg-violet-600 text-white hover:bg-violet-500'
                  : 'text-violet-700 bg-violet-50 hover:bg-violet-100'
              }`}
            >
              + Lançar "por fora"
            </button>
          </div>

          {showCompForm && (
            <div className="flex flex-wrap items-end gap-3 mb-3 p-3 rounded-lg border border-violet-200 bg-violet-50/50">
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">Valor *</label>
                <input
                  type="number" step="0.01" min="0" autoFocus
                  value={compForm.valor}
                  onChange={(e) => setCompForm(f => ({ ...f, valor: e.target.value }))}
                  className="input-field w-32 py-1.5 text-sm text-right"
                  placeholder="0,00"
                />
              </div>
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">Vencimento</label>
                <input
                  type="date"
                  value={compForm.data_vencimento}
                  onChange={(e) => setCompForm(f => ({ ...f, data_vencimento: e.target.value }))}
                  className="input-field w-40 py-1.5 text-sm"
                />
              </div>
              <div className="flex-1 min-w-[180px]">
                <label className="block text-[11px] text-gray-500 mb-0.5">Observações</label>
                <input
                  type="text"
                  value={compForm.observacoes}
                  onChange={(e) => setCompForm(f => ({ ...f, observacoes: e.target.value }))}
                  className="input-field py-1.5 text-sm"
                  placeholder="Ex.: combinado por telefone"
                />
              </div>
              <button
                onClick={handleCriarComplemento}
                disabled={savingComp}
                className="btn-primary py-1.5 text-sm disabled:opacity-50"
              >
                {savingComp ? 'Salvando...' : 'Confirmar'}
              </button>
              <button onClick={() => setShowCompForm(false)} className="btn-secondary py-1.5 text-sm">Cancelar</button>
            </div>
          )}

          {pagamentos.length === 0 ? (
            <p className="text-sm text-gray-400 italic">Nenhuma conta vinculada a esta entrada.</p>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Documento</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Vencimento</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Valor</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">Forma</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">Status</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Cheques</th>
                  </tr>
                </thead>
                <tbody>
                  {pagamentos.map((p, i) => (
                    <tr key={i} className="border-b border-gray-50 last:border-0">
                      <td className="px-3 py-2 text-xs">
                        <span className="font-mono text-gray-600">{p.documento || p.erp_lancamento || '—'}</span>
                        {p.tipo_titulo === 'complemento' && (
                          <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-700">
                            por fora
                          </span>
                        )}
                        {p.historico && <span className="text-gray-400 ml-1 truncate">{p.historico}</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">{formatDate(p.data_vencimento)}</td>
                      <td className="px-3 py-2 text-xs text-right font-semibold">{formatCurrency(p.valor_item ?? p.valor)}</td>
                      <td className="px-3 py-2 text-xs text-center capitalize text-gray-500">
                        {p.forma_pagamento?.replace('_', ' ') || '—'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          p.status === 'pago' ? 'bg-emerald-100 text-emerald-700'
                            : p.status === 'vencido' ? 'bg-red-100 text-red-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}>{p.status}</span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {p.cheques && p.cheques.length > 0 ? (
                          <div className="space-y-0.5">
                            {p.cheques.map((ch, j) => (
                              <div key={j} className="flex items-center gap-2">
                                <BookOpen size={10} className="text-blue-500" />
                                <span className="font-mono">{ch.numero_cheque}</span>
                                <span>{formatCurrency(ch.valor)}</span>
                                <span className="text-gray-400">{formatDate(ch.data_bom_para)}</span>
                                <span className={`text-[9px] px-1 rounded ${
                                  ch.status_cheque === 'compensado' ? 'bg-emerald-100 text-emerald-600'
                                    : ch.status_cheque === 'devolvido' ? 'bg-red-100 text-red-600'
                                    : 'bg-blue-100 text-blue-600'
                                }`}>{ch.status_cheque}</span>
                              </div>
                            ))}
                          </div>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// ============================================
// Página principal
// ============================================
export default function EntradasPage() {
  const [data, setData] = useState([]);
  const [resumo, setResumo] = useState(null);
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [editItem, setEditItem] = useState(null);

  const [filters, setFilters] = useState({
    codiloja: '', fornecedor: '', numeronf: '', status_pagamento: '',
    ...getDefaultDateRange(), page: 1, perPage: 30,
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = { ...filters };
      Object.keys(params).forEach(k => { if (params[k] === '') delete params[k]; });

      const [listRes, resumoRes] = await Promise.all([
        entradasApi.list(params),
        entradasApi.resumo({ codiloja: filters.codiloja || undefined, dataInicio: filters.dataInicio, dataFim: filters.dataFim }),
      ]);

      setData(listRes.data.data);
      setPagination(listRes.data.pagination);
      setResumo(resumoRes.data);
    } catch (err) {
      console.error('Erro:', err);
      // Se tabela não existe ainda, mostrar vazio
      if (err.response?.status === 500) {
        setData([]);
        setResumo(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [filters]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncApi.syncRelrec({
        dataInicio: filters.dataInicio || undefined,
        dataFim: filters.dataFim || undefined,
        codiloja: filters.codiloja || undefined,
      });
      toast.success(`Sync: ${result.data.inserted} novas, ${result.data.updated} atualizadas`, { duration: 5000 });
      fetchData();
    } catch (err) {
      toast.error('Erro na sincronização: ' + (err.response?.data?.error?.message || err.message));
    } finally {
      setSyncing(false);
    }
  };

  const handleAutoVincular = async (id) => {
    try {
      const res = await entradasApi.autoVincular(id);
      toast.success(res.data.message);
      // Refresh dropdown
      setExpandedId(null);
      setTimeout(() => setExpandedId(id), 100);
      fetchData();
    } catch (err) {
      toast.error('Erro ao vincular');
    }
  };

  const handleSaveEdit = async (id, formData) => {
    try {
      await entradasApi.update(id, formData);
      toast.success('Valores atualizados!');
      setEditItem(null);
      fetchData();
    } catch (err) {
      toast.error('Erro ao salvar');
    }
  };

  const updateFilter = (key, value) => setFilters(prev => ({ ...prev, [key]: value, page: 1 }));

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Entradas de Mercadoria</h1>
          <p className="text-sm text-gray-500 mt-1">Notas fiscais de entrada — editável com resumo de pagamentos</p>
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
        </div>
      </div>

      {/* Resumo Cards */}
      {resumo && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="card p-4">
            <p className="text-xs text-gray-500 font-medium uppercase">Em Aberto</p>
            <p className="text-xl font-bold text-red-600 mt-1">{formatCurrency(resumo.emAberto.total)}</p>
            <p className="text-xs text-gray-400">{resumo.emAberto.qtd} notas</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500 font-medium uppercase">Parcial</p>
            <p className="text-xl font-bold text-amber-600 mt-1">{formatCurrency(resumo.parcial.total)}</p>
            <p className="text-xs text-gray-400">{resumo.parcial.qtd} notas</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500 font-medium uppercase">Pago</p>
            <p className="text-xl font-bold text-emerald-600 mt-1">{formatCurrency(resumo.pago.total)}</p>
            <p className="text-xs text-gray-400">{resumo.pago.qtd} notas</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500 font-medium uppercase">Total Geral</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(resumo.totalGeral.total)}</p>
            <p className="text-xs text-gray-400">{resumo.totalGeral.qtd} notas</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <LojaSelect value={filters.codiloja} onChange={(e) => updateFilter('codiloja', e.target.value)} className="input-field w-36" />
          <select value={filters.status_pagamento} onChange={(e) => updateFilter('status_pagamento', e.target.value)} className="input-field w-40">
            <option value="">Todos status</option>
            <option value="em_aberto">Em Aberto</option>
            <option value="parcial">Parcial</option>
            <option value="pago">Pago</option>
          </select>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Fornecedor..." value={filters.fornecedor}
              onChange={(e) => updateFilter('fornecedor', e.target.value)} className="input-field pl-9 w-52" />
          </div>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Nº NF..." value={filters.numeronf}
              onChange={(e) => updateFilter('numeronf', e.target.value)} className="input-field pl-9 w-36" />
          </div>
          <input type="date" value={filters.dataInicio} onChange={(e) => updateFilter('dataInicio', e.target.value)} className="input-field w-40" />
          <span className="text-gray-400 text-sm">até</span>
          <input type="date" value={filters.dataFim} onChange={(e) => updateFilter('dataFim', e.target.value)} className="input-field w-40" />
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-2 py-3 w-8"></th>
                <th className="table-header px-3 py-3 text-left">Loja</th>
                <th className="table-header px-3 py-3 text-left">NF</th>
                <th className="table-header px-3 py-3 text-left">Nº RR</th>
                <th className="table-header px-3 py-3 text-left">Fornecedor</th>
                <th className="table-header px-3 py-3 text-left">Emissão</th>
                <th className="table-header px-3 py-3 text-right">Total Faturado</th>
                <th className="table-header px-3 py-3 text-right">Total Produtos</th>
                <th className="table-header px-3 py-3 text-center">Pgto</th>
                <th className="table-header px-3 py-3 text-left">Cond. Pgto</th>
                <th className="table-header px-3 py-3 text-center w-20">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-gray-400"><RefreshCw size={20} className="animate-spin inline mr-2" />Carregando...</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-gray-400">
                  Nenhuma entrada. Clique em "Sincronizar ERP" para importar do RELREC.
                </td></tr>
              ) : (
                data.map((row) => {
                  const isExpanded = expandedId === row.id;
                  const sp = getStatusPgto(row.status_pagamento);
                  return [
                    <tr key={row.id}
                      className={`border-b border-gray-50 hover:bg-gray-50/50 transition-colors cursor-pointer ${isExpanded ? 'bg-blue-50/30' : ''}`}
                      onClick={() => setExpandedId(isExpanded ? null : row.id)}
                    >
                      <td className="px-2 py-3 text-center text-gray-400">
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-500"><LojaLabel codiloja={row.codiloja} /></td>
                      <td className="px-3 py-3 text-sm font-mono font-semibold text-gray-900">{row.numeronf || '—'}</td>
                      <td className="px-3 py-3 text-sm font-mono text-gray-500">{row.numerorr}</td>
                      <td className="px-3 py-3 text-sm">
                        <p className="font-medium text-gray-900 truncate max-w-[200px]">{row.fornecedor}</p>
                        <p className="text-xs text-gray-400 font-mono">{row.codiforn}</p>
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-500">{formatDate(row.data_emissao)}</td>
                      <td className="px-3 py-3 text-sm text-right font-semibold text-brand-600">{formatCurrency(row.total_faturado)}</td>
                      <td className="px-3 py-3 text-sm text-right text-gray-700">{formatCurrency(row.total_produtos)}</td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${sp.badge}`}>{sp.label}</span>
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-500 truncate max-w-[120px]">{row.cond_pagamento || '—'}</td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-0.5">
                          <button onClick={() => setEditItem(row)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500" title="Editar valores">
                            <Pencil size={15} />
                          </button>
                          <button onClick={() => handleAutoVincular(row.id)} className="p-1.5 rounded hover:bg-blue-50 text-blue-500" title="Auto-vincular contas">
                            <Link2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>,
                    <PagamentosDropdown key={`drop-${row.id}`} entradaId={row.id} isOpen={isExpanded} />,
                  ];
                }).flat()
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
          <p className="text-xs text-gray-500">{pagination.total ? `${pagination.total} entradas` : ''}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setFilters(prev => ({ ...prev, page: prev.page - 1 }))} disabled={filters.page <= 1} className="btn-secondary py-1.5 px-2 text-xs disabled:opacity-40"><ChevronLeft size={14} /></button>
            <span className="text-xs text-gray-600">Pág. {pagination.page || 1} de {pagination.totalPages || 1}</span>
            <button onClick={() => setFilters(prev => ({ ...prev, page: prev.page + 1 }))} disabled={filters.page >= (pagination.totalPages || 1)} className="btn-secondary py-1.5 px-2 text-xs disabled:opacity-40"><ChevronRight size={14} /></button>
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      <EditModal isOpen={!!editItem} onClose={() => setEditItem(null)} onSave={handleSaveEdit} entrada={editItem} />
    </div>
  );
}
