import { useState, useEffect } from 'react';
import { pagameApi } from '../lib/api';
import {
  formatCurrency, formatDate, formatDateRelative,
  inferStatus, getStatusLabel, getStatusBadge, getDefaultDateRange,
} from '../lib/utils';
import {
  Search, ChevronLeft, ChevronRight, RefreshCw,
} from 'lucide-react';
import LojaSelect from '../components/LojaSelect';
import LojaLabel from '../components/LojaLabel';

export default function PagamePage() {
  const [data, setData] = useState([]);
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const [filters, setFilters] = useState({
    codiloja: '',
    status: '',
    fornecedor: '',
    ...getDefaultDateRange(),
    page: 1,
    perPage: 30,
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = { ...filters };
      Object.keys(params).forEach(k => { if (params[k] === '') delete params[k]; });
      const res = await pagameApi.list(params);
      setData(res.data.data);
      setPagination(res.data.pagination);
    } catch (err) {
      console.error('Erro ao carregar PAGAME:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [filters]);

  const updateFilter = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value, page: 1 }));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Contas a Pagar (ERP)</h1>
          <p className="text-sm text-gray-500 mt-1">Dados da tabela PAGAME — somente leitura</p>
        </div>
        <button onClick={fetchData} className="btn-secondary">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <LojaSelect
            value={filters.codiloja}
            onChange={(e) => updateFilter('codiloja', e.target.value)}
            className="input-field w-36"
          />

          <select
            value={filters.status}
            onChange={(e) => updateFilter('status', e.target.value)}
            className="input-field w-36"
          >
            <option value="">Todos status</option>
            <option value="pendente">Pendente</option>
            <option value="vencido">Vencido</option>
            <option value="pago">Pago</option>
          </select>

          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Fornecedor (nome ou código)..."
              value={filters.fornecedor}
              onChange={(e) => updateFilter('fornecedor', e.target.value)}
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
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="table-header px-4 py-3 text-left">Loja</th>
                <th className="table-header px-4 py-3 text-left">Lançamento</th>
                <th className="table-header px-4 py-3 text-left">Documento</th>
                <th className="table-header px-4 py-3 text-left">Fornecedor</th>
                <th className="table-header px-4 py-3 text-left">Histórico</th>
                <th className="table-header px-4 py-3 text-left">Emissão</th>
                <th className="table-header px-4 py-3 text-left">Vencimento</th>
                <th className="table-header px-4 py-3 text-right">Valor</th>
                <th className="table-header px-4 py-3 text-center">Status</th>
                <th className="table-header px-4 py-3 text-left">Baixa</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-gray-400">
                    <RefreshCw size={20} className="animate-spin inline mr-2" />
                    Carregando...
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-gray-400">
                    Nenhum registro encontrado
                  </td>
                </tr>
              ) : (
                data.map((row, idx) => {
                  const status = inferStatus(row.datavenc, row.databaix);
                  return (
                    <tr
                      key={`${row.lancamen}-${idx}`}
                      className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors cursor-pointer"
                      onClick={() => setSelected(selected?.lancamen === row.lancamen ? null : row)}
                    >
                      <td className="px-4 py-3 text-sm text-gray-500">
                        <LojaLabel codiloja={row.codiloja} />
                      </td>
                      <td className="px-4 py-3 text-sm font-mono font-medium text-gray-900">{row.lancamen}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{row.document || '—'}</td>
                      <td className="px-4 py-3 text-sm">
                        <p className="text-gray-900 font-medium truncate max-w-[200px]">{row.nomeforn || 'Sem nome'}</p>
                        <p className="text-xs text-gray-400 font-mono">{row.fornclie || '—'}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 max-w-[200px] truncate" title={row.historic}>
                        {row.historic || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{formatDate(row.dataemis)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 font-medium">
                        {formatDate(row.datavenc)}
                        <br />
                        <span className="text-xs text-gray-400">{formatDateRelative(row.datavenc)}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900">
                        {formatCurrency(row.valorent)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(status)}`}>
                          {getStatusLabel(status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {row.databaix ? formatDate(row.databaix) : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
          <p className="text-xs text-gray-500">{pagination.total ? `${pagination.total} registros` : ''}</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFilters(prev => ({ ...prev, page: prev.page - 1 }))}
              disabled={filters.page <= 1}
              className="btn-secondary py-1.5 px-2 text-xs disabled:opacity-40"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs text-gray-600">
              Página {pagination.page || 1} de {pagination.totalPages || 1}
            </span>
            <button
              onClick={() => setFilters(prev => ({ ...prev, page: prev.page + 1 }))}
              disabled={filters.page >= (pagination.totalPages || 1)}
              className="btn-secondary py-1.5 px-2 text-xs disabled:opacity-40"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Detail Panel */}
      {selected && (
        <div className="card p-5 mt-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Detalhe — Lançamento {selected.lancamen}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><span className="text-gray-400 block">Empresa</span>{selected.codiempr}</div>
            <div><span className="text-gray-400 block">Loja</span><LojaLabel codiloja={selected.codiloja} /></div>
            <div>
              <span className="text-gray-400 block">Fornecedor</span>
              {selected.nomeforn || '—'}
              <span className="text-xs text-gray-400 font-mono ml-1">({selected.fornclie})</span>
            </div>
            <div><span className="text-gray-400 block">Referência</span>{selected.referenc || '—'}</div>
            <div><span className="text-gray-400 block">Valor Entrada</span>{formatCurrency(selected.valorent)}</div>
            <div><span className="text-gray-400 block">Valor Desconto</span>{formatCurrency(selected.valordes)}</div>
            <div><span className="text-gray-400 block">Valor Juros</span>{formatCurrency(selected.valorjur)}</div>
            <div><span className="text-gray-400 block">Banco</span>{selected.codbanco || '—'}</div>
            <div><span className="text-gray-400 block">Num. Conta</span>{selected.numconta || '—'}</div>
            <div><span className="text-gray-400 block">Banco Baixa</span>{selected.banbaixa || '—'}</div>
            <div><span className="text-gray-400 block">Doc. Baixa</span>{selected.docbaixa || '—'}</div>
            <div><span className="text-gray-400 block">Liberado</span>{selected.liberado || '—'}</div>
            <div className="col-span-2 md:col-span-4">
              <span className="text-gray-400 block">Observações</span>
              {selected.observac || 'Nenhuma'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
