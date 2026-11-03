import { useState, useEffect } from 'react';
import {
  contasBancariasApi, fornecedorRegrasApi, conciliacaoApi, mpApi, bbApi, planoContasApi,
} from '../lib/api';
import { formatCurrency, formatDate } from '../lib/utils';
import {
  Plus, X, Pencil, Trash2, RefreshCw, Upload, Check,
  Landmark, Percent, FileText, Link2, Search,
} from 'lucide-react';
import toast from 'react-hot-toast';
import LojaSelect from '../components/LojaSelect';

function Tabs({ value, onChange, tabs }) {
  return (
    <div className="flex border-b border-gray-200 mb-4">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            value === t.value
              ? 'border-brand-600 text-brand-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          {t.icon && <t.icon size={15} />} {t.label}
        </button>
      ))}
    </div>
  );
}

// ============================================
// Contas bancárias
// ============================================
function ContaBancariaForm({ isOpen, onClose, onSave, editData }) {
  const [form, setForm] = useState({
    nome: '', banco_codigo: '', banco_nome: '', agencia: '', conta: '',
    tipo: 'corrente', codiloja: '', saldo_inicial: '', data_saldo_inicial: '',
    observacoes: '', ativo: true,
  });

  useEffect(() => {
    if (editData) {
      setForm({
        nome: editData.nome || '',
        banco_codigo: editData.banco_codigo || '',
        banco_nome: editData.banco_nome || '',
        agencia: editData.agencia || '',
        conta: editData.conta || '',
        tipo: editData.tipo || 'corrente',
        codiloja: editData.codiloja || '',
        saldo_inicial: editData.saldo_inicial ?? '',
        data_saldo_inicial: editData.data_saldo_inicial?.slice(0, 10) || '',
        observacoes: editData.observacoes || '',
        ativo: editData.ativo !== false,
      });
    } else {
      setForm({
        nome: '', banco_codigo: '', banco_nome: '', agencia: '', conta: '',
        tipo: 'corrente', codiloja: '', saldo_inicial: '', data_saldo_inicial: '',
        observacoes: '', ativo: true,
      });
    }
  }, [editData, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-bold">{editData ? 'Editar Conta Bancária' : 'Nova Conta Bancária'}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={20} /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSave(form); }} className="p-5 space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nome *</label>
            <input required value={form.nome} onChange={(e) => setForm(f => ({ ...f, nome: e.target.value }))}
              className="input-field" placeholder="Ex: Itaú Matriz" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Cód. Banco</label>
              <input value={form.banco_codigo} onChange={(e) => setForm(f => ({ ...f, banco_codigo: e.target.value }))}
                className="input-field" placeholder="341" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Banco</label>
              <input value={form.banco_nome} onChange={(e) => setForm(f => ({ ...f, banco_nome: e.target.value }))}
                className="input-field" placeholder="Itaú" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Agência</label>
              <input value={form.agencia} onChange={(e) => setForm(f => ({ ...f, agencia: e.target.value }))}
                className="input-field" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Conta</label>
              <input value={form.conta} onChange={(e) => setForm(f => ({ ...f, conta: e.target.value }))}
                className="input-field" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Tipo</label>
              <select value={form.tipo} onChange={(e) => setForm(f => ({ ...f, tipo: e.target.value }))}
                className="input-field">
                <option value="corrente">Corrente</option>
                <option value="poupanca">Poupança</option>
                <option value="aplicacao">Aplicação</option>
                <option value="caixa">Caixa</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Loja</label>
              <LojaSelect
                value={form.codiloja}
                onChange={(e) => setForm(f => ({ ...f, codiloja: e.target.value }))}
                className="input-field"
                includeAll={false}
                emptyLabel="—"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Saldo Inicial</label>
              <input type="number" step="0.01" value={form.saldo_inicial}
                onChange={(e) => setForm(f => ({ ...f, saldo_inicial: e.target.value }))}
                className="input-field text-right" placeholder="0,00" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Data do Saldo</label>
              <input type="date" value={form.data_saldo_inicial}
                onChange={(e) => setForm(f => ({ ...f, data_saldo_inicial: e.target.value }))}
                className="input-field" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Observações</label>
            <textarea rows={2} value={form.observacoes}
              onChange={(e) => setForm(f => ({ ...f, observacoes: e.target.value }))} className="input-field" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.ativo}
              onChange={(e) => setForm(f => ({ ...f, ativo: e.target.checked }))}
              className="rounded border-gray-300 text-brand-600" />
            Conta ativa
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" className="btn-primary">Salvar</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ContasBancariasTab() {
  const [contas, setContas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await contasBancariasApi.list();
      setContas(res.data.data || []);
    } catch { toast.error('Erro ao carregar contas bancárias'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async (data) => {
    try {
      if (editItem) await contasBancariasApi.update(editItem.id, data);
      else await contasBancariasApi.create(data);
      toast.success('Salvo');
      setShowForm(false); setEditItem(null); fetchData();
    } catch (err) { toast.error(err.response?.data?.error || 'Erro ao salvar'); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Inativar esta conta bancária?')) return;
    try { await contasBancariasApi.delete(id); toast.success('Inativada'); fetchData(); }
    catch { toast.error('Erro ao inativar'); }
  };

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-500">Cadastre as contas bancárias da empresa para vincular pagamentos e importar OFX.</p>
        <button onClick={() => { setEditItem(null); setShowForm(true); }} className="btn-primary">
          <Plus size={16} /> Nova Conta
        </button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="table-header px-3 py-3 text-left">Nome</th>
              <th className="table-header px-3 py-3 text-left">Banco</th>
              <th className="table-header px-3 py-3 text-left">Ag/Conta</th>
              <th className="table-header px-3 py-3 text-left">Tipo</th>
              <th className="table-header px-3 py-3 text-right">Saldo Inicial</th>
              <th className="table-header px-3 py-3 text-right">Saldo Estimado</th>
              <th className="table-header px-3 py-3 text-center">Status</th>
              <th className="table-header px-3 py-3 text-center">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                <RefreshCw size={18} className="animate-spin inline mr-2" /> Carregando...
              </td></tr>
            ) : contas.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                Nenhuma conta bancária cadastrada.
              </td></tr>
            ) : contas.map(c => (
              <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/30">
                <td className="px-3 py-3 font-medium">{c.nome}</td>
                <td className="px-3 py-3 text-sm">
                  {c.banco_codigo && <span className="font-mono text-gray-500 mr-1">{c.banco_codigo}</span>}
                  {c.banco_nome || '—'}
                </td>
                <td className="px-3 py-3 text-sm font-mono">{c.agencia || '—'}/{c.conta || '—'}</td>
                <td className="px-3 py-3 text-sm capitalize">{c.tipo}</td>
                <td className="px-3 py-3 text-sm text-right">{formatCurrency(c.saldo_inicial)}</td>
                <td className={`px-3 py-3 text-sm text-right font-semibold ${parseFloat(c.saldo_estimado) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {formatCurrency(c.saldo_estimado)}
                  {c.saldo_fonte === 'mercadopago' && (
                    <span className="block text-[10px] font-normal text-sky-600" title="Calculado pelo relatório oficial de dinheiro em conta do MercadoPago">
                      via relatório MP
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${c.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {c.ativo ? 'Ativa' : 'Inativa'}
                  </span>
                </td>
                <td className="px-3 py-3 text-center">
                  <button onClick={() => { setEditItem(c); setShowForm(true); }} className="p-1.5 rounded hover:bg-gray-100 text-gray-500">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => handleDelete(c.id)} className="p-1.5 rounded hover:bg-red-50 text-red-400">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ContaBancariaForm isOpen={showForm} onClose={() => { setShowForm(false); setEditItem(null); }} onSave={handleSave} editData={editItem} />
    </>
  );
}

// ============================================
// Regras de juros
// ============================================
function RegraForm({ isOpen, onClose, onSave, editData }) {
  const [form, setForm] = useState({
    fornecedor: '', cnpj: '', codiforn: '',
    multa_percentual: 2, juros_diario_percentual: 0.0333, carencia_dias: 0,
    ativo: true, observacoes: '',
  });

  useEffect(() => {
    if (editData) setForm({ ...editData });
    else setForm({ fornecedor: '', cnpj: '', codiforn: '', multa_percentual: 2,
      juros_diario_percentual: 0.0333, carencia_dias: 0, ativo: true, observacoes: '' });
  }, [editData, isOpen]);

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl">
        <div className="p-5 border-b flex justify-between">
          <h2 className="text-lg font-bold">{editData ? 'Editar Regra' : 'Nova Regra de Juros'}</h2>
          <button onClick={onClose}><X size={20} /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSave(form); }} className="p-5 space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Fornecedor (nome ou trecho do nome) *</label>
            <input required value={form.fornecedor} onChange={(e) => setForm(f => ({ ...f, fornecedor: e.target.value }))} className="input-field" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">CNPJ</label>
              <input value={form.cnpj || ''} onChange={(e) => setForm(f => ({ ...f, cnpj: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Cód. Fornecedor (ERP)</label>
              <input value={form.codiforn || ''} onChange={(e) => setForm(f => ({ ...f, codiforn: e.target.value }))} className="input-field" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Multa (%)</label>
              <input type="number" step="0.01" value={form.multa_percentual}
                onChange={(e) => setForm(f => ({ ...f, multa_percentual: e.target.value }))} className="input-field text-right" />
              <p className="text-[10px] text-gray-400 mt-1">2% é o padrão</p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Juros Diário (%)</label>
              <input type="number" step="0.0001" value={form.juros_diario_percentual}
                onChange={(e) => setForm(f => ({ ...f, juros_diario_percentual: e.target.value }))} className="input-field text-right" />
              <p className="text-[10px] text-gray-400 mt-1">0,0333 = 1% ao mês</p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Carência (dias)</label>
              <input type="number" value={form.carencia_dias}
                onChange={(e) => setForm(f => ({ ...f, carencia_dias: e.target.value }))} className="input-field text-right" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Observações</label>
            <textarea rows={2} value={form.observacoes || ''}
              onChange={(e) => setForm(f => ({ ...f, observacoes: e.target.value }))} className="input-field" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.ativo !== false}
              onChange={(e) => setForm(f => ({ ...f, ativo: e.target.checked }))}
              className="rounded border-gray-300" /> Regra ativa
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" className="btn-primary">Salvar</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RegrasJurosTab() {
  const [regras, setRegras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [search, setSearch] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fornecedorRegrasApi.list({ search: search || undefined });
      setRegras(res.data.data || []);
    } catch { toast.error('Erro ao carregar regras'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [search]);

  const handleSave = async (data) => {
    try {
      if (editItem) await fornecedorRegrasApi.update(editItem.id, data);
      else await fornecedorRegrasApi.create(data);
      toast.success('Salvo');
      setShowForm(false); setEditItem(null); fetchData();
    } catch (err) { toast.error(err.response?.data?.error || 'Erro'); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Remover regra?')) return;
    try { await fornecedorRegrasApi.delete(id); toast.success('Removida'); fetchData(); }
    catch { toast.error('Erro'); }
  };

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <div className="flex-1 max-w-md">
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por fornecedor, CNPJ ou código..."
            className="input-field" />
        </div>
        <button onClick={() => { setEditItem(null); setShowForm(true); }} className="btn-primary ml-3">
          <Plus size={16} /> Nova Regra
        </button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="table-header px-3 py-3 text-left">Fornecedor</th>
              <th className="table-header px-3 py-3 text-left">CNPJ</th>
              <th className="table-header px-3 py-3 text-center">Multa</th>
              <th className="table-header px-3 py-3 text-center">Juros/dia</th>
              <th className="table-header px-3 py-3 text-center">Carência</th>
              <th className="table-header px-3 py-3 text-center">Status</th>
              <th className="table-header px-3 py-3 text-center">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                <RefreshCw size={18} className="animate-spin inline mr-2" />Carregando...
              </td></tr>
            ) : regras.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                Nenhuma regra cadastrada. Adicione regras para que o sistema calcule juros/multa automaticamente quando o pagamento atrasar.
              </td></tr>
            ) : regras.map(r => (
              <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/30">
                <td className="px-3 py-3 font-medium">{r.fornecedor}</td>
                <td className="px-3 py-3 text-sm font-mono text-gray-500">{r.cnpj || '—'}</td>
                <td className="px-3 py-3 text-center text-sm">{r.multa_percentual}%</td>
                <td className="px-3 py-3 text-center text-sm">{r.juros_diario_percentual}%</td>
                <td className="px-3 py-3 text-center text-sm">{r.carencia_dias} dias</td>
                <td className="px-3 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${r.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100'}`}>
                    {r.ativo ? 'Ativa' : 'Inativa'}
                  </span>
                </td>
                <td className="px-3 py-3 text-center">
                  <button onClick={() => { setEditItem(r); setShowForm(true); }} className="p-1.5 rounded hover:bg-gray-100"><Pencil size={14} /></button>
                  <button onClick={() => handleDelete(r.id)} className="p-1.5 rounded hover:bg-red-50 text-red-400"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <RegraForm isOpen={showForm} onClose={() => { setShowForm(false); setEditItem(null); }} onSave={handleSave} editData={editItem} />
    </>
  );
}

// ============================================
// Conciliação OFX
// ============================================
const NATUREZAS = [
  { value: 'despesa_geral', label: 'Despesa geral' },
  { value: 'mercadoria', label: 'Mercadoria' },
  { value: 'nao_classificada', label: 'Não classificada' },
];

// Chuta o fornecedor a partir da descrição do extrato (o banco emissor de
// boleto não é fornecedor; transferências costumam trazer o favorecido).
function guessFornecedor(descricao) {
  if (!descricao) return '';
  const d = descricao.replace(/\s*\[banco \d{3}\]\s*/g, ' ').trim();
  const transf = d.match(/^Transferência:\s*(.+)$/i);
  if (transf) return transf[1].trim().slice(0, 60);
  if (/^(Boleto\s|Depósito|Pagamento$)/i.test(d)) return '';
  return d.slice(0, 60);
}

function ConciliarModal({ extrato, onClose, onDone }) {
  const [tab, setTab] = useState('vincular');
  const [salvando, setSalvando] = useState(false);

  // --- vincular ---
  const [sugestoes, setSugestoes] = useState([]);
  const [loadingSug, setLoadingSug] = useState(true);
  const [search, setSearch] = useState('');
  const [buscou, setBuscou] = useState(false);
  const [selecionada, setSelecionada] = useState(null);
  const [decomp, setDecomp] = useState({ valor_juros: 0, valor_multa: 0, valor_desconto: 0 });

  // --- criar ---
  const [form, setForm] = useState({
    fornecedor: guessFornecedor(extrato.descricao),
    descricao: extrato.descricao || '',
    natureza: 'despesa_geral',
    plano_conta_id: '',
    codiloja: '',
    observacoes: '',
  });
  const [planoContas, setPlanoContas] = useState([]);

  const fetchSugestoes = async (termo) => {
    setLoadingSug(true);
    setSelecionada(null);
    try {
      const res = await conciliacaoApi.sugestoes(extrato.id, termo ? { search: termo } : undefined);
      setSugestoes(res.data.sugestoes || []);
      setBuscou(Boolean(termo));
    } catch { toast.error('Erro ao buscar sugestões'); }
    finally { setLoadingSug(false); }
  };

  useEffect(() => { fetchSugestoes(); }, [extrato.id]);

  useEffect(() => {
    const params = { pagareci: 'P', ativo: 'true', analitica: 'true', limit: 800 };
    if (form.codiloja) params.codiloja = form.codiloja;
    planoContasApi.list(params)
      .then((r) => setPlanoContas(r.data || []))
      .catch(() => setPlanoContas([]));
  }, [form.codiloja]);

  const selecionar = (c) => {
    setSelecionada(c);
    const s = c.sugestao_decomposicao || {};
    setDecomp({
      valor_juros: s.valor_juros || 0,
      valor_multa: s.valor_multa || 0,
      valor_desconto: s.valor_desconto || 0,
    });
  };

  const valorExtrato = parseFloat(extrato.valor) || 0;
  const num = (v) => parseFloat(v) || 0;
  const principal = valorExtrato - num(decomp.valor_juros) - num(decomp.valor_multa) + num(decomp.valor_desconto);
  const saldoSel = selecionada ? parseFloat(selecionada.saldo_aberto) || 0 : 0;
  const diferencaOk = selecionada ? Math.abs(principal - saldoSel) < 0.05 : false;

  const handleVincular = async () => {
    if (!selecionada) return;
    setSalvando(true);
    try {
      await conciliacaoApi.conciliar(extrato.id, {
        conta_pagar_id: selecionada.id,
        valor_juros: num(decomp.valor_juros),
        valor_multa: num(decomp.valor_multa),
        valor_desconto: num(decomp.valor_desconto),
      });
      toast.success(`Conciliado com ${selecionada.fornecedor}`);
      onDone();
    } catch (err) { toast.error(err.response?.data?.error || 'Erro ao conciliar'); }
    finally { setSalvando(false); }
  };

  const handleCriar = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      await conciliacaoApi.criarConta(extrato.id, {
        fornecedor: form.fornecedor,
        descricao: form.descricao || null,
        natureza: form.natureza,
        plano_conta_id: form.plano_conta_id || null,
        codiloja: form.codiloja || null,
        observacoes: form.observacoes || null,
      });
      toast.success('Conta a pagar criada e baixada');
      onDone();
    } catch (err) { toast.error(err.response?.data?.error || 'Erro ao criar conta'); }
    finally { setSalvando(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Conciliar lançamento</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {formatDate(extrato.data_transacao)} · <span className="font-semibold text-red-600">{formatCurrency(extrato.valor)}</span> · {extrato.descricao || '—'}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={20} /></button>
        </div>

        <div className="flex border-b border-gray-100 px-5">
          <button onClick={() => setTab('vincular')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 ${tab === 'vincular' ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500'}`}>
            <Link2 size={14} className="inline mr-1" /> Vincular a conta existente
          </button>
          <button onClick={() => setTab('criar')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 ${tab === 'criar' ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500'}`}>
            <Plus size={14} className="inline mr-1" /> Criar conta a pagar
          </button>
        </div>

        {tab === 'vincular' && (
          <div className="p-5 space-y-4">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); fetchSugestoes(search); }}>
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por fornecedor ou descrição..." className="input-field flex-1" />
              <button type="submit" className="btn-secondary"><Search size={15} /> Buscar</button>
              {buscou && (
                <button type="button" className="btn-secondary" onClick={() => { setSearch(''); fetchSugestoes(); }}>
                  Sugestões
                </button>
              )}
            </form>

            {loadingSug ? (
              <p className="text-sm text-gray-400 py-6 text-center">
                <RefreshCw size={15} className="animate-spin inline mr-2" />Buscando candidatas...
              </p>
            ) : sugestoes.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">
                Nenhuma conta candidata{buscou ? ' para essa busca' : ' com valor próximo'}.
                Use a busca acima ou crie a conta na outra aba.
              </p>
            ) : (
              <div className="divide-y divide-gray-50 border border-gray-100 rounded-lg max-h-64 overflow-y-auto">
                {sugestoes.map((c) => (
                  <label key={c.id}
                    className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 ${selecionada?.id === c.id ? 'bg-brand-50/60' : ''}`}>
                    <input type="radio" name="conta" checked={selecionada?.id === c.id}
                      onChange={() => selecionar(c)} className="text-brand-600" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {c.banco_match && <span title="Boleto do mesmo banco">⭐ </span>}{c.fornecedor}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        venc {formatDate(c.data_vencimento)}{c.dda_banco ? ` · ${c.dda_banco}` : ''}{c.descricao ? ` · ${c.descricao}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">{formatCurrency(c.saldo_aberto)}</p>
                      {Math.abs(c.diferenca) >= 0.01 && (
                        <p className={`text-xs ${c.diferenca > 0 ? 'text-amber-600' : 'text-sky-600'}`}>
                          {c.diferenca > 0 ? `+${formatCurrency(c.diferenca)} pago a mais` : `${formatCurrency(c.diferenca)} pago a menos`}
                        </p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}

            {selecionada && (
              <div className="border border-gray-100 rounded-lg p-4 bg-gray-50/50 space-y-3">
                <p className="text-xs font-semibold text-gray-600 uppercase">Composição do pagamento</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Juros</label>
                    <input type="number" step="0.01" min="0" value={decomp.valor_juros}
                      onChange={(e) => setDecomp((d) => ({ ...d, valor_juros: e.target.value }))}
                      className="input-field text-right" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Multa</label>
                    <input type="number" step="0.01" min="0" value={decomp.valor_multa}
                      onChange={(e) => setDecomp((d) => ({ ...d, valor_multa: e.target.value }))}
                      className="input-field text-right" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Desconto</label>
                    <input type="number" step="0.01" min="0" value={decomp.valor_desconto}
                      onChange={(e) => setDecomp((d) => ({ ...d, valor_desconto: e.target.value }))}
                      className="input-field text-right" />
                  </div>
                </div>
                <p className={`text-xs ${diferencaOk ? 'text-emerald-600' : 'text-amber-600'}`}>
                  Pago {formatCurrency(valorExtrato)} − juros/multa + desconto = {formatCurrency(principal)} de principal,
                  contra {formatCurrency(saldoSel)} em aberto.
                  {diferencaOk ? ' Conta será quitada.' : ' Diferença ficará como pagamento parcial/saldo.'}
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
              <button type="button" onClick={handleVincular} disabled={!selecionada || salvando} className="btn-primary disabled:opacity-50">
                <Check size={15} /> {salvando ? 'Conciliando...' : 'Conciliar'}
              </button>
            </div>
          </div>
        )}

        {tab === 'criar' && (
          <form onSubmit={handleCriar} className="p-5 space-y-3">
            <p className="text-xs text-gray-500">
              A conta nasce com vencimento {formatDate(extrato.data_transacao)} e valor {formatCurrency(extrato.valor)},
              já paga e conciliada com este lançamento.
            </p>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Fornecedor *</label>
              <input required value={form.fornecedor}
                onChange={(e) => setForm((f) => ({ ...f, fornecedor: e.target.value }))}
                className="input-field" placeholder="Ex: Lalamove" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Descrição</label>
              <input value={form.descricao}
                onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
                className="input-field" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Loja</label>
                <LojaSelect value={form.codiloja}
                  onChange={(e) => setForm((f) => ({ ...f, codiloja: e.target.value, plano_conta_id: '' }))}
                  className="input-field" includeAll={false} emptyLabel="—" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Natureza</label>
                <select value={form.natureza}
                  onChange={(e) => setForm((f) => ({ ...f, natureza: e.target.value }))}
                  className="input-field">
                  {NATUREZAS.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Plano de contas</label>
              <select value={form.plano_conta_id}
                onChange={(e) => setForm((f) => ({ ...f, plano_conta_id: e.target.value }))}
                className="input-field">
                <option value="">—</option>
                {planoContas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {(p.label || `${p.codigo_erp || ''} - ${p.descricao || ''}`) + (p.codiloja ? ` [Loja ${p.codiloja}]` : '')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Observações</label>
              <textarea rows={2} value={form.observacoes}
                onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))}
                className="input-field" />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
              <button type="submit" disabled={salvando} className="btn-primary disabled:opacity-50">
                <Check size={15} /> {salvando ? 'Criando...' : 'Criar e conciliar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function ConciliacaoTab() {
  const [contas, setContas] = useState([]);
  const [contaId, setContaId] = useState('');
  const [extratos, setExtratos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('pendente');
  const [uploading, setUploading] = useState(false);
  const [syncingMp, setSyncingMp] = useState(false);
  const [syncingBb, setSyncingBb] = useState(false);
  const [bbConfigurado, setBbConfigurado] = useState(false);
  const [conciliarExtrato, setConciliarExtrato] = useState(null);

  const fetchContas = (preferId) => {
    contasBancariasApi.list({ ativo: true }).then(r => {
      const lista = r.data.data || [];
      setContas(lista);
      if (preferId && lista.some(c => c.id === preferId)) setContaId(preferId);
      else if (!contaId && lista.length > 0) setContaId(lista[0].id);
    });
  };

  useEffect(() => {
    fetchContas();
    bbApi.status().then((r) => setBbConfigurado(Boolean(r.data?.configurado))).catch(() => {});
  }, []);

  const fetchExtratos = async () => {
    if (!contaId) return;
    setLoading(true);
    try {
      const res = await conciliacaoApi.extratos({ conta_bancaria_id: contaId, status });
      setExtratos(res.data.data || []);
    } catch { toast.error('Erro ao carregar extratos'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchExtratos(); }, [contaId, status]);

  const handleOfxUpload = async (file) => {
    if (!file || !contaId) return;
    setUploading(true);
    try {
      const res = await conciliacaoApi.importarOfx(contaId, file);
      toast.success(`${res.data.inserted} lançamentos importados (${res.data.duplicated} já existiam)`);
      fetchExtratos();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao importar OFX');
    } finally { setUploading(false); }
  };

  const handleConciliarDone = () => {
    setConciliarExtrato(null);
    fetchExtratos();
  };

  const handleSyncBb = async () => {
    setSyncingBb(true);
    try {
      const res = await bbApi.sync({ dias: 30 });
      const r = res.data;
      toast.success(`Banco do Brasil: ${r.inserted} novos (${r.duplicated} já existiam)`, { duration: 6000 });
      fetchContas(r.conta_bancaria_id);
      fetchExtratos();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao sincronizar Banco do Brasil', { duration: 8000 });
    } finally { setSyncingBb(false); }
  };

  const handleIgnorar = async (extratoId) => {
    if (!confirm('Ignorar este lançamento?')) return;
    await conciliacaoApi.ignorar(extratoId);
    toast.success('Ignorado');
    fetchExtratos();
  };

  const handleSyncMp = async () => {
    setSyncingMp(true);
    try {
      const res = await mpApi.sync({ dias: 60 });
      const { resultados = [], erros = [], auto } = res.data;
      for (const r of resultados) {
        toast.success(`${r.label}: ${r.inserted} novos (${r.duplicated} já existiam)`, { duration: 6000 });
      }
      for (const e of erros) {
        toast.error(`${e.label}: ${e.error}`, { duration: 8000 });
      }
      if (auto?.dda_pagos?.length > 0) {
        toast.success(
          `${auto.dda_pagos.length} boleto(s) DDA marcados como pagos: ${auto.dda_pagos.map(d => d.cedente).slice(0, 3).join(', ')}${auto.dda_pagos.length > 3 ? '…' : ''}`,
          { duration: 9000, icon: '⚡' }
        );
      }
      if (auto?.baixados?.length > 0) {
        toast.success(
          `${auto.baixados.length} baixa(s) automática(s) em contas a pagar: ${auto.baixados.map(b => b.fornecedor).slice(0, 3).join(', ')}${auto.baixados.length > 3 ? '…' : ''}`,
          { duration: 9000, icon: '⚡' }
        );
      }
      const primeira = resultados[0];
      fetchContas(primeira?.conta_bancaria_id);
      fetchExtratos();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao sincronizar MercadoPago');
    } finally { setSyncingMp(false); }
  };

  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <select value={contaId} onChange={(e) => setContaId(e.target.value)} className="input-field w-64">
          <option value="">Selecione a conta bancária</option>
          {contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="input-field w-40">
          <option value="pendente">Pendentes</option>
          <option value="conciliado">Conciliados</option>
          <option value="ignorado">Ignorados</option>
          <option value="">Todos</option>
        </select>
        <label className={`btn-primary cursor-pointer ${uploading ? 'opacity-50' : ''}`}>
          <Upload size={16} /> {uploading ? 'Enviando...' : 'Importar OFX'}
          <input type="file" accept=".ofx,.OFX" className="hidden"
            onChange={(e) => handleOfxUpload(e.target.files?.[0])} disabled={uploading || !contaId} />
        </label>
        <button onClick={handleSyncMp} disabled={syncingMp}
          className={`btn-secondary ${syncingMp ? 'opacity-50' : ''}`}>
          <RefreshCw size={16} className={syncingMp ? 'animate-spin' : ''} />
          {syncingMp ? 'Sincronizando...' : 'Sincronizar MercadoPago'}
        </button>
        {bbConfigurado && (
          <button onClick={handleSyncBb} disabled={syncingBb}
            className={`btn-secondary ${syncingBb ? 'opacity-50' : ''}`}>
            <RefreshCw size={16} className={syncingBb ? 'animate-spin' : ''} />
            {syncingBb ? 'Sincronizando...' : 'Sincronizar BB'}
          </button>
        )}
      </div>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="table-header px-3 py-3 text-left">Data</th>
              <th className="table-header px-3 py-3 text-left">Descrição</th>
              <th className="table-header px-3 py-3 text-left">Documento</th>
              <th className="table-header px-3 py-3 text-center">Tipo</th>
              <th className="table-header px-3 py-3 text-right">Valor</th>
              <th className="table-header px-3 py-3 text-center">Status</th>
              <th className="table-header px-3 py-3 text-center">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center">
                <RefreshCw className="animate-spin inline mr-2" size={18} /> Carregando...
              </td></tr>
            ) : extratos.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                {!contaId ? 'Selecione uma conta bancária.' : 'Nenhum lançamento.'}
              </td></tr>
            ) : extratos.map(e => (
              <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50/30">
                <td className="px-3 py-3 text-sm">{formatDate(e.data_transacao)}</td>
                <td className="px-3 py-3 text-sm">{e.descricao}</td>
                <td className="px-3 py-3 text-sm font-mono text-gray-500">{e.documento || '—'}</td>
                <td className="px-3 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${e.tipo === 'debito' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {e.tipo}
                  </span>
                </td>
                <td className={`px-3 py-3 text-right font-semibold ${e.tipo === 'debito' ? 'text-red-600' : 'text-emerald-600'}`}>
                  {formatCurrency(e.valor)}
                </td>
                <td className="px-3 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${
                    e.status === 'conciliado' ? 'bg-emerald-100 text-emerald-700' :
                    e.status === 'ignorado' ? 'bg-gray-100 text-gray-500' :
                    'bg-amber-100 text-amber-700'
                  }`}>{e.status}</span>
                </td>
                <td className="px-3 py-3 text-center">
                  {e.status === 'pendente' && e.tipo === 'debito' && (
                    <>
                      <button onClick={() => setConciliarExtrato(e)}
                        className="px-2 py-1 rounded text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 mr-1">
                        <Link2 size={12} className="inline" /> Conciliar
                      </button>
                      <button onClick={() => handleIgnorar(e.id)}
                        className="px-2 py-1 rounded text-xs text-gray-600 bg-gray-100 hover:bg-gray-200">
                        Ignorar
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {conciliarExtrato && (
        <ConciliarModal
          extrato={conciliarExtrato}
          onClose={() => setConciliarExtrato(null)}
          onDone={handleConciliarDone}
        />
      )}
    </>
  );
}

// ============================================
// Página principal com abas
// ============================================
export default function ConfigBancariaPage() {
  const [tab, setTab] = useState('contas');

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Banco & Conciliação</h1>
        <p className="text-sm text-gray-500 mt-1">
          Contas bancárias, regras automáticas de juros/multa e conciliação via OFX.
        </p>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'contas', label: 'Contas Bancárias', icon: Landmark },
          { value: 'regras', label: 'Regras de Juros', icon: Percent },
          { value: 'conciliacao', label: 'Conciliação OFX', icon: FileText },
        ]}
      />

      {tab === 'contas' && <ContasBancariasTab />}
      {tab === 'regras' && <RegrasJurosTab />}
      {tab === 'conciliacao' && <ConciliacaoTab />}
    </div>
  );
}
