import { useEffect, useState, useRef } from 'react';
import { ddaApi, contasPagarApi } from '../lib/api';
import { formatCurrency, formatDate, getLinhaDigitavel, copyToClipboard } from '../lib/utils';
import {
  AlertTriangle, CheckCircle2, Copy, FileDigit, Link2,
  RefreshCw, Search, Upload, Trash2, X, ChevronLeft, ChevronRight,
} from 'lucide-react';
import toast from 'react-hot-toast';

const STATUS_META = {
  novo:       { label: 'Novo',       badge: 'bg-slate-100 text-slate-700' },
  sugerido:   { label: 'Sugerido',   badge: 'bg-amber-100 text-amber-700' },
  confirmado: { label: 'Confirmado', badge: 'bg-emerald-100 text-emerald-700' },
  divergente: { label: 'Divergente', badge: 'bg-red-100 text-red-700' },
  descartado: { label: 'Descartado', badge: 'bg-gray-100 text-gray-500' },
  pago:       { label: 'Pago (MP)',  badge: 'bg-indigo-100 text-indigo-700' },
};

function formatCnpj(digits = '') {
  const d = String(digits).replace(/\D/g, '');
  if (d.length === 14) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
  return digits || '—';
}

// ─── Modal de Vincular ────────────────────────────────────────────────────────
function VincularModal({ dda, onClose, onVinculado }) {
  const [search, setSearch] = useState(dda?.cedente_nome || '');
  const [contas, setContas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedConta, setSelectedConta] = useState(null);
  const [vinculando, setVinculando] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!dda) return;
    setSearch(dda.cedente_nome || '');
    setSelectedConta(null);
  }, [dda]);

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (!search.trim() || search.trim().length < 2) {
      setContas([]);
      return;
    }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await contasPagarApi.list({
          fornecedor: search.trim(),
          perPage: 15,
          status: '',
        });
        setContas(res.data.data || []);
      } catch {
        toast.error('Erro ao buscar contas');
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(timerRef.current);
  }, [search]);

  const handleConfirmar = async () => {
    if (!selectedConta) return;
    setVinculando(true);
    try {
      await ddaApi.vincularConta(dda.id, selectedConta.id);
      toast.success(`DDA vinculado a "${selectedConta.fornecedor}"`);
      onVinculado();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao vincular');
    } finally {
      setVinculando(false);
    }
  };

  if (!dda) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">Vincular boleto DDA</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {dda.cedente_nome} • {formatCurrency(dda.valor_documento)} • Venc. {formatDate(dda.data_vencimento)}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pt-4 pb-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setSelectedConta(null); }}
              placeholder="Buscar conta por fornecedor..."
              className="input-field pl-9"
            />
          </div>
        </div>

        {/* Lista de contas */}
        <div className="flex-1 overflow-y-auto px-5 pb-3 space-y-2 min-h-[120px]">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-gray-400 py-4 justify-center">
              <RefreshCw size={13} className="animate-spin" /> Buscando...
            </div>
          )}
          {!loading && contas.length === 0 && search.trim().length >= 2 && (
            <p className="text-xs text-gray-400 text-center py-4">Nenhuma conta encontrada.</p>
          )}
          {!loading && contas.map((conta) => {
            const isSelected = selectedConta?.id === conta.id;
            return (
              <button
                key={conta.id}
                type="button"
                onClick={() => setSelectedConta(isSelected ? null : conta)}
                className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${
                  isSelected
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{conta.fornecedor}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Venc. {formatDate(conta.data_vencimento)}
                      {conta.documento ? ` • ${conta.documento}` : ''}
                      {conta.nosso_numero ? ` • Nosso Nº ${conta.nosso_numero}` : ''}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-gray-800 shrink-0">{formatCurrency(conta.valor)}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100">
          {selectedConta ? (
            <p className="text-xs text-gray-500">
              Selecionado: <span className="font-medium text-gray-800">{selectedConta.fornecedor}</span>
            </p>
          ) : (
            <p className="text-xs text-gray-400">Selecione uma conta acima</p>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary text-sm">Cancelar</button>
            <button
              onClick={handleConfirmar}
              disabled={!selectedConta || vinculando}
              className="btn-primary text-sm disabled:opacity-50"
            >
              {vinculando ? <RefreshCw size={14} className="animate-spin" /> : <Link2 size={14} />}
              Vincular
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function VinculosPage() {
  const [documentos, setDocumentos] = useState([]);
  const [resumo, setResumo] = useState(null);
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(true);
  const [importText, setImportText] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [vincularDda, setVincularDda] = useState(null);
  const fileInputRef = useRef(null);
  const [filters, setFilters] = useState({
    status: 'novo',
    search: '',
    page: 1,
    perPage: 30,
    orderBy: 'data_vencimento',
    orderDir: 'ASC',
  });

  const updateFilter = (key, value) =>
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }));

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = { ...filters };
      Object.keys(params).forEach((k) => { if (params[k] === '') delete params[k]; });
      const [listRes, resumoRes] = await Promise.all([
        ddaApi.list(params),
        ddaApi.resumo(),
      ]);
      setDocumentos(listRes.data.data || []);
      setPagination(listRes.data.pagination || {});
      setResumo(resumoRes.data);
    } catch {
      toast.error('Erro ao carregar documentos DDA');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [filters]);

  const handleImport = async () => {
    if (!importText.trim()) {
      toast.error('Cole o texto do internet banking antes de importar.');
      return;
    }
    setImporting(true);
    try {
      const res = await ddaApi.importarTexto(importText);
      showImportResult(res.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao importar');
    } finally {
      setImporting(false);
    }
  };

  const handleImportFile = async (file) => {
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      toast.error('Selecione o arquivo .xlsx exportado do internet banking.');
      return;
    }
    setImporting(true);
    try {
      const res = await ddaApi.importarArquivo(file);
      showImportResult(res.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao importar o arquivo');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const showImportResult = ({ inserted, duplicated, ignored, ignoredReasons }) => {
      if (inserted > 0) {
        toast.success(`${inserted} boleto(s) importado(s)${duplicated > 0 ? ` • ${duplicated} já existiam` : ''}`);
      } else if (duplicated > 0) {
        toast('Todos os boletos já foram importados anteriormente.', { icon: 'ℹ️' });
      }
      if (ignored > 0) {
        const ignoredSummary = Object.entries(ignoredReasons || {})
          .map(([reason, total]) => `${reason}: ${total}`)
          .join(', ');
        toast(
          `${ignored} linha(s) ignorada(s) na importacao${ignoredSummary ? ` (${ignoredSummary})` : ''}.`,
          { icon: 'i' }
        );
      }
      setImportText('');
      setImportOpen(false);
      setFilters((prev) => ({ ...prev, status: 'novo', page: 1 }));
  };

  const handleCopyLinha = async (doc) => {
    const linha = getLinhaDigitavel(doc);
    if (!linha) {
      toast.error('Este boleto não tem linha digitável nem código de barras.');
      return;
    }
    const ok = await copyToClipboard(linha);
    if (ok) {
      toast.success('Linha digitável copiada');
    } else {
      toast.error('Não foi possível copiar. Linha: ' + linha);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Apagar este boleto DDA? A operação não pode ser desfeita.')) return;
    try {
      await ddaApi.delete(id);
      toast.success('Boleto removido');
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao apagar');
    }
  };

  const totalPages = pagination.totalPages || 1;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Conciliação DDA</h1>
          <p className="text-sm text-gray-500 mt-1">
            Boletos importados do internet banking — vincule cada um à conta a pagar correspondente.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchData} className="btn-secondary" disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => setImportOpen((o) => !o)} className="btn-primary">
            <Upload size={16} />
            Importar boletos
          </button>
        </div>
      </div>

      {/* Import section (collapsible) */}
      {importOpen && (
        <div className="card p-5 mb-5 border-l-4 border-brand-400">
          <div className="mb-4 pb-4 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-800 mb-2">
              Importar arquivo xlsx exportado do Itaú (DDA — Consulta Boletos Recebidos):
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => handleImportFile(e.target.files?.[0])}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="btn-primary"
            >
              {importing ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
              {importing ? 'Importando...' : 'Selecionar arquivo .xlsx'}
            </button>
          </div>
          <p className="text-sm font-semibold text-gray-800 mb-3">
            Ou cole o texto copiado do internet banking:
          </p>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={5}
            autoFocus
            className="input-field font-mono text-xs"
            placeholder="Cole aqui a tabela de boletos (formato com tabs). O sistema detecta o formato automaticamente."
          />
          <div className="flex justify-end gap-2 mt-3">
            <button onClick={() => { setImportOpen(false); setImportText(''); }} className="btn-secondary">
              Cancelar
            </button>
            <button onClick={handleImport} disabled={importing} className="btn-primary">
              {importing ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
              {importing ? 'Importando...' : 'Importar'}
            </button>
          </div>
        </div>
      )}

      {/* Summary cards */}
      {resumo && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {[
            { key: 'novo',       label: 'Novos',       icon: FileDigit,    tone: 'text-slate-700',   bg: 'bg-slate-50' },
            { key: 'sugerido',   label: 'Sugeridos',   icon: AlertTriangle,tone: 'text-amber-700',   bg: 'bg-amber-50' },
            { key: 'confirmado', label: 'Confirmados', icon: CheckCircle2, tone: 'text-emerald-700', bg: 'bg-emerald-50' },
            { key: 'divergente', label: 'Divergentes', icon: AlertTriangle,tone: 'text-red-700',     bg: 'bg-red-50' },
          ].map(({ key, label, icon: Icon, tone, bg }) => {
            const d = resumo.porStatus?.[key] || { total: 0, valor: 0 };
            return (
              <button
                key={key}
                onClick={() => updateFilter('status', filters.status === key ? '' : key)}
                className={`card p-4 text-left transition-all hover:shadow-md ${filters.status === key ? 'ring-2 ring-brand-400' : ''}`}
              >
                <div className={`inline-flex items-center justify-center w-9 h-9 rounded-xl ${bg} ${tone}`}>
                  <Icon size={16} />
                </div>
                <p className="text-xs text-gray-500 font-medium uppercase mt-3">{label}</p>
                <p className={`text-xl font-bold mt-1 ${tone}`}>{d.total}</p>
                <p className="text-xs text-gray-400">{formatCurrency(d.valor)}</p>
              </button>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <div className="card p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={filters.status}
            onChange={(e) => updateFilter('status', e.target.value)}
            className="input-field w-40"
          >
            <option value="">Todos os status</option>
            <option value="novo">Novo</option>
            <option value="sugerido">Sugerido</option>
            <option value="confirmado">Confirmado</option>
            <option value="divergente">Divergente</option>
            <option value="descartado">Descartado</option>
            <option value="pago">Pago (MP)</option>
          </select>
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={filters.search}
              onChange={(e) => updateFilter('search', e.target.value)}
              placeholder="Buscar por cedente ou CNPJ..."
              className="input-field pl-9 w-full"
            />
          </div>
          <select
            value={filters.orderBy + '_' + filters.orderDir}
            onChange={(e) => {
              const lastUnder = e.target.value.lastIndexOf('_');
              const orderBy = e.target.value.slice(0, lastUnder);
              const orderDir = e.target.value.slice(lastUnder + 1);
              setFilters((prev) => ({ ...prev, orderBy, orderDir, page: 1 }));
            }}
            className="input-field w-52"
          >
            <option value="data_vencimento_ASC">Vencimento ↑</option>
            <option value="data_vencimento_DESC">Vencimento ↓</option>
            <option value="valor_documento_DESC">Maior valor</option>
            <option value="valor_documento_ASC">Menor valor</option>
            <option value="data_importacao_DESC">Importação recente</option>
          </select>
          <select
            value={filters.perPage}
            onChange={(e) => setFilters((prev) => ({ ...prev, perPage: Number(e.target.value), page: 1 }))}
            className="input-field w-24"
          >
            <option value={20}>20</option>
            <option value={30}>30</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Cedente</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Banco</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Nosso Nº</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Vencimento</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Valor</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                    <RefreshCw size={18} className="animate-spin inline mr-2" />
                    Carregando...
                  </td>
                </tr>
              ) : documentos.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                    Nenhum documento DDA encontrado.
                  </td>
                </tr>
              ) : (
                documentos.map((doc) => {
                  const meta = STATUS_META[doc.status] || STATUS_META.novo;
                  const isConfirmado = doc.status === 'confirmado';
                  return (
                    <tr key={doc.id} className="hover:bg-gray-50/60 transition-colors">
                      {/* Cedente */}
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-gray-900">
                          {doc.cedente_nome || <span className="text-gray-400 italic">Não identificado</span>}
                        </p>
                        {doc.cedente_documento && (
                          <p className="text-xs text-gray-400 font-mono mt-0.5">{formatCnpj(doc.cedente_documento)}</p>
                        )}
                        {isConfirmado && doc.conta_fornecedor && (
                          <p className="text-xs text-emerald-600 mt-0.5 flex items-center gap-1">
                            <Link2 size={11} />
                            {doc.conta_fornecedor}
                          </p>
                        )}
                      </td>
                      {/* Banco */}
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-600">{doc.banco || '—'}</span>
                      </td>
                      {/* Nosso Nº */}
                      <td className="px-4 py-3">
                        <span className="text-xs font-mono text-gray-500">{doc.nosso_numero || '—'}</span>
                      </td>
                      {/* Vencimento */}
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-700">{formatDate(doc.data_vencimento)}</span>
                      </td>
                      {/* Valor */}
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-semibold text-gray-900">{formatCurrency(doc.valor_documento)}</span>
                      </td>
                      {/* Status */}
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${meta.badge}`}>
                          {meta.label}
                        </span>
                      </td>
                      {/* Ações */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {!isConfirmado ? (
                            <button
                              onClick={() => setVincularDda(doc)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-lg transition-colors"
                            >
                              <Link2 size={13} />
                              Vincular
                            </button>
                          ) : (
                            <button
                              onClick={() => setVincularDda(doc)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                            >
                              <Link2 size={13} />
                              Revincular
                            </button>
                          )}
                          {getLinhaDigitavel(doc) && (
                            <button
                              onClick={() => handleCopyLinha(doc)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                              title="Copiar linha digitável"
                            >
                              <Copy size={15} />
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(doc.id)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                            title="Apagar"
                          >
                            <Trash2 size={15} />
                          </button>
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
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-400">
              {pagination.total || 0} registros • página {pagination.page || 1} de {totalPages}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setFilters((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                disabled={filters.page <= 1}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 disabled:opacity-30"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => setFilters((prev) => ({ ...prev, page: Math.min(totalPages, prev.page + 1) }))}
                disabled={filters.page >= totalPages}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 disabled:opacity-30"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal vincular */}
      {vincularDda && (
        <VincularModal
          dda={vincularDda}
          onClose={() => setVincularDda(null)}
          onVinculado={() => {
            setVincularDda(null);
            fetchData();
          }}
        />
      )}
    </div>
  );
}
