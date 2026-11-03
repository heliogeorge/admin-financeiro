import { useState, useEffect } from 'react';
import { chequesApi, contasPagarApi } from '../lib/api';
import {
  formatCurrency, formatDate, formatDateRelative, getDefaultDateRange,
} from '../lib/utils';
import {
  Plus, Search, ChevronLeft, ChevronRight, RefreshCw,
  X, Check, Trash2, Pencil, Ban, RotateCcw, CheckCircle2,
  AlertTriangle, Clock, BookOpen,
} from 'lucide-react';
import toast from 'react-hot-toast';
import LojaSelect from '../components/LojaSelect';
import LojaLabel from '../components/LojaLabel';

// ============================================
// Status helpers
// ============================================
function getChequeStatusBadge(status) {
  const map = {
    emitido: 'bg-blue-100 text-blue-700',
    compensado: 'bg-emerald-100 text-emerald-700',
    devolvido: 'bg-red-100 text-red-700',
    cancelado: 'bg-gray-100 text-gray-500',
    reapresentado: 'bg-amber-100 text-amber-700',
  };
  return map[status] || 'bg-gray-100 text-gray-500';
}

function getChequeStatusLabel(status) {
  const map = {
    emitido: 'Emitido',
    compensado: 'Compensado',
    devolvido: 'Devolvido',
    cancelado: 'Cancelado',
    reapresentado: 'Reapresentado',
  };
  return map[status] || status;
}

// ============================================
// Modal para selecionar contas do fornecedor
// ============================================
function SelecionarContasModal({ isOpen, onClose, onSelect, fornecedor }) {
  const [contas, setContas] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !fornecedor) return;
    setLoading(true);
    setSelected([]);
    contasPagarApi.list({
      fornecedor,
      status: '', // todas menos canceladas
      perPage: 200,
      orderBy: 'data_vencimento',
      orderDir: 'ASC',
    }).then(res => {
      // Filtrar pendentes e vencidas
      const pendentes = res.data.data.filter(c => c.status === 'pendente' || c.status === 'vencido');
      setContas(pendentes);
    }).catch(() => toast.error('Erro ao carregar contas'))
      .finally(() => setLoading(false));
  }, [isOpen, fornecedor]);

  const toggle = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const totalSelected = contas.filter(c => selected.includes(c.id)).reduce((sum, c) => sum + (c.valor || 0), 0);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Selecionar Contas</h2>
            <p className="text-sm text-gray-500 mt-0.5">Fornecedor: {fornecedor}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-gray-100 text-gray-400"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center py-12 text-gray-400"><RefreshCw size={20} className="animate-spin inline mr-2" />Carregando...</div>
          ) : contas.length === 0 ? (
            <div className="text-center py-12 text-gray-400">Nenhuma conta pendente/vencida para este fornecedor</div>
          ) : (
            <div className="space-y-2">
              {contas.map(c => (
                <label key={c.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${selected.includes(c.id) ? 'border-brand-500 bg-brand-50' : 'border-gray-100 hover:bg-gray-50'}`}>
                  <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} className="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {c.documento && <span className="text-xs font-mono text-gray-500">{c.documento}</span>}
                      <span className="text-xs text-gray-400 truncate">{c.historico || c.descricao || '—'}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">Venc: {formatDate(c.data_vencimento)}</p>
                  </div>
                  <span className={`text-sm font-semibold ${c.status === 'vencido' ? 'text-red-600' : 'text-gray-900'}`}>{formatCurrency(c.valor)}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between p-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <div>
            <span className="text-sm text-gray-500">{selected.length} selecionadas</span>
            <span className="text-sm font-semibold text-gray-900 ml-2">{formatCurrency(totalSelected)}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary text-sm">Cancelar</button>
            <button onClick={() => onSelect(selected, totalSelected)} disabled={selected.length === 0} className="btn-primary text-sm disabled:opacity-40">
              Confirmar ({selected.length})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Modal de criação de cheque
// ============================================
function ChequeFormModal({ isOpen, onClose, onSave, editData = null }) {
  const [form, setForm] = useState({
    numero_cheque: '', banco: '', agencia: '', conta: '',
    fornecedor: '', erp_fornecedor_id: '', valor: '',
    data_emissao: new Date().toISOString().slice(0, 10),
    data_bom_para: '', codiloja: '', observacoes: '',
    contas_ids: [], dar_baixa: true,
  });
  const [showContas, setShowContas] = useState(false);

  useEffect(() => {
    if (editData) {
      setForm({
        numero_cheque: editData.numero_cheque || '',
        banco: editData.banco || '',
        agencia: editData.agencia || '',
        conta: editData.conta || '',
        fornecedor: editData.fornecedor || '',
        erp_fornecedor_id: editData.erp_fornecedor_id || '',
        valor: editData.valor || '',
        data_emissao: editData.data_emissao?.slice(0, 10) || '',
        data_bom_para: editData.data_bom_para?.slice(0, 10) || '',
        codiloja: editData.codiloja || '',
        observacoes: editData.observacoes || '',
        contas_ids: [], dar_baixa: true,
      });
    } else {
      setForm({
        numero_cheque: '', banco: '', agencia: '', conta: '',
        fornecedor: '', erp_fornecedor_id: '', valor: '',
        data_emissao: new Date().toISOString().slice(0, 10),
        data_bom_para: '', codiloja: '', observacoes: '',
        contas_ids: [], dar_baixa: true,
      });
    }
  }, [editData, isOpen]);

  if (!isOpen) return null;

  const handleContasSelected = (ids, total) => {
    setForm(f => ({ ...f, contas_ids: ids, valor: f.valor || total.toFixed(2) }));
    setShowContas(false);
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
        <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <h2 className="text-lg font-bold text-gray-900">{editData ? 'Editar Cheque' : 'Novo Cheque'}</h2>
            <button onClick={onClose} className="p-1 rounded-md hover:bg-gray-100 text-gray-400"><X size={20} /></button>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); onSave(form); }} className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Nº Cheque *</label>
                <input type="text" value={form.numero_cheque} onChange={(e) => setForm(f => ({ ...f, numero_cheque: e.target.value }))} className="input-field font-mono" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Loja</label>
                <LojaSelect
                  value={form.codiloja}
                  onChange={(e) => setForm(f => ({ ...f, codiloja: e.target.value }))}
                  className="input-field"
                  includeAll={false}
                  emptyLabel="—"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-600 mb-1">Fornecedor *</label>
                <input type="text" value={form.fornecedor} onChange={(e) => setForm(f => ({ ...f, fornecedor: e.target.value }))} className="input-field" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Banco</label>
                <input type="text" value={form.banco} onChange={(e) => setForm(f => ({ ...f, banco: e.target.value }))} className="input-field" placeholder="Ex: Itaú" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Agência / Conta</label>
                <div className="flex gap-2">
                  <input type="text" value={form.agencia} onChange={(e) => setForm(f => ({ ...f, agencia: e.target.value }))} className="input-field font-mono" placeholder="Ag." />
                  <input type="text" value={form.conta} onChange={(e) => setForm(f => ({ ...f, conta: e.target.value }))} className="input-field font-mono" placeholder="Conta" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Valor *</label>
                <input type="number" step="0.01" value={form.valor} onChange={(e) => setForm(f => ({ ...f, valor: e.target.value }))} className="input-field" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Data Emissão *</label>
                <input type="date" value={form.data_emissao} onChange={(e) => setForm(f => ({ ...f, data_emissao: e.target.value }))} className="input-field" required />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-600 mb-1">Data Bom Para (pré-datado) *</label>
                <input type="date" value={form.data_bom_para} onChange={(e) => setForm(f => ({ ...f, data_bom_para: e.target.value }))} className="input-field" required />
              </div>

              {/* Vincular contas */}
              {!editData && (
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-600 mb-1">Contas vinculadas</label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => form.fornecedor ? setShowContas(true) : toast.error('Preencha o fornecedor primeiro')}
                      className="btn-secondary text-sm"
                    >
                      <BookOpen size={14} /> Selecionar Contas ({form.contas_ids.length})
                    </button>
                    {form.contas_ids.length > 0 && (
                      <span className="text-xs text-emerald-600 font-medium">{form.contas_ids.length} contas selecionadas</span>
                    )}
                  </div>
                  {form.contas_ids.length > 0 && (
                    <label className="flex items-center gap-2 mt-2 text-sm text-gray-600 cursor-pointer">
                      <input type="checkbox" checked={form.dar_baixa} onChange={(e) => setForm(f => ({ ...f, dar_baixa: e.target.checked }))} className="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                      Dar baixa nas contas selecionadas
                    </label>
                  )}
                </div>
              )}

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-600 mb-1">Observações</label>
                <textarea value={form.observacoes} onChange={(e) => setForm(f => ({ ...f, observacoes: e.target.value }))} className="input-field" rows={2} />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
              <button type="submit" className="btn-primary">{editData ? 'Salvar' : 'Emitir Cheque'}</button>
            </div>
          </form>
        </div>
      </div>
      <SelecionarContasModal
        isOpen={showContas}
        onClose={() => setShowContas(false)}
        onSelect={handleContasSelected}
        fornecedor={form.fornecedor}
      />
    </>
  );
}

// ============================================
// Página principal
// ============================================
export default function ChequesPage() {
  const [data, setData] = useState([]);
  const [resumo, setResumo] = useState(null);
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detalhe, setDetalhe] = useState(null);

  const [filters, setFilters] = useState({
    status: '', fornecedor: '', codiloja: '',
    ...getDefaultDateRange(),
    page: 1, perPage: 30,
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = { ...filters };
      Object.keys(params).forEach(k => { if (params[k] === '') delete params[k]; });

      const [listRes, resumoRes] = await Promise.all([
        chequesApi.list(params),
        chequesApi.resumo(),
      ]);

      setData(listRes.data.data);
      setPagination(listRes.data.pagination);
      setResumo(resumoRes.data);
    } catch (err) {
      console.error('Erro:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [filters]);

  // Ao clicar numa linha, buscar detalhe com contas vinculadas
  const handleSelect = async (row) => {
    if (selected?.id === row.id) {
      setSelected(null);
      setDetalhe(null);
      return;
    }
    setSelected(row);
    try {
      const res = await chequesApi.get(row.id);
      setDetalhe(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSave = async (formData) => {
    try {
      if (editItem) {
        await chequesApi.update(editItem.id, formData);
        toast.success('Cheque atualizado!');
      } else {
        await chequesApi.create(formData);
        toast.success('Cheque emitido!');
      }
      setShowForm(false);
      setEditItem(null);
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao salvar');
    }
  };

  const handleCompensar = async (id) => {
    if (!confirm('Confirma que este cheque foi compensado?')) return;
    try {
      await chequesApi.compensar(id);
      toast.success('Cheque compensado!');
      fetchData();
      setSelected(null);
    } catch (err) {
      toast.error('Erro ao compensar');
    }
  };

  const handleDevolver = async (id) => {
    const obs = prompt('Motivo da devolução:');
    if (obs === null) return;
    try {
      await chequesApi.devolver(id, { observacoes: obs });
      toast.success('Cheque devolvido — contas revertidas');
      fetchData();
      setSelected(null);
    } catch (err) {
      toast.error('Erro ao devolver');
    }
  };

  const handleCancelar = async (id) => {
    if (!confirm('Confirma o cancelamento deste cheque?')) return;
    try {
      await chequesApi.delete(id);
      toast.success('Cheque cancelado');
      fetchData();
    } catch (err) {
      toast.error('Erro ao cancelar');
    }
  };

  const updateFilter = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value, page: 1 }));
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Controle de Cheques</h1>
          <p className="text-sm text-gray-500 mt-1">Emissão, rastreamento e compensação de cheques</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchData} className="btn-secondary" disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => { setEditItem(null); setShowForm(true); }} className="btn-primary">
            <Plus size={16} /> Novo Cheque
          </button>
        </div>
      </div>

      {/* Resumo */}
      {resumo && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="card p-4">
            <p className="text-xs text-gray-500 font-medium uppercase">Emitidos</p>
            <p className="text-xl font-bold text-blue-600 mt-1">{formatCurrency(resumo.emitido.total)}</p>
            <p className="text-xs text-gray-400">{resumo.emitido.qtd} cheques</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500 font-medium uppercase">A Vencer (7 dias)</p>
            <p className="text-xl font-bold text-amber-600 mt-1">{formatCurrency(resumo.aVencer7dias.total)}</p>
            <p className="text-xs text-gray-400">{resumo.aVencer7dias.qtd} cheques</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500 font-medium uppercase">Compensados</p>
            <p className="text-xl font-bold text-emerald-600 mt-1">{formatCurrency(resumo.compensado.total)}</p>
            <p className="text-xs text-gray-400">{resumo.compensado.qtd} cheques</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500 font-medium uppercase">Devolvidos</p>
            <p className="text-xl font-bold text-red-600 mt-1">{formatCurrency(resumo.devolvido.total)}</p>
            <p className="text-xs text-gray-400">{resumo.devolvido.qtd} cheques</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <LojaSelect value={filters.codiloja} onChange={(e) => updateFilter('codiloja', e.target.value)} className="input-field w-36" />
          <select value={filters.status} onChange={(e) => updateFilter('status', e.target.value)} className="input-field w-40">
            <option value="">Todos status</option>
            <option value="emitido">Emitido</option>
            <option value="compensado">Compensado</option>
            <option value="devolvido">Devolvido</option>
            <option value="cancelado">Cancelado</option>
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

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="table-header px-3 py-3 text-left">Loja</th>
                <th className="table-header px-3 py-3 text-left">Nº Cheque</th>
                <th className="table-header px-3 py-3 text-left">Banco</th>
                <th className="table-header px-3 py-3 text-left">Fornecedor</th>
                <th className="table-header px-3 py-3 text-right">Valor</th>
                <th className="table-header px-3 py-3 text-left">Emissão</th>
                <th className="table-header px-3 py-3 text-left">Bom Para</th>
                <th className="table-header px-3 py-3 text-center">Status</th>
                <th className="table-header px-3 py-3 text-center w-32">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400"><RefreshCw size={20} className="animate-spin inline mr-2" />Carregando...</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400">Nenhum cheque encontrado. Clique em "Novo Cheque" para emitir.</td></tr>
              ) : (
                data.map((row) => (
                  <tr
                    key={row.id}
                    className={`border-b border-gray-50 hover:bg-gray-50/50 transition-colors cursor-pointer ${selected?.id === row.id ? 'bg-brand-50/30' : ''}`}
                    onClick={() => handleSelect(row)}
                  >
                    <td className="px-3 py-3 text-sm text-gray-500"><LojaLabel codiloja={row.codiloja} /></td>
                    <td className="px-3 py-3 text-sm font-mono font-semibold text-gray-900">{row.numero_cheque}</td>
                    <td className="px-3 py-3 text-sm text-gray-600">{row.banco || '—'}</td>
                    <td className="px-3 py-3 text-sm font-medium text-gray-900 truncate max-w-[200px]">{row.fornecedor}</td>
                    <td className="px-3 py-3 text-sm text-right font-semibold text-gray-900">{formatCurrency(row.valor)}</td>
                    <td className="px-3 py-3 text-sm text-gray-500">{formatDate(row.data_emissao)}</td>
                    <td className="px-3 py-3 text-sm">
                      <p className="text-gray-700 font-medium">{formatDate(row.data_bom_para)}</p>
                      <p className="text-xs text-gray-400">{formatDateRelative(row.data_bom_para)}</p>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${getChequeStatusBadge(row.status)}`}>
                        {getChequeStatusLabel(row.status)}
                      </span>
                    </td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-0.5">
                        {row.status === 'emitido' && (
                          <>
                            <button onClick={() => handleCompensar(row.id)} className="p-1.5 rounded hover:bg-emerald-50 text-emerald-600" title="Compensar">
                              <CheckCircle2 size={15} />
                            </button>
                            <button onClick={() => handleDevolver(row.id)} className="p-1.5 rounded hover:bg-red-50 text-red-500" title="Devolver">
                              <RotateCcw size={15} />
                            </button>
                          </>
                        )}
                        <button onClick={() => { setEditItem(row); setShowForm(true); }} className="p-1.5 rounded hover:bg-gray-100 text-gray-500" title="Editar">
                          <Pencil size={15} />
                        </button>
                        {row.status !== 'cancelado' && row.status !== 'compensado' && (
                          <button onClick={() => handleCancelar(row.id)} className="p-1.5 rounded hover:bg-red-50 text-red-400" title="Cancelar">
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
          <p className="text-xs text-gray-500">{pagination.total ? `${pagination.total} cheques` : ''}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setFilters(prev => ({ ...prev, page: prev.page - 1 }))} disabled={filters.page <= 1} className="btn-secondary py-1.5 px-2 text-xs disabled:opacity-40"><ChevronLeft size={14} /></button>
            <span className="text-xs text-gray-600">Pág. {pagination.page || 1} de {pagination.totalPages || 1}</span>
            <button onClick={() => setFilters(prev => ({ ...prev, page: prev.page + 1 }))} disabled={filters.page >= (pagination.totalPages || 1)} className="btn-secondary py-1.5 px-2 text-xs disabled:opacity-40"><ChevronRight size={14} /></button>
          </div>
        </div>
      </div>

      {/* Detail Panel */}
      {selected && detalhe && (
        <div className="card p-5 mt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">
              Cheque {detalhe.numero_cheque} — {detalhe.fornecedor}
            </h3>
            <button onClick={() => { setSelected(null); setDetalhe(null); }} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
            <div><span className="text-gray-400 block">Banco</span>{detalhe.banco || '—'}</div>
            <div><span className="text-gray-400 block">Agência</span>{detalhe.agencia || '—'}</div>
            <div><span className="text-gray-400 block">Conta</span>{detalhe.conta || '—'}</div>
            <div><span className="text-gray-400 block">Valor</span>{formatCurrency(detalhe.valor)}</div>
            <div><span className="text-gray-400 block">Emissão</span>{formatDate(detalhe.data_emissao)}</div>
            <div><span className="text-gray-400 block">Bom Para</span>{formatDate(detalhe.data_bom_para)}</div>
            <div><span className="text-gray-400 block">Compensação</span>{formatDate(detalhe.data_compensacao) || '—'}</div>
            <div><span className="text-gray-400 block">Obs</span>{detalhe.observacoes || '—'}</div>
          </div>

          {/* Contas vinculadas */}
          {detalhe.contas && detalhe.contas.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Contas vinculadas ({detalhe.contas.length})</h4>
              <div className="border border-gray-100 rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50/50 border-b border-gray-100">
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Lançamento</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Documento</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Histórico</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Vencimento</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Valor</th>
                      <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalhe.contas.map((c, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td className="px-3 py-2 text-xs font-mono text-gray-600">{c.erp_lancamento || '—'}</td>
                        <td className="px-3 py-2 text-xs text-gray-600">{c.documento || '—'}</td>
                        <td className="px-3 py-2 text-xs text-gray-500 truncate max-w-[180px]">{c.historico || '—'}</td>
                        <td className="px-3 py-2 text-xs text-gray-500">{formatDate(c.data_vencimento)}</td>
                        <td className="px-3 py-2 text-xs text-right font-semibold">{formatCurrency(c.valor_conta)}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${c.status_conta === 'pago' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                            {c.status_conta}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {detalhe.contas && detalhe.contas.length === 0 && (
            <p className="text-xs text-gray-400">Nenhuma conta vinculada a este cheque.</p>
          )}
        </div>
      )}

      {/* Modal */}
      <ChequeFormModal isOpen={showForm} onClose={() => { setShowForm(false); setEditItem(null); }} onSave={handleSave} editData={editItem} />
    </div>
  );
}
