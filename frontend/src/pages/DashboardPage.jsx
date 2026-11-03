import { useState, useEffect } from 'react';
import { dashboardApi } from '../lib/api';
import { formatCurrency, formatDate, getDefaultDateRange } from '../lib/utils';
import {
  AlertTriangle, CheckCircle2, Package, Calendar, RefreshCw,
} from 'lucide-react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area,
} from 'recharts';
import LojaSelect from '../components/LojaSelect';

function StatCard({ icon: Icon, label, value, subtitle, color = 'brand' }) {
  const colorMap = {
    brand: 'bg-brand-50 text-brand-600',
    red: 'bg-red-50 text-red-600',
    amber: 'bg-amber-50 text-amber-600',
    green: 'bg-emerald-50 text-emerald-600',
  };

  return (
    <div className="card p-5">
      <div className={`p-2 rounded-lg ${colorMap[color]} w-fit`}>
        <Icon size={20} />
      </div>
      <div className="mt-3">
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-sm text-gray-500 mt-0.5">{label}</p>
        {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
      </div>
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 text-white px-3 py-2 rounded-lg text-xs shadow-lg">
      <p className="font-medium">{formatDate(label)}</p>
      <p className="text-brand-300 mt-1">{formatCurrency(payload[0].value)}</p>
      {payload[0].payload.qtd && (
        <p className="text-gray-400">{payload[0].payload.qtd} títulos</p>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const [overview, setOverview] = useState(null);
  const [fluxo, setFluxo] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loja, setLoja] = useState('');
  const [dateRange, setDateRange] = useState(getDefaultDateRange);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = {
        codiloja: loja || undefined,
        ...dateRange,
      };

      const [overviewRes, fluxoRes] = await Promise.all([
        dashboardApi.overview(params),
        dashboardApi.fluxoCaixa(params),
      ]);

      setOverview(overviewRes.data);
      setFluxo(fluxoRes.data);
    } catch (err) {
      console.error('Erro ao carregar dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [loja, dateRange]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Visão geral financeira</p>
        </div>
        <div className="flex items-center gap-3">
          <LojaSelect
            value={loja}
            onChange={(e) => setLoja(e.target.value)}
            className="input-field w-36 text-sm"
          />

          <input
            type="date"
            value={dateRange.dataInicio}
            onChange={(e) => setDateRange(prev => ({ ...prev, dataInicio: e.target.value }))}
            className="input-field w-40 text-sm"
          />
          <span className="text-gray-400 text-sm">até</span>
          <input
            type="date"
            value={dateRange.dataFim}
            onChange={(e) => setDateRange(prev => ({ ...prev, dataFim: e.target.value }))}
            className="input-field w-40 text-sm"
          />

          <button onClick={fetchData} className="btn-secondary" title="Atualizar">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading && !overview ? (
        <div className="flex items-center justify-center h-64">
          <RefreshCw size={24} className="animate-spin text-brand-500" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard
              icon={AlertTriangle}
              label="Vencido"
              value={formatCurrency(overview?.contasPagar?.vencido?.total)}
              subtitle={`${overview?.contasPagar?.vencido?.qtd || 0} títulos`}
              color="red"
            />
            <StatCard
              icon={Calendar}
              label="A Vencer"
              value={formatCurrency(overview?.contasPagar?.pendente?.total)}
              subtitle={`${overview?.contasPagar?.pendente?.qtd || 0} títulos`}
              color="amber"
            />
            <StatCard
              icon={CheckCircle2}
              label="Pago"
              value={formatCurrency(overview?.contasPagar?.pago?.total)}
              subtitle={`${overview?.contasPagar?.pago?.qtd || 0} títulos`}
              color="green"
            />
            <StatCard
              icon={Package}
              label="Entradas (NF)"
              value={formatCurrency(overview?.entradas?.totalFaturado)}
              subtitle={`${overview?.entradas?.qtdEntradas || 0} notas`}
              color="brand"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            <div className="card p-5 lg:col-span-2">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">
                Fluxo de Caixa — Saídas por Dia
              </h3>
              {fluxo.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={fluxo}>
                    <defs>
                      <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis
                      dataKey="datavenc"
                      tickFormatter={(v) => formatDate(v, 'DD/MM')}
                      tick={{ fontSize: 11, fill: '#94a3b8' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
                      tick={{ fontSize: 11, fill: '#94a3b8' }}
                      axisLine={false}
                      tickLine={false}
                      width={60}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="total"
                      stroke="#6366f1"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorTotal)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-gray-400 text-sm">
                  Nenhum dado de fluxo para o período
                </div>
              )}
            </div>

            {/* Top Fornecedores - agora com nome */}
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">
                Top Fornecedores
              </h3>
              <div className="space-y-3">
                {overview?.topFornecedores?.map((f, i) => (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-600 text-xs font-bold flex items-center justify-center flex-shrink-0">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm text-gray-700 font-medium truncate">
                          {f.nomeforn || 'Sem nome'}
                        </p>
                        <p className="text-xs text-gray-400 font-mono">
                          {f.fornclie || '—'}
                        </p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-semibold text-gray-900">
                        {formatCurrency(f.total)}
                      </p>
                      <p className="text-xs text-gray-400">{f.qtd} lanç.</p>
                    </div>
                  </div>
                ))}
                {(!overview?.topFornecedores || overview.topFornecedores.length === 0) && (
                  <p className="text-sm text-gray-400 text-center py-6">Sem dados</p>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
