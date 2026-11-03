import { useEffect, useState } from 'react';
import { RefreshCw, ChevronLeft, ChevronRight, Search, TrendingUp, Users, ReceiptText } from 'lucide-react';
import { rankingVendasApi } from '../lib/api';
import { formatCurrency, formatDate, getDefaultDateRange } from '../lib/utils';
import LojaSelect from '../components/LojaSelect';
import LojaLabel from '../components/LojaLabel';

function cleanParams(params) {
  const next = { ...params };
  Object.keys(next).forEach((key) => {
    if (next[key] === '') delete next[key];
  });
  return next;
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center">
          <Icon size={18} />
        </div>
        <div>
          <p className="text-xs text-gray-500">{label}</p>
          <p className="text-lg font-semibold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  );
}

export default function RankingVendasPage() {
  const [data, setData] = useState([]);
  const [resumo, setResumo] = useState(null);
  const [fontes, setFontes] = useState([]);
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [filters, setFilters] = useState({
    codiloja: '',
    codivend: '',
    ...getDefaultDateRange(),
    page: 1,
    perPage: 50,
  });

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const params = cleanParams(filters);
      const [listRes, resumoRes] = await Promise.all([
        rankingVendasApi.list(params),
        rankingVendasApi.resumo(params),
      ]);
      setData(listRes.data.data || []);
      setPagination(listRes.data.pagination || {});
      setResumo(resumoRes.data || null);
      setFontes(listRes.data.fontes || resumoRes.data.fontes || []);
    } catch (err) {
      console.error('Erro ao carregar ranking de vendas:', err);
      setError(err.apiMessage || err.response?.data?.error || 'Erro ao carregar dados da PV_COM.');
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ranking Vendas</h1>
          <p className="text-sm text-gray-500 mt-1">Teste direto na tabela SAS.PV_COM, somente leitura</p>
          {fontes.length > 0 && (
            <p className="text-xs text-gray-400 mt-1">Fontes consultadas: {fontes.join(', ')}</p>
          )}
        </div>
        <button onClick={fetchData} className="btn-secondary">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <Stat icon={ReceiptText} label="Pedidos" value={resumo ? resumo.qtd_pedidos : '-'} />
        <Stat icon={TrendingUp} label="Total vendido" value={formatCurrency(resumo?.total_vendas || 0)} />
        <Stat icon={Users} label="Vendedores" value={resumo ? resumo.qtd_vendedores : '-'} />
      </div>

      <div className="card p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <LojaSelect
            value={filters.codiloja}
            onChange={(e) => updateFilter('codiloja', e.target.value)}
            className="input-field w-40"
          />

          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Codigo vendedor"
              value={filters.codivend}
              onChange={(e) => updateFilter('codivend', e.target.value)}
              className="input-field pl-9 w-44"
            />
          </div>

          <input
            type="date"
            value={filters.dataInicio}
            onChange={(e) => updateFilter('dataInicio', e.target.value)}
            className="input-field w-40"
          />
          <span className="text-gray-400 text-sm">ate</span>
          <input
            type="date"
            value={filters.dataFim}
            onChange={(e) => updateFilter('dataFim', e.target.value)}
            className="input-field w-40"
          />

          <select
            value={filters.perPage}
            onChange={(e) => updateFilter('perPage', Number(e.target.value))}
            className="input-field w-32"
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

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="table-header px-4 py-3 text-left">Loja</th>
                  <th className="table-header px-4 py-3 text-left">Fonte</th>
                  <th className="table-header px-4 py-3 text-left">Emissao</th>
                  <th className="table-header px-4 py-3 text-left">Vendedor</th>
                  <th className="table-header px-4 py-3 text-right">Valor pedido</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-gray-400">
                      <RefreshCw size={20} className="animate-spin inline mr-2" />
                      Carregando...
                    </td>
                  </tr>
                ) : data.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-gray-400">
                      Nenhum pedido encontrado
                    </td>
                  </tr>
                ) : (
                  data.map((row, index) => (
                    <tr key={`${row.codiloja}-${row.dataemis}-${row.codivend}-${index}`} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 text-sm"><LojaLabel codiloja={row.codiloja} className="text-gray-700" /></td>
                      <td className="px-4 py-3 text-sm text-gray-500">{row.fonte || 'principal'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{formatDate(row.dataemis)}</td>
                      <td className="px-4 py-3 text-sm">
                        <p className="font-medium text-gray-900">{row.nomevend || 'Vendedor sem nome'}</p>
                        <p className="text-xs font-mono text-gray-400">{row.codivend || '-'}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900">
                        {formatCurrency(row.valorbas || 0)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">{pagination.total ? `${pagination.total} registros` : ''}</p>
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

        <div className="card p-4 h-fit">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Top vendedores</h2>
          <div className="space-y-2">
            {(resumo?.por_vendedor || []).length === 0 ? (
              <p className="text-sm text-gray-400">Sem dados no periodo.</p>
            ) : (
              resumo.por_vendedor.map((row, index) => (
                <div key={`${row.codivend}-${index}`} className="flex items-center justify-between gap-3 border-b border-gray-50 pb-2 last:border-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{row.nomevend || 'Vendedor sem nome'}</p>
                    <p className="text-xs text-gray-400 font-mono">{row.codivend || '-'}</p>
                    <p className="text-xs text-gray-400">{row.qtd_pedidos} pedidos</p>
                  </div>
                  <p className="text-sm font-semibold text-gray-900">{formatCurrency(row.total_vendas)}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
