import { useState, useEffect } from 'react';
import { fornecedoresApi } from '../lib/api';
import { formatCurrency } from '../lib/utils';
import {
  Search, RefreshCw, X, Check, ChevronLeft, ChevronRight,
  Pencil, Truck, Percent, HandCoins,
} from 'lucide-react';
import toast from 'react-hot-toast';

const TIPO_LABELS = {
  nenhum: 'Sem "por fora"',
  fator: 'Fator sobre a nota',
  valor_informado: 'Valor informado na hora',
};

function resumoRegra(f) {
  if (!f || f.complemento_tipo === 'nenhum') return null;
  const partes = [];
  if (f.complemento_tipo === 'fator') {
    const pct = (parseFloat(f.complemento_fator) || 0) * 100;
    const base = f.complemento_base === 'total_produtos' ? 'produtos' : 'NF';
    partes.push(`+${pct.toFixed(pct % 1 === 0 ? 0 : 2)}% sobre ${base === 'NF' ? 'a NF' : 'os produtos'}`);
  } else {
    partes.push('valor informado na hora');
  }
  if (f.complemento_vencimento === 'data_fixa') {
    partes.push(`${f.complemento_dias ?? '?'}d após a entrada`);
  } else {
    partes.push('junto com os boletos');
  }
  return partes.join(' · ');
}

// ============================================
// Modal de edição da regra do fornecedor
// ============================================
function RegraModal({ fornecedor, onClose, onSaved }) {
  const [form, setForm] = useState({
    complemento_tipo: 'nenhum',
    fator_pct: '',
    complemento_base: 'total_faturado',
    complemento_vencimento: 'junto_parcelas',
    complemento_dias: '',
    aliases: '',
    complemento_obs: '',
    ativo: true,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!fornecedor) return;
    setForm({
      complemento_tipo: fornecedor.complemento_tipo || 'nenhum',
      fator_pct: fornecedor.complemento_fator
        ? String((parseFloat(fornecedor.complemento_fator) * 100).toFixed(2)).replace(/\.?0+$/, '')
        : '',
      complemento_base: fornecedor.complemento_base || 'total_faturado',
      complemento_vencimento: fornecedor.complemento_vencimento || 'junto_parcelas',
      complemento_dias: fornecedor.complemento_dias ?? '',
      aliases: fornecedor.aliases || '',
      complemento_obs: fornecedor.complemento_obs || '',
      ativo: fornecedor.ativo !== false && fornecedor.ativo !== 0,
    });
  }, [fornecedor]);

  if (!fornecedor) return null;

  const temRegra = form.complemento_tipo !== 'nenhum';
  const exemploFator = () => {
    const pct = parseFloat(form.fator_pct);
    if (!pct || pct <= 0) return null;
    const exemplo = 1000 * (1 + pct / 100);
    return `Ex.: NF de R$ 1.000,00 → total a pagar R$ ${exemplo.toFixed(2).replace('.', ',')} (R$ ${(exemplo - 1000).toFixed(2).replace('.', ',')} por fora)`;
  };

  const handleSave = async () => {
    const payload = {
      complemento_tipo: form.complemento_tipo,
      complemento_base: form.complemento_base,
      complemento_vencimento: form.complemento_vencimento,
      complemento_dias: form.complemento_dias === '' ? null : parseInt(form.complemento_dias, 10),
      aliases: form.aliases.trim() || null,
      complemento_obs: form.complemento_obs.trim() || null,
      ativo: form.ativo,
    };
    if (form.complemento_tipo === 'fator') {
      const pct = parseFloat(String(form.fator_pct).replace(',', '.'));
      if (!pct || pct <= 0) {
        toast.error('Informe o percentual do "por fora" (ex.: 30 para +30%)');
        return;
      }
      payload.complemento_fator = pct / 100;
    }
    setSaving(true);
    try {
      await fornecedoresApi.update(fornecedor.id, payload);
      toast.success('Regra salva!');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao salvar regra');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="p-5 border-b border-gray-100 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Regra do fornecedor</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {fornecedor.nome}
              <span className="ml-2 font-mono text-xs text-gray-400">#{fornecedor.codiforn}</span>
            </p>
            {fornecedor.razao_social && (
              <p className="text-xs text-gray-400">{fornecedor.razao_social} · {fornecedor.cnpj_cpf || 'sem CNPJ'}</p>
            )}
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-gray-100 text-gray-400"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-5">
          {/* Tipo de regra */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Pagamento "por fora"</h3>
            <div className="space-y-2">
              {['nenhum', 'fator', 'valor_informado'].map((tipo) => (
                <label
                  key={tipo}
                  className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                    form.complemento_tipo === tipo ? 'border-brand-400 bg-brand-50/40' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="complemento_tipo"
                    checked={form.complemento_tipo === tipo}
                    onChange={() => setForm(f => ({ ...f, complemento_tipo: tipo }))}
                    className="mt-0.5 text-brand-600 focus:ring-brand-500"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-800">{TIPO_LABELS[tipo]}</p>
                    <p className="text-xs text-gray-500">
                      {tipo === 'nenhum' && 'A nota fiscal representa o total a pagar.'}
                      {tipo === 'fator' && 'Além dos boletos, paga-se um percentual fixo sobre cada entrada (depósito/PIX).'}
                      {tipo === 'valor_informado' && 'Tem "por fora", mas o valor só se conhece a cada compra — será informado na tela da entrada.'}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Fator */}
          {form.complemento_tipo === 'fator' && (
            <div className="rounded-xl border border-gray-200 p-4 bg-gray-50/50">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Percentual do "por fora" *</label>
                  <div className="relative">
                    <input
                      type="number" step="0.01" min="0"
                      value={form.fator_pct}
                      onChange={(e) => setForm(f => ({ ...f, fator_pct: e.target.value }))}
                      className="input-field pr-8 font-semibold"
                      placeholder="30"
                    />
                    <Percent size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Calculado sobre</label>
                  <select
                    value={form.complemento_base}
                    onChange={(e) => setForm(f => ({ ...f, complemento_base: e.target.value }))}
                    className="input-field"
                  >
                    <option value="total_faturado">Total da NF (faturado)</option>
                    <option value="total_produtos">Total dos produtos</option>
                  </select>
                </div>
              </div>
              {exemploFator() && (
                <p className="text-xs text-brand-700 mt-3 bg-brand-50 rounded-lg px-3 py-2">{exemploFator()}</p>
              )}
            </div>
          )}

          {/* Vencimento */}
          {temRegra && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Vencimento do "por fora"</h3>
              <p className="text-xs text-gray-400 mb-2">É só um guia — a data fica editável na conta gerada.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer ${form.complemento_vencimento === 'junto_parcelas' ? 'border-brand-400 bg-brand-50/40' : 'border-gray-200 hover:bg-gray-50'}`}>
                  <input
                    type="radio" name="venc"
                    checked={form.complemento_vencimento === 'junto_parcelas'}
                    onChange={() => setForm(f => ({ ...f, complemento_vencimento: 'junto_parcelas' }))}
                    className="text-brand-600 focus:ring-brand-500"
                  />
                  <span className="text-sm text-gray-700">Junto com os boletos</span>
                </label>
                <label className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer ${form.complemento_vencimento === 'data_fixa' ? 'border-brand-400 bg-brand-50/40' : 'border-gray-200 hover:bg-gray-50'}`}>
                  <input
                    type="radio" name="venc"
                    checked={form.complemento_vencimento === 'data_fixa'}
                    onChange={() => setForm(f => ({ ...f, complemento_vencimento: 'data_fixa' }))}
                    className="text-brand-600 focus:ring-brand-500"
                  />
                  <span className="text-sm text-gray-700 flex items-center gap-2">
                    <input
                      type="number" min="0" max="365"
                      value={form.complemento_dias}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setForm(f => ({ ...f, complemento_dias: e.target.value, complemento_vencimento: 'data_fixa' }))}
                      className="input-field w-16 py-1 text-center"
                      placeholder="30"
                    />
                    dias após a entrada
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* Aliases */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
              Nomes alternativos (p/ achar no extrato)
            </label>
            <textarea
              value={form.aliases}
              onChange={(e) => setForm(f => ({ ...f, aliases: e.target.value }))}
              className="input-field font-mono text-sm"
              rows={2}
              placeholder={'Um por linha. Ex.:\nVILLAGGIO\nV. DAS FLORES LTDA'}
            />
            <p className="text-[11px] text-gray-400 mt-1">Usado nas sugestões de conciliação de PIX/TED/depósito (F4).</p>
          </div>

          {/* Observações */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Observações da regra</label>
            <textarea
              value={form.complemento_obs}
              onChange={(e) => setForm(f => ({ ...f, complemento_obs: e.target.value }))}
              className="input-field text-sm"
              rows={2}
              placeholder="Ex.: deposita todo dia 10, junta as notas do mês anterior"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={form.ativo}
              onChange={(e) => setForm(f => ({ ...f, ativo: e.target.checked }))}
              className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            Fornecedor ativo no app
          </label>
        </div>

        <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? <RefreshCw size={16} className="animate-spin" /> : <Check size={16} />}
            Salvar regra
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Página
// ============================================
export default function FornecedoresPage() {
  const [data, setData] = useState([]);
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filters, setFilters] = useState({ q: '', com_regra: false, page: 1, perPage: 50 });

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = { page: filters.page, perPage: filters.perPage };
      if (filters.q) params.q = filters.q;
      if (filters.com_regra) params.com_regra = 'true';
      const res = await fornecedoresApi.list(params);
      setData(res.data.data);
      setPagination(res.data.pagination);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao carregar fornecedores');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [filters]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fornecedoresApi.sync();
      const s = res.data;
      toast.success(`Sync: ${s.inserted} novos, ${s.updated} atualizados, ${s.contas_vinculadas} contas vinculadas`, { duration: 5000 });
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao sincronizar com o ERP');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Fornecedores</h1>
          <p className="text-sm text-gray-500 mt-1">
            Espelho do cadastro do ERP + regras do "por fora". Dados-base vêm do ERP; aqui só se editam as regras.
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 transition-all disabled:opacity-50"
        >
          <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Sincronizando...' : 'Sincronizar ERP'}
        </button>
      </div>

      <div className="card p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Nome, código ou CNPJ..."
              value={filters.q}
              onChange={(e) => setFilters(f => ({ ...f, q: e.target.value, page: 1 }))}
              className="input-field pl-9 w-72"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.com_regra}
              onChange={(e) => setFilters(f => ({ ...f, com_regra: e.target.checked, page: 1 }))}
              className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            Só com regra de "por fora"
          </label>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="table-header px-3 py-3 text-left w-16">Cód.</th>
                <th className="table-header px-3 py-3 text-left">Fornecedor</th>
                <th className="table-header px-3 py-3 text-left">CNPJ/CPF</th>
                <th className="table-header px-3 py-3 text-left">Cidade</th>
                <th className="table-header px-3 py-3 text-right">Em aberto</th>
                <th className="table-header px-3 py-3 text-left">Regra "por fora"</th>
                <th className="table-header px-3 py-3 text-center w-20">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400"><RefreshCw size={20} className="animate-spin inline mr-2" />Carregando...</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                  Nenhum fornecedor. Clique em "Sincronizar ERP" para importar o cadastro.
                </td></tr>
              ) : (
                data.map((f) => {
                  const regra = resumoRegra(f);
                  const inativo = f.ativo === false || f.ativo === 0 || f.situacao_erp !== 'A';
                  return (
                    <tr key={f.id} className={`border-b border-gray-50 hover:bg-gray-50/50 transition-colors ${inativo ? 'opacity-50' : ''}`}>
                      <td className="px-3 py-3 text-sm font-mono text-gray-500">{f.codiforn}</td>
                      <td className="px-3 py-3 text-sm">
                        <p className="font-medium text-gray-900">{f.nome}</p>
                        {f.razao_social && f.razao_social !== f.nome && (
                          <p className="text-xs text-gray-400 truncate max-w-[260px]">{f.razao_social}</p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs font-mono text-gray-500">{f.cnpj_cpf || '—'}</td>
                      <td className="px-3 py-3 text-xs text-gray-500">
                        {f.cidade ? `${f.cidade}${f.uf ? `/${f.uf}` : ''}` : '—'}
                      </td>
                      <td className="px-3 py-3 text-sm text-right">
                        {f.contas_abertas > 0 ? (
                          <>
                            <p className="font-semibold text-amber-700">{formatCurrency(f.saldo_aberto)}</p>
                            <p className="text-[10px] text-gray-400">{f.contas_abertas} conta{f.contas_abertas > 1 ? 's' : ''}</p>
                          </>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-3">
                        {regra ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-violet-100 text-violet-700">
                            <HandCoins size={12} /> {regra}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <button
                          onClick={() => setEditing(f)}
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
                          title="Editar regra"
                        >
                          <Pencil size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
          <p className="text-xs text-gray-500">{pagination.total ? `${pagination.total} fornecedores` : ''}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))} disabled={filters.page <= 1} className="btn-secondary py-1.5 px-2 text-xs disabled:opacity-40"><ChevronLeft size={14} /></button>
            <span className="text-xs text-gray-600">Pág. {pagination.page || 1} de {pagination.totalPages || 1}</span>
            <button onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))} disabled={filters.page >= (pagination.totalPages || 1)} className="btn-secondary py-1.5 px-2 text-xs disabled:opacity-40"><ChevronRight size={14} /></button>
          </div>
        </div>
      </div>

      {editing && (
        <RegraModal
          fornecedor={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); fetchData(); }}
        />
      )}
    </div>
  );
}
