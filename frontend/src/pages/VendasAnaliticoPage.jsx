import { Fragment, useEffect, useRef, useState } from 'react';
import { RefreshCw, ChevronLeft, ChevronRight, Search, TrendingUp, Users, ReceiptText, Boxes } from 'lucide-react';
import { vendasAnaliticoApi } from '../lib/api';
import { formatCurrency, formatDate, getDefaultDateRange, debounce } from '../lib/utils';
import LojaSelect from '../components/LojaSelect';
import LojaLabel from '../components/LojaLabel';

function cleanParams(params) {
  const next = { ...params };
  Object.keys(next).forEach((key) => {
    if (next[key] === '') delete next[key];
  });
  return next;
}

function formatQtd(value) {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
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

export default function VendasAnaliticoPage() {
  const [data, setData] = useState([]);
  const [resumo, setResumo] = useState(null);
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [produtoInput, setProdutoInput] = useState('');
  const requestIdRef = useRef(0);

  const [filters, setFilters] = useState({
    codiloja: '',
    codivend: '',
    produto: '',
    ...getDefaultDateRange(),
    page: 1,
    perPage: 50,
  });

  const fetchData = async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError('');
    try {
      const params = cleanParams(filters);
      const [listRes, resumoRes] = await Promise.all([
        vendasAnaliticoApi.list(params),
        vendasAnaliticoApi.resumo(params),
      ]);
      if (requestId !== requestIdRef.current) return; // resposta antiga, descarta
      setData(listRes.data.data || []);
      setPagination(listRes.data.pagination || {});
      setResumo(resumoRes.data || null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      console.error('Erro ao carregar vendas analitico:', err);
      setError(err.apiMessage || err.response?.data?.error || 'Erro ao consultar pedidos de venda no ERP.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [filters]);

  const updateFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }));
  };

  const updateProduto = debounce((value) => updateFilter('produto', value), 500);

  // agrupa pedidos da página por vendedor (loja + codivend)
  const grupos = [];
  for (const pedido of data) {
    const key = `${pedido.codiloja}|${pedido.codivend}`;
    const last = grupos[grupos.length - 1];
    if (last && last.key === key) last.pedidos.push(pedido);
    else grupos.push({ key, codiloja: pedido.codiloja, codivend: pedido.codivend, nomevend: pedido.nomevend, pedidos: [pedido] });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vendas Analítico</h1>
          <p className="text-sm text-gray-500 mt-1">
            Pedidos de venda (PV) por vendedor, com itens — direto do ERP, somente leitura
          </p>
        </div>
        <button onClick={fetchData} className="btn-secondary">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat icon={TrendingUp} label="Total vendido" value={formatCurrency(resumo?.total_vendas || 0)} />
        <Stat icon={Boxes} label="Quantidade" value={formatQtd(resumo?.qtd_itens)} />
        <Stat icon={ReceiptText} label="Pedidos" value={resumo ? resumo.qtd_pedidos : '-'} />
        <Stat icon={Users} label="Vendedores" value={resumo ? resumo.qtd_vendedores : '-'} />
      </div>

      <div className="card p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <LojaSelect
            value={filters.codiloja}
            onChange={(e) => updateFilter('codiloja', e.target.value)}
            className="input-field w-40"
          />

          <select
            value={filters.codivend ? `${filters.codiloja}|${filters.codivend}` : ''}
            onChange={(e) => {
              const [loja, vend] = e.target.value.split('|');
              setFilters((prev) => ({
                ...prev,
                codivend: vend || '',
                codiloja: vend ? loja : prev.codiloja,
                page: 1,
              }));
            }}
            className="input-field w-52"
          >
            <option value="">Todos os vendedores</option>
            {(resumo?.por_vendedor || []).map((v) => (
              <option key={`${v.codiloja}-${v.codivend}`} value={`${v.codiloja}|${v.codivend}`}>
                {v.codivend} - {v.nomevend || 'sem nome'} (loja {v.codiloja})
              </option>
            ))}
          </select>

          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Produto (código, descrição, ref.)"
              value={produtoInput}
              onChange={(e) => { setProdutoInput(e.target.value); updateProduto(e.target.value); }}
              className="input-field pl-9 w-64"
            />
          </div>

          <input
            type="date"
            value={filters.dataInicio}
            onChange={(e) => updateFilter('dataInicio', e.target.value)}
            className="input-field w-40"
          />
          <span className="text-gray-400 text-sm">até</span>
          <input
            type="date"
            value={filters.dataFim}
            onChange={(e) => updateFilter('dataFim', e.target.value)}
            className="input-field w-40"
          />

          <select
            value={filters.perPage}
            onChange={(e) => updateFilter('perPage', Number(e.target.value))}
            className="input-field w-36"
          >
            <option value={25}>25 pedidos</option>
            <option value={50}>50 pedidos</option>
            <option value={100}>100 pedidos</option>
            <option value={200}>200 pedidos</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="card p-4 mb-4 border-red-200 bg-red-50 text-sm text-red-700">{error}</div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-4">
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="table-header px-4 py-3 text-left">Produto</th>
                  <th className="table-header px-3 py-3 text-left">Ref.</th>
                  <th className="table-header px-3 py-3 text-left">Un</th>
                  <th className="table-header px-3 py-3 text-right">Qtd</th>
                  <th className="table-header px-3 py-3 text-right">Unitário</th>
                  <th className="table-header px-4 py-3 text-right">Total item</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                      <RefreshCw size={20} className="animate-spin inline mr-2" />
                      Carregando...
                    </td>
                  </tr>
                ) : data.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                      Nenhum pedido encontrado no período
                    </td>
                  </tr>
                ) : (
                  grupos.map((grupo) => (
                    <Fragment key={grupo.key}>
                      <tr className="bg-gray-900">
                        <td colSpan={6} className="px-4 py-2 text-sm font-semibold text-white">
                          Vendedor: {grupo.codivend} {grupo.nomevend || 'sem nome'}
                          <span className="ml-2 text-xs font-normal text-gray-300">
                            <LojaLabel codiloja={grupo.codiloja} />
                          </span>
                        </td>
                      </tr>
                      {grupo.pedidos.map((pedido) => (
                        <Fragment key={`${pedido.codiloja}-${pedido.numeropi}`}>
                          <tr className="bg-brand-50/60 border-b border-gray-100">
                            <td colSpan={4} className="px-4 py-2 text-sm">
                              <span className="font-mono font-semibold text-gray-900">{pedido.numeropi}</span>
                              <span className="ml-3 text-gray-600">{formatDate(pedido.dataemis)}</span>
                              <span className="ml-3 text-gray-700">{pedido.nomeclie || `Cliente ${pedido.codiclie}`}</span>
                              <span className="ml-3 text-gray-500">{pedido.nomepaga}</span>
                            </td>
                            <td className="px-3 py-2 text-sm text-right text-gray-600">{formatQtd(pedido.qtd_itens)}</td>
                            <td className="px-4 py-2 text-sm text-right font-semibold text-gray-900">
                              {formatCurrency(pedido.total_pedido)}
                            </td>
                          </tr>
                          {pedido.itens.map((item) => (
                            <tr key={`${pedido.numeropi}-${item.itempedi}-${item.codiprod}`} className="border-b border-gray-50 hover:bg-gray-50/50">
                              <td className="px-4 py-2 text-sm">
                                <p className="text-gray-900">{item.descprod || item.codiprod}</p>
                                <p className="text-xs font-mono text-gray-400">{item.codiprod}</p>
                              </td>
                              <td className="px-3 py-2 text-xs font-mono text-gray-500">{item.codifabr || '-'}</td>
                              <td className="px-3 py-2 text-sm text-gray-600">{item.unidprod || '-'}</td>
                              <td className="px-3 py-2 text-sm text-right text-gray-700">{formatQtd(item.quantite)}</td>
                              <td className="px-3 py-2 text-sm text-right text-gray-700">{formatCurrency(item.unitario)}</td>
                              <td className="px-4 py-2 text-sm text-right text-gray-900">{formatCurrency(item.total)}</td>
                            </tr>
                          ))}
                        </Fragment>
                      ))}
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">{pagination.total ? `${pagination.total} pedidos` : ''}</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setFilters((prev) => ({ ...prev, page: prev.page - 1 }))}
                disabled={filters.page <= 1}
                className="btn-secondary py-1.5 px-2 text-xs disabled:opacity-40"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-xs text-gray-600">
                Página {pagination.page || 1} de {pagination.totalPages || 1}
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
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Por vendedor</h2>
          <div className="space-y-2">
            {(resumo?.por_vendedor || []).length === 0 ? (
              <p className="text-sm text-gray-400">Sem dados no período.</p>
            ) : (
              resumo.por_vendedor.map((row) => (
                <div key={`${row.codiloja}-${row.codivend}`} className="flex items-center justify-between gap-3 border-b border-gray-50 pb-2 last:border-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {row.codivend} - {row.nomevend || 'sem nome'}
                    </p>
                    <p className="text-xs text-gray-400">
                      <LojaLabel codiloja={row.codiloja} /> · {row.qtd_pedidos} pedidos · {formatQtd(row.qtd_itens)} itens
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-gray-900 whitespace-nowrap">{formatCurrency(row.total_vendas)}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
