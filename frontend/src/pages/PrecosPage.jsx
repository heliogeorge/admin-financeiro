import { Fragment, useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  DollarSign,
  PackageSearch,
  Percent,
  RefreshCw,
  Search,
  Tags,
} from 'lucide-react';
import { precosApi } from '../lib/api';
import { formatCurrency, formatDate } from '../lib/utils';
import LojaLabel from '../components/LojaLabel';

function cleanParams(params) {
  const next = { ...params };
  Object.keys(next).forEach((key) => {
    if (next[key] === '' || next[key] === false) delete next[key];
  });
  return next;
}

function formatNumber(value, decimals = 2) {
  const number = Number(value || 0);
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(number);
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center">
          <Icon size={18} />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-gray-500">{label}</p>
          <p className="text-lg font-semibold text-gray-900 truncate">{value}</p>
        </div>
      </div>
    </div>
  );
}

function SortHeader({ label, field, sort, onSort, className = '' }) {
  const active = sort.orderBy === field;
  const Icon = active ? (sort.orderDir === 'ASC' ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <th className={`table-header px-4 py-3 text-left ${className}`}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className="inline-flex items-center gap-1.5 hover:text-gray-900"
      >
        <span>{label}</span>
        <Icon size={13} className={active ? 'text-brand-600' : 'text-gray-400'} />
      </button>
    </th>
  );
}

export default function PrecosPage() {
  const [data, setData] = useState([]);
  const [resumo, setResumo] = useState(null);
  const [pagination, setPagination] = useState({});
  const [sourceTable, setSourceTable] = useState('RELAT.TB240010101');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedProduct, setExpandedProduct] = useState('');
  const [entradasByProduct, setEntradasByProduct] = useState({});

  const [filters, setFilters] = useState({
    search: '',
    codiprod: '',
    codifabr: '',
    codimarc: '',
    somenteComEstoque: false,
    orderBy: 'descprod',
    orderDir: 'ASC',
    page: 1,
    perPage: 50,
  });

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const params = cleanParams({
        ...filters,
        somenteComEstoque: filters.somenteComEstoque ? 'true' : '',
      });
      const [listRes, resumoRes] = await Promise.all([
        precosApi.list(params),
        precosApi.resumo(params),
      ]);

      setData(listRes.data.data || []);
      setPagination(listRes.data.pagination || {});
      setResumo(resumoRes.data || null);
      setSourceTable(listRes.data.tabela || resumoRes.data?.tabela || 'RELAT.TB240010101');
    } catch (err) {
      console.error('Erro ao carregar precos:', err);
      setError(err.apiMessage || err.response?.data?.error || 'Erro ao carregar a tabela de precos.');
      setData([]);
      setResumo(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [filters]);

  const updateFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }));
  };

  const updateSort = (field) => {
    setFilters((prev) => {
      const sameField = prev.orderBy === field;
      const nextDir = sameField && prev.orderDir === 'ASC' ? 'DESC' : 'ASC';
      return { ...prev, orderBy: field, orderDir: nextDir, page: 1 };
    });
  };

  const toggleEntradas = async (codiprod) => {
    if (!codiprod) return;

    if (expandedProduct === codiprod) {
      setExpandedProduct('');
      return;
    }

    setExpandedProduct(codiprod);
    if (entradasByProduct[codiprod]?.data || entradasByProduct[codiprod]?.loading) return;

    setEntradasByProduct((prev) => ({
      ...prev,
      [codiprod]: { loading: true, data: [], error: '' },
    }));

    try {
      const res = await precosApi.ultimasEntradas(codiprod);
      setEntradasByProduct((prev) => ({
        ...prev,
        [codiprod]: { loading: false, data: res.data.data || [], error: '' },
      }));
    } catch (err) {
      console.error('Erro ao carregar ultimas entradas:', err);
      setEntradasByProduct((prev) => ({
        ...prev,
        [codiprod]: {
          loading: false,
          data: [],
          error: err.apiMessage || err.response?.data?.error || 'Erro ao carregar entradas do produto.',
        },
      }));
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Consulta de Precos</h1>
          <p className="text-sm text-gray-500 mt-1">Consulta direta na tabela {sourceTable}, somente leitura</p>
        </div>
        <button onClick={fetchData} className="btn-secondary" disabled={loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <Stat icon={PackageSearch} label="Produtos" value={resumo ? resumo.total_produtos : '-'} />
        <Stat icon={Tags} label="Estoque total" value={resumo ? formatNumber(resumo.estoque_total) : '-'} />
        <Stat icon={Percent} label="Margem media" value={resumo ? `${formatNumber(resumo.margem_media)}%` : '-'} />
      </div>

      <div className="card p-4 mb-4">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,1fr)_160px_160px_160px_170px_130px] gap-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Produto, descricao, fabricante ou nome da marca"
              value={filters.search}
              onChange={(e) => updateFilter('search', e.target.value)}
              className="input-field pl-9 w-full"
            />
          </div>

          <input
            type="text"
            placeholder="Cod. produto"
            value={filters.codiprod}
            onChange={(e) => updateFilter('codiprod', e.target.value)}
            className="input-field w-full"
          />

          <input
            type="text"
            placeholder="Cod. fabricante"
            value={filters.codifabr}
            onChange={(e) => updateFilter('codifabr', e.target.value)}
            className="input-field w-full"
          />

          <input
            type="text"
            placeholder="Cod. marca"
            value={filters.codimarc}
            onChange={(e) => updateFilter('codimarc', e.target.value)}
            className="input-field w-full"
          />

          <label className="input-field flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.somenteComEstoque}
              onChange={(e) => updateFilter('somenteComEstoque', e.target.checked)}
              className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            Com estoque
          </label>

          <select
            value={filters.perPage}
            onChange={(e) => updateFilter('perPage', Number(e.target.value))}
            className="input-field w-full"
          >
            <option value={30}>30 linhas</option>
            <option value={50}>50 linhas</option>
            <option value={100}>100 linhas</option>
            <option value={200}>200 linhas</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="card p-4 mb-4 border-red-200 bg-red-50 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <SortHeader label="Codigo" field="codiprod" sort={filters} onSort={updateSort} />
                <SortHeader label="Descricao" field="descprod" sort={filters} onSort={updateSort} />
                <th className="table-header px-4 py-3 text-left">Fabricante</th>
                <th className="table-header px-4 py-3 text-left">Marca</th>
                <th className="table-header px-4 py-3 text-left">Nome marca</th>
                <th className="table-header px-4 py-3 text-right">Custo</th>
                <th className="table-header px-4 py-3 text-right">Estoque</th>
                <th className="table-header px-4 py-3 text-right">Preco</th>
                <th className="table-header px-4 py-3 text-right">Margem</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-gray-400">
                    <RefreshCw size={20} className="animate-spin inline mr-2" />
                    Carregando...
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-gray-400">
                    Nenhum produto encontrado
                  </td>
                </tr>
              ) : (
                data.map((row, index) => {
                  const isExpanded = expandedProduct === row.codiprod;
                  const entradasState = entradasByProduct[row.codiprod] || {};
                  const RowIcon = isExpanded ? ChevronUp : ChevronDown;

                  return (
                    <Fragment key={`${row.codiprod}-${index}`}>
                      <tr
                        onClick={() => toggleEntradas(row.codiprod)}
                        className={`border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer ${isExpanded ? 'bg-blue-50/30' : ''}`}
                      >
                        <td className="px-4 py-3 text-sm font-mono text-gray-700">
                          <span className="inline-flex items-center gap-2">
                            <RowIcon size={14} className="text-gray-400" />
                            {row.codiprod || '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <p className="font-medium text-gray-900 min-w-[260px]">{row.descprod || 'Produto sem descricao'}</p>
                        </td>
                        <td className="px-4 py-3 text-sm font-mono text-gray-500">{row.codifabr || '-'}</td>
                        <td className="px-4 py-3 text-sm font-mono text-gray-500">{row.codimarc || '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{row.nomemarc || '-'}</td>
                        <td className="px-4 py-3 text-sm text-right text-gray-600">{formatCurrency(row.custouni || 0)}</td>
                        <td className="px-4 py-3 text-sm text-right text-gray-600">{formatNumber(row.estoquef || 0)}</td>
                        <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900">
                          <span className="inline-flex items-center justify-end gap-1">
                            <DollarSign size={13} className="text-emerald-500" />
                            {formatCurrency(row.precoven || 0)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-medium text-brand-700">
                          {formatNumber(row.percentu || 0)}%
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr>
                          <td colSpan={9} className="p-0 bg-gray-50/70">
                            <div className="px-6 py-4 border-b border-gray-100">
                              <div className="flex items-center justify-between gap-3 mb-3">
                                <div>
                                  <p className="text-sm font-semibold text-gray-900">Ultimas entradas de mercadoria</p>
                                  <p className="text-xs text-gray-500">Carregado somente para o produto selecionado</p>
                                </div>
                              </div>

                              {entradasState.loading ? (
                                <div className="text-sm text-gray-400 py-3">
                                  <RefreshCw size={16} className="animate-spin inline mr-2" />
                                  Carregando entradas...
                                </div>
                              ) : entradasState.error ? (
                                <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                                  {entradasState.error}
                                </div>
                              ) : (entradasState.data || []).length === 0 ? (
                                <p className="text-sm text-gray-400 py-3">Nenhuma entrada encontrada para este produto.</p>
                              ) : (
                                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                                  <table className="w-full">
                                    <thead>
                                      <tr className="bg-gray-50 border-b border-gray-100">
                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Loja</th>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Entrada</th>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Data</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Preco cheio</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Unitario</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Quantidade</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {entradasState.data.map((entrada, entryIndex) => (
                                        <tr key={`${entrada.codiloja}-${entrada.numerorr}-${entryIndex}`} className="border-b border-gray-50 last:border-0">
                                          <td className="px-3 py-2 text-sm text-gray-600">
                                            <LojaLabel codiloja={entrada.codiloja} />
                                          </td>
                                          <td className="px-3 py-2 text-sm font-mono text-gray-700">{entrada.numerorr || '-'}</td>
                                          <td className="px-3 py-2 text-sm text-gray-600">{formatDate(entrada.dataemis)}</td>
                                          <td className="px-3 py-2 text-sm text-right text-gray-700">{formatCurrency(entrada.pr_cheio || 0)}</td>
                                          <td className="px-3 py-2 text-sm text-right font-semibold text-gray-900">{formatCurrency(entrada.unitario || 0)}</td>
                                          <td className="px-3 py-2 text-sm text-right text-gray-700">{formatNumber(entrada.quantidade || 0)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
          <p className="text-xs text-gray-500">{pagination.total ? `${pagination.total} produtos` : ''}</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFilters((prev) => ({ ...prev, page: prev.page - 1 }))}
              disabled={filters.page <= 1}
              className="btn-secondary py-1.5 px-2 text-xs disabled:opacity-40"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs text-gray-600">
              Pagina {pagination.page || 1} de {pagination.totalPages || 1}
            </span>
            <button
              onClick={() => setFilters((prev) => ({ ...prev, page: prev.page + 1 }))}
              disabled={filters.page >= (pagination.totalPages || 1)}
              className="btn-secondary py-1.5 px-2 text-xs disabled:opacity-40"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
