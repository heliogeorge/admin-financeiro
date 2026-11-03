import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { comprasApi } from '../lib/api';
import { formatCurrency, formatDate } from '../lib/utils';
import {
  AlertTriangle, Ban, CheckCircle2, ChevronLeft, ChevronRight,
  ClipboardList, Download, Edit3, Eye, FileSpreadsheet, FileText,
  Link2, PackageSearch, Paperclip, Plus, RefreshCw, Save, Search,
  Send, ShoppingCart, Trash2, X,
} from 'lucide-react';
import toast from 'react-hot-toast';

const STATUS_OPTIONS = [
  'rascunho',
  'aguardando_aprovacao',
  'aprovado',
  'enviado_fornecedor',
  'confirmado_fornecedor',
  'parcialmente_recebido',
  'recebido',
  'cancelado',
  'fechado',
];

const STATUS_LABELS = {
  rascunho: 'Rascunho',
  aguardando_aprovacao: 'Aguardando aprovacao',
  aprovado: 'Aprovado',
  enviado_fornecedor: 'Enviado ao fornecedor',
  confirmado_fornecedor: 'Confirmado',
  parcialmente_recebido: 'Parcialmente recebido',
  recebido: 'Recebido',
  cancelado: 'Cancelado',
  fechado: 'Fechado',
};

const STATUS_BADGES = {
  rascunho: 'bg-gray-100 text-gray-600',
  aguardando_aprovacao: 'bg-amber-100 text-amber-700',
  aprovado: 'bg-emerald-100 text-emerald-700',
  enviado_fornecedor: 'bg-blue-100 text-blue-700',
  confirmado_fornecedor: 'bg-cyan-100 text-cyan-700',
  parcialmente_recebido: 'bg-violet-100 text-violet-700',
  recebido: 'bg-green-100 text-green-700',
  cancelado: 'bg-red-100 text-red-700',
  fechado: 'bg-slate-100 text-slate-600',
};

const LOJAS = [
  { value: 'embalatti', label: 'Embalatti' },
  { value: 'vivenda', label: 'Vivenda' },
  { value: 'ambas', label: 'Ambas' },
];

const ORIGENS = [
  { value: 'visita', label: 'Visita' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'telefone', label: 'Telefone' },
  { value: 'email', label: 'E-mail' },
  { value: 'feira', label: 'Feira' },
  { value: 'sugestao_interna', label: 'Sugestao interna' },
];

const NEXT_STATUS = [
  'aguardando_aprovacao',
  'enviado_fornecedor',
  'confirmado_fornecedor',
  'parcialmente_recebido',
  'recebido',
  'fechado',
];

function statusLabel(status) {
  return STATUS_LABELS[status] || status || '-';
}

function statusBadge(status) {
  return STATUS_BADGES[status] || 'bg-gray-100 text-gray-600';
}

function lojaLabel(value) {
  return LOJAS.find((item) => item.value === value)?.label || value || '-';
}

function origemLabel(value) {
  return ORIGENS.find((item) => item.value === value)?.label || value || '-';
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function makeItem(overrides = {}) {
  return {
    _key: `item-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    produto_sas_id: '',
    descricao_livre: '',
    familia: '',
    marca: '',
    cor: '',
    medida: '',
    quantidade: '1',
    unidade: 'un',
    custo_unitario_estimado: '',
    total_estimado: '',
    preco_venda_sugerido: '',
    observacoes: '',
    status_item: 'pendente',
    ...overrides,
  };
}

function blankForm() {
  return {
    fornecedor_id: '',
    fornecedor_nome: '',
    loja_destino: 'embalatti',
    comprador: '',
    data_pedido: today(),
    previsao_entrega: '',
    previsao_pagamento: '',
    origem: 'visita',
    observacoes: '',
    status: 'rascunho',
  };
}

function numeric(value) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function downloadBlob(response, fallbackName) {
  const disposition = response.headers?.['content-disposition'] || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] || fallbackName;
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function buildFormData(file, { itemId, tipo = 'outro', descricao = '' } = {}) {
  const fd = new FormData();
  fd.append('arquivo', file);
  fd.append('tipo', tipo);
  if (itemId) fd.append('item_id', itemId);
  if (descricao) fd.append('descricao', descricao);
  return fd;
}

async function uploadQueuedFiles(pedido, rows, orderFiles, itemFilesByKey) {
  const uploads = [];

  orderFiles.forEach((file) => {
    uploads.push(comprasApi.uploadAnexo(pedido.id, buildFormData(file, { tipo: 'outro' })));
  });

  rows.forEach((row, index) => {
    const files = itemFilesByKey[row._key] || [];
    const savedItem = row.id
      ? pedido.itens?.find((item) => Number(item.id) === Number(row.id))
      : pedido.itens?.[index];
    if (!savedItem) return;

    files.forEach((file) => {
      uploads.push(comprasApi.uploadAnexo(
        pedido.id,
        buildFormData(file, { itemId: savedItem.id, tipo: 'outro' }),
      ));
    });
  });

  if (uploads.length > 0) await Promise.all(uploads);
}

function HeaderActions({ onRefresh, loading, onNew }) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={onRefresh} className="btn-secondary" disabled={loading} title="Atualizar">
        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
      </button>
      <button onClick={onNew} className="btn-primary">
        <Plus size={16} /> Novo pedido
      </button>
    </div>
  );
}

function PedidoForm({ initial = null, onCancel, onSaved }) {
  const [form, setForm] = useState(blankForm());
  const [itens, setItens] = useState([makeItem()]);
  const [fornecedores, setFornecedores] = useState([]);
  const [saving, setSaving] = useState(false);
  const [orderFiles, setOrderFiles] = useState([]);
  const [itemFilesByKey, setItemFilesByKey] = useState({});

  const isEdit = !!initial?.id;
  const canEdit = !isEdit || ['rascunho', 'aguardando_aprovacao'].includes(initial.status);

  useEffect(() => {
    comprasApi.fornecedores({ perPage: 100 })
      .then((res) => setFornecedores(res.data.data || []))
      .catch(() => setFornecedores([]));
  }, []);

  useEffect(() => {
    if (!initial) {
      setForm(blankForm());
      setItens([makeItem()]);
      setOrderFiles([]);
      setItemFilesByKey({});
      return;
    }

    setForm({
      fornecedor_id: initial.fornecedor_id || '',
      fornecedor_nome: initial.fornecedor_nome || '',
      loja_destino: initial.loja_destino || 'embalatti',
      comprador: initial.comprador || '',
      data_pedido: initial.data_pedido?.slice(0, 10) || today(),
      previsao_entrega: initial.previsao_entrega?.slice(0, 10) || '',
      previsao_pagamento: initial.previsao_pagamento?.slice(0, 10) || '',
      origem: initial.origem || 'visita',
      observacoes: initial.observacoes || '',
      status: initial.status || 'rascunho',
    });
    const savedItems = initial.itens || [];
    setItens((savedItems.length ? savedItems : [makeItem()]).map((item) => makeItem({
      ...item,
      _key: item.id ? `item-${item.id}` : item._key,
      quantidade: item.quantidade ?? '',
      custo_unitario_estimado: item.custo_unitario_estimado ?? '',
      total_estimado: item.total_estimado ?? '',
      preco_venda_sugerido: item.preco_venda_sugerido ?? '',
    })));
    setOrderFiles([]);
    setItemFilesByKey({});
  }, [initial]);

  const totalEstimado = useMemo(() => (
    itens.reduce((sum, item) => sum + numeric(item.total_estimado), 0)
  ), [itens]);

  const setField = (field, value) => {
    if (field === 'fornecedor_nome') {
      const match = fornecedores.find((fornecedor) => fornecedor.nome.toLowerCase() === value.toLowerCase());
      setForm((prev) => ({
        ...prev,
        fornecedor_nome: value,
        fornecedor_id: match?.id || '',
      }));
      return;
    }
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateItem = (key, field, value) => {
    setItens((prev) => prev.map((item) => {
      if (item._key !== key) return item;
      const next = { ...item, [field]: value };
      if (field === 'quantidade' || field === 'custo_unitario_estimado') {
        const total = numeric(next.quantidade) * numeric(next.custo_unitario_estimado);
        next.total_estimado = total ? total.toFixed(2) : '';
      }
      return next;
    }));
  };

  const addItem = () => setItens((prev) => [...prev, makeItem()]);
  const removeItem = (key) => setItens((prev) => prev.length === 1 ? prev : prev.filter((item) => item._key !== key));

  const handleItemFiles = (key, files) => {
    setItemFilesByKey((prev) => ({
      ...prev,
      [key]: [...(prev[key] || []), ...Array.from(files || [])],
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canEdit) return;

    const filledItems = itens.filter((item) => item.produto_sas_id || item.descricao_livre);
    if (!form.fornecedor_nome && !form.fornecedor_id) {
      toast.error('Informe o fornecedor');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...form,
        itens: filledItems.map(({ _key, anexos, ...item }) => item),
      };

      const response = isEdit
        ? await comprasApi.update(initial.id, payload)
        : await comprasApi.create(payload);

      await uploadQueuedFiles(response.data, filledItems, orderFiles, itemFilesByKey);
      const finalData = orderFiles.length || Object.keys(itemFilesByKey).length
        ? (await comprasApi.get(response.data.id)).data
        : response.data;

      toast.success(isEdit ? 'Pedido atualizado' : 'Pedido criado');
      onSaved(finalData);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao salvar pedido');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{isEdit ? `Editar ${initial.numero_interno}` : 'Novo pedido de compra'}</h1>
          <p className="text-sm text-gray-500 mt-1">Anotador rapido para compras presenciais, WhatsApp e contatos com fornecedor.</p>
        </div>
        <button onClick={onCancel} className="btn-secondary">
          <X size={16} /> Fechar
        </button>
      </div>

      {!canEdit && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Este pedido esta em {statusLabel(initial.status)} e nao pode ser editado.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="card p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">Fornecedor</label>
              <input
                list="compras-fornecedores"
                value={form.fornecedor_nome}
                onChange={(event) => setField('fornecedor_nome', event.target.value)}
                className="input-field"
                placeholder="Digite ou selecione"
                disabled={!canEdit}
                required
              />
              <datalist id="compras-fornecedores">
                {fornecedores.map((fornecedor) => (
                  <option key={fornecedor.id} value={fornecedor.nome} />
                ))}
              </datalist>
              {!form.fornecedor_id && form.fornecedor_nome && (
                <p className="mt-1 text-xs text-emerald-600">Fornecedor novo sera cadastrado ao salvar.</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Loja destino</label>
              <select value={form.loja_destino} onChange={(event) => setField('loja_destino', event.target.value)} className="input-field" disabled={!canEdit}>
                {LOJAS.map((loja) => <option key={loja.value} value={loja.value}>{loja.label}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Comprador</label>
              <input value={form.comprador} onChange={(event) => setField('comprador', event.target.value)} className="input-field" disabled={!canEdit} placeholder="Responsavel" />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Data do pedido</label>
              <input type="date" value={form.data_pedido} onChange={(event) => setField('data_pedido', event.target.value)} className="input-field" disabled={!canEdit} required />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Previsao entrega</label>
              <input type="date" value={form.previsao_entrega} onChange={(event) => setField('previsao_entrega', event.target.value)} className="input-field" disabled={!canEdit} />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Previsao pagamento</label>
              <input type="date" value={form.previsao_pagamento} onChange={(event) => setField('previsao_pagamento', event.target.value)} className="input-field" disabled={!canEdit} />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Origem</label>
              <select value={form.origem} onChange={(event) => setField('origem', event.target.value)} className="input-field" disabled={!canEdit}>
                {ORIGENS.map((origem) => <option key={origem.value} value={origem.value}>{origem.label}</option>)}
              </select>
            </div>

            <div className="md:col-span-3">
              <label className="block text-xs font-medium text-gray-500 mb-1">Observacoes gerais</label>
              <textarea value={form.observacoes} onChange={(event) => setField('observacoes', event.target.value)} rows={2} className="input-field" disabled={!canEdit} />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Anexos do pedido</label>
              <label className={`btn-secondary w-full cursor-pointer ${!canEdit ? 'opacity-50 pointer-events-none' : ''}`}>
                <Paperclip size={15} /> Arquivos ({orderFiles.length})
                <input type="file" multiple className="hidden" onChange={(event) => setOrderFiles(Array.from(event.target.files || []))} />
              </label>
            </div>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Itens do pedido</h2>
              <p className="text-xs text-gray-500 mt-0.5">Itens podem ser livres ou vinculados futuramente ao SAS.</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-gray-900">{formatCurrency(totalEstimado)}</span>
              <button type="button" onClick={addItem} className="btn-secondary text-sm" disabled={!canEdit}>
                <Plus size={15} /> Item
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px]">
              <thead>
                <tr className="bg-gray-50/70 border-b border-gray-100">
                  <th className="table-header px-2 py-2 text-left w-52">Descricao livre</th>
                  <th className="table-header px-2 py-2 text-left w-24">Familia</th>
                  <th className="table-header px-2 py-2 text-left w-24">Marca</th>
                  <th className="table-header px-2 py-2 text-left w-20">Cor</th>
                  <th className="table-header px-2 py-2 text-left w-20">Medida</th>
                  <th className="table-header px-2 py-2 text-right w-20">Qtd</th>
                  <th className="table-header px-2 py-2 text-left w-16">Un</th>
                  <th className="table-header px-2 py-2 text-right w-24">Custo</th>
                  <th className="table-header px-2 py-2 text-right w-24">Total</th>
                  <th className="table-header px-2 py-2 text-right w-24">Venda</th>
                  <th className="table-header px-2 py-2 text-left w-44">Obs</th>
                  <th className="table-header px-2 py-2 text-center w-20">Anexo</th>
                  <th className="table-header px-2 py-2 text-center w-10"></th>
                </tr>
              </thead>
              <tbody>
                {itens.map((item) => (
                  <tr key={item._key} className="border-b border-gray-50">
                    <td className="px-2 py-2">
                      <input value={item.descricao_livre || ''} onChange={(event) => updateItem(item._key, 'descricao_livre', event.target.value)} className="input-field py-1.5" disabled={!canEdit} placeholder="Produto, referencia ou anotacao" />
                    </td>
                    <td className="px-2 py-2"><input value={item.familia || ''} onChange={(event) => updateItem(item._key, 'familia', event.target.value)} className="input-field py-1.5" disabled={!canEdit} /></td>
                    <td className="px-2 py-2"><input value={item.marca || ''} onChange={(event) => updateItem(item._key, 'marca', event.target.value)} className="input-field py-1.5" disabled={!canEdit} /></td>
                    <td className="px-2 py-2"><input value={item.cor || ''} onChange={(event) => updateItem(item._key, 'cor', event.target.value)} className="input-field py-1.5" disabled={!canEdit} /></td>
                    <td className="px-2 py-2"><input value={item.medida || ''} onChange={(event) => updateItem(item._key, 'medida', event.target.value)} className="input-field py-1.5" disabled={!canEdit} /></td>
                    <td className="px-2 py-2"><input type="number" step="0.001" value={item.quantidade || ''} onChange={(event) => updateItem(item._key, 'quantidade', event.target.value)} className="input-field py-1.5 text-right" disabled={!canEdit} /></td>
                    <td className="px-2 py-2"><input value={item.unidade || ''} onChange={(event) => updateItem(item._key, 'unidade', event.target.value)} className="input-field py-1.5" disabled={!canEdit} /></td>
                    <td className="px-2 py-2"><input type="number" step="0.0001" value={item.custo_unitario_estimado || ''} onChange={(event) => updateItem(item._key, 'custo_unitario_estimado', event.target.value)} className="input-field py-1.5 text-right" disabled={!canEdit} /></td>
                    <td className="px-2 py-2"><input type="number" step="0.01" value={item.total_estimado || ''} onChange={(event) => updateItem(item._key, 'total_estimado', event.target.value)} className="input-field py-1.5 text-right font-semibold" disabled={!canEdit} /></td>
                    <td className="px-2 py-2"><input type="number" step="0.01" value={item.preco_venda_sugerido || ''} onChange={(event) => updateItem(item._key, 'preco_venda_sugerido', event.target.value)} className="input-field py-1.5 text-right" disabled={!canEdit} /></td>
                    <td className="px-2 py-2"><input value={item.observacoes || ''} onChange={(event) => updateItem(item._key, 'observacoes', event.target.value)} className="input-field py-1.5" disabled={!canEdit} /></td>
                    <td className="px-2 py-2 text-center">
                      <label className={`inline-flex items-center justify-center gap-1 p-2 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 cursor-pointer ${!canEdit ? 'opacity-50 pointer-events-none' : ''}`} title="Anexar no item">
                        <Paperclip size={14} />
                        <span className="text-xs">{(itemFilesByKey[item._key] || []).length + (item.anexos?.length || 0)}</span>
                        <input type="file" multiple className="hidden" onChange={(event) => handleItemFiles(item._key, event.target.files)} />
                      </label>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button type="button" onClick={() => removeItem(item._key)} className="p-2 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50" disabled={!canEdit || itens.length === 1} title="Remover item">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="btn-secondary">Cancelar</button>
          <button type="submit" className="btn-primary" disabled={saving || !canEdit}>
            <Save size={16} className={saving ? 'animate-pulse' : ''} />
            {saving ? 'Salvando...' : 'Salvar pedido'}
          </button>
        </div>
      </form>
    </div>
  );
}

function PedidoDetalhe({ pedido, onClose, onUpdated, onEdit }) {
  const [changing, setChanging] = useState(false);

  const refresh = async () => {
    const res = await comprasApi.get(pedido.id);
    onUpdated(res.data);
  };

  const handleApprove = async () => {
    if (!confirm('Aprovar este pedido como compromisso financeiro previsto?')) return;
    setChanging(true);
    try {
      const res = await comprasApi.aprovar(pedido.id);
      toast.success('Pedido aprovado');
      onUpdated(res.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao aprovar');
    } finally {
      setChanging(false);
    }
  };

  const handleCancel = async () => {
    const motivo = prompt('Motivo do cancelamento:');
    if (!motivo) return;
    setChanging(true);
    try {
      const res = await comprasApi.cancelar(pedido.id, motivo);
      toast.success('Pedido cancelado');
      onUpdated(res.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao cancelar');
    } finally {
      setChanging(false);
    }
  };

  const handleStatus = async (status) => {
    if (!status) return;
    setChanging(true);
    try {
      const res = await comprasApi.changeStatus(pedido.id, { status });
      toast.success('Status atualizado');
      onUpdated(res.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao atualizar status');
    } finally {
      setChanging(false);
    }
  };

  const handleExport = async (format) => {
    try {
      const res = await comprasApi.exportPedido(pedido.id, format);
      downloadBlob(res, `${pedido.numero_interno}.${format === 'excel' ? 'xls' : 'pdf'}`);
    } catch (err) {
      toast.error('Erro ao exportar pedido');
    }
  };

  const canEdit = ['rascunho', 'aguardando_aprovacao'].includes(pedido.status);
  const canAdvance = !['cancelado', 'fechado'].includes(pedido.status);

  return (
    <div className="card p-5 mt-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-gray-900">{pedido.numero_interno}</h2>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(pedido.status)}`}>
              {statusLabel(pedido.status)}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">{pedido.fornecedor_nome} - {lojaLabel(pedido.loja_destino)}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {canEdit && (
            <button onClick={onEdit} className="btn-secondary text-sm">
              <Edit3 size={15} /> Editar
            </button>
          )}
          {pedido.status !== 'aprovado' && pedido.status !== 'cancelado' && pedido.status !== 'fechado' && (
            <button onClick={handleApprove} className="btn-primary text-sm" disabled={changing}>
              <CheckCircle2 size={15} /> Aprovar
            </button>
          )}
          {canAdvance && (
            <select onChange={(event) => handleStatus(event.target.value)} value="" className="input-field w-48" disabled={changing}>
              <option value="">Mudar status...</option>
              {NEXT_STATUS.filter((status) => status !== pedido.status).map((status) => (
                <option key={status} value={status}>{statusLabel(status)}</option>
              ))}
            </select>
          )}
          {pedido.status !== 'cancelado' && pedido.status !== 'fechado' && (
            <button onClick={handleCancel} className="btn-secondary text-sm text-red-600" disabled={changing}>
              <Ban size={15} /> Cancelar
            </button>
          )}
          <button onClick={() => handleExport('pdf')} className="btn-secondary text-sm">
            <FileText size={15} /> PDF
          </button>
          <button onClick={() => handleExport('excel')} className="btn-secondary text-sm">
            <FileSpreadsheet size={15} /> Excel
          </button>
          <button onClick={onClose} className="p-2 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-5 text-sm">
        <div><span className="block text-xs text-gray-400">Comprador</span>{pedido.comprador || '-'}</div>
        <div><span className="block text-xs text-gray-400">Pedido</span>{formatDate(pedido.data_pedido)}</div>
        <div><span className="block text-xs text-gray-400">Entrega</span>{formatDate(pedido.previsao_entrega)}</div>
        <div><span className="block text-xs text-gray-400">Pagamento</span>{formatDate(pedido.previsao_pagamento)}</div>
        <div><span className="block text-xs text-gray-400">Origem</span>{origemLabel(pedido.origem)}</div>
        <div><span className="block text-xs text-gray-400">Total estimado</span><strong>{formatCurrency(pedido.valor_total_estimado)}</strong></div>
      </div>

      {pedido.observacoes && (
        <div className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">{pedido.observacoes}</div>
      )}

      <div className="mt-5 overflow-x-auto border border-gray-100 rounded-lg">
        <table className="w-full min-w-[980px]">
          <thead>
            <tr className="bg-gray-50/70 border-b border-gray-100">
              <th className="table-header px-3 py-2 text-left">Item</th>
              <th className="table-header px-3 py-2 text-left">Familia</th>
              <th className="table-header px-3 py-2 text-left">Marca</th>
              <th className="table-header px-3 py-2 text-left">Cor/Medida</th>
              <th className="table-header px-3 py-2 text-right">Qtd</th>
              <th className="table-header px-3 py-2 text-right">Custo</th>
              <th className="table-header px-3 py-2 text-right">Total</th>
              <th className="table-header px-3 py-2 text-left">Anexos</th>
            </tr>
          </thead>
          <tbody>
            {(pedido.itens || []).map((item) => (
              <tr key={item.id} className="border-b border-gray-50">
                <td className="px-3 py-2 text-sm">
                  <p className="font-medium text-gray-900">{item.descricao_livre || item.produto_sas_id || '-'}</p>
                  {item.observacoes && <p className="text-xs text-gray-400 mt-0.5">{item.observacoes}</p>}
                </td>
                <td className="px-3 py-2 text-sm text-gray-600">{item.familia || '-'}</td>
                <td className="px-3 py-2 text-sm text-gray-600">{item.marca || '-'}</td>
                <td className="px-3 py-2 text-sm text-gray-600">{[item.cor, item.medida].filter(Boolean).join(' / ') || '-'}</td>
                <td className="px-3 py-2 text-sm text-right">{item.quantidade} {item.unidade}</td>
                <td className="px-3 py-2 text-sm text-right">{formatCurrency(item.custo_unitario_estimado)}</td>
                <td className="px-3 py-2 text-sm text-right font-semibold">{formatCurrency(item.total_estimado)}</td>
                <td className="px-3 py-2 text-xs">
                  {item.anexos?.length ? item.anexos.map((anexo) => (
                    <a key={anexo.id} href={anexo.arquivo_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 mr-2 text-brand-600 hover:underline">
                      <Paperclip size={12} /> {anexo.nome_arquivo || 'Anexo'}
                    </a>
                  )) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pedido.anexos?.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Anexos do pedido</h3>
          <div className="flex flex-wrap gap-2">
            {pedido.anexos.map((anexo) => (
              <a key={anexo.id} href={anexo.arquivo_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50">
                <Paperclip size={14} /> {anexo.nome_arquivo || 'Anexo'}
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-gray-500 uppercase">Historico de status</h3>
          <button onClick={refresh} className="text-xs text-brand-600 hover:underline">Atualizar detalhe</button>
        </div>
        <div className="mt-2 space-y-2">
          {(pedido.status_log || []).slice(0, 5).map((log) => (
            <div key={log.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs">
              <span><strong>{statusLabel(log.status_anterior)}</strong> para <strong>{statusLabel(log.status_novo)}</strong></span>
              <span className="text-gray-400">{log.usuario || '-'} - {formatDate(log.created_at)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PedidosLista({ abertos = false }) {
  const navigate = useNavigate();
  const [data, setData] = useState([]);
  const [resumo, setResumo] = useState(null);
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [filters, setFilters] = useState({
    fornecedor: '',
    loja: '',
    status: '',
    comprador: '',
    dataInicio: '',
    dataFim: '',
    page: 1,
    perPage: 30,
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = { ...filters, abertos: abertos ? 'true' : undefined };
      Object.keys(params).forEach((key) => {
        if (params[key] === '' || params[key] === undefined) delete params[key];
      });

      const [listRes, resumoRes] = await Promise.all([
        comprasApi.list(params),
        comprasApi.resumo(),
      ]);
      setData(listRes.data.data || []);
      setPagination(listRes.data.pagination || {});
      setResumo(resumoRes.data);
    } catch (err) {
      toast.error('Erro ao carregar pedidos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [filters, abertos]);

  const updateFilter = (field, value) => setFilters((prev) => ({ ...prev, [field]: value, page: 1 }));

  const handleSelect = async (row) => {
    if (selected?.id === row.id) {
      setSelected(null);
      return;
    }
    try {
      const res = await comprasApi.get(row.id);
      setSelected(res.data);
    } catch (err) {
      toast.error('Erro ao abrir pedido');
    }
  };

  if (editing) {
    return (
      <PedidoForm
        initial={editing}
        onCancel={() => setEditing(null)}
        onSaved={(pedido) => {
          setEditing(null);
          setSelected(pedido);
          fetchData();
        }}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{abertos ? 'Pedidos em aberto' : 'Central de Compras'}</h1>
          <p className="text-sm text-gray-500 mt-1">Anotador de pedidos separado do SAS, com compromisso previsto ao aprovar.</p>
        </div>
        <HeaderActions onRefresh={fetchData} loading={loading} onNew={() => navigate('/compras/novo')} />
      </div>

      {resumo && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="card p-4">
            <p className="text-xs text-gray-500 font-medium uppercase">Rascunhos</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{resumo.porStatus?.rascunho?.qtd || 0}</p>
            <p className="text-xs text-gray-400">{formatCurrency(resumo.porStatus?.rascunho?.total || 0)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500 font-medium uppercase">Aguardando aprovacao</p>
            <p className="text-xl font-bold text-amber-600 mt-1">{resumo.porStatus?.aguardando_aprovacao?.qtd || 0}</p>
            <p className="text-xs text-gray-400">{formatCurrency(resumo.porStatus?.aguardando_aprovacao?.total || 0)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500 font-medium uppercase">Compromisso previsto</p>
            <p className="text-xl font-bold text-emerald-600 mt-1">{formatCurrency(resumo.compromisso_previsto?.total || 0)}</p>
            <p className="text-xs text-gray-400">{resumo.compromisso_previsto?.qtd || 0} pedidos aprovados/ativos</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500 font-medium uppercase">Recebidos</p>
            <p className="text-xl font-bold text-green-600 mt-1">{resumo.porStatus?.recebido?.qtd || 0}</p>
            <p className="text-xs text-gray-400">{formatCurrency(resumo.porStatus?.recebido?.total || 0)}</p>
          </div>
        </div>
      )}

      <div className="card p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={filters.fornecedor} onChange={(event) => updateFilter('fornecedor', event.target.value)} placeholder="Fornecedor..." className="input-field pl-9 w-56" />
          </div>
          <select value={filters.loja} onChange={(event) => updateFilter('loja', event.target.value)} className="input-field w-40">
            <option value="">Todas lojas</option>
            {LOJAS.map((loja) => <option key={loja.value} value={loja.value}>{loja.label}</option>)}
          </select>
          <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)} className="input-field w-52">
            <option value="">Todos status</option>
            {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
          </select>
          <input value={filters.comprador} onChange={(event) => updateFilter('comprador', event.target.value)} placeholder="Comprador..." className="input-field w-44" />
          <input type="date" value={filters.dataInicio} onChange={(event) => updateFilter('dataInicio', event.target.value)} className="input-field w-40" />
          <span className="text-gray-400 text-sm">ate</span>
          <input type="date" value={filters.dataFim} onChange={(event) => updateFilter('dataFim', event.target.value)} className="input-field w-40" />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px]">
            <thead>
              <tr className="bg-gray-50/70 border-b border-gray-100">
                <th className="table-header px-3 py-3 text-left">Numero</th>
                <th className="table-header px-3 py-3 text-left">Fornecedor</th>
                <th className="table-header px-3 py-3 text-left">Loja</th>
                <th className="table-header px-3 py-3 text-left">Comprador</th>
                <th className="table-header px-3 py-3 text-left">Pedido</th>
                <th className="table-header px-3 py-3 text-left">Entrega</th>
                <th className="table-header px-3 py-3 text-right">Total</th>
                <th className="table-header px-3 py-3 text-center">Status</th>
                <th className="table-header px-3 py-3 text-center">Itens</th>
                <th className="table-header px-3 py-3 text-center w-20">Abrir</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400"><RefreshCw size={20} className="animate-spin inline mr-2" />Carregando...</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400">Nenhum pedido encontrado.</td></tr>
              ) : data.map((row) => (
                <tr key={row.id} onClick={() => handleSelect(row)} className={`border-b border-gray-50 hover:bg-gray-50/60 cursor-pointer ${selected?.id === row.id ? 'bg-brand-50/40' : ''}`}>
                  <td className="px-3 py-3 text-sm font-mono font-semibold text-gray-900">{row.numero_interno}</td>
                  <td className="px-3 py-3 text-sm font-medium text-gray-900 truncate max-w-[220px]">{row.fornecedor_nome}</td>
                  <td className="px-3 py-3 text-sm text-gray-600">{lojaLabel(row.loja_destino)}</td>
                  <td className="px-3 py-3 text-sm text-gray-600">{row.comprador || '-'}</td>
                  <td className="px-3 py-3 text-sm text-gray-500">{formatDate(row.data_pedido)}</td>
                  <td className="px-3 py-3 text-sm text-gray-500">{formatDate(row.previsao_entrega)}</td>
                  <td className="px-3 py-3 text-sm text-right font-semibold">{formatCurrency(row.valor_total_estimado)}</td>
                  <td className="px-3 py-3 text-center">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(row.status)}`}>
                      {statusLabel(row.status)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-sm text-center text-gray-500">{row.total_itens || 0}</td>
                  <td className="px-3 py-3 text-center">
                    <Eye size={16} className="inline text-gray-400" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
          <p className="text-xs text-gray-500">{pagination.total ? `${pagination.total} pedidos` : ''}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setFilters((prev) => ({ ...prev, page: prev.page - 1 }))} disabled={filters.page <= 1} className="btn-secondary py-1.5 px-2 text-xs disabled:opacity-40"><ChevronLeft size={14} /></button>
            <span className="text-xs text-gray-600">Pag. {pagination.page || 1} de {pagination.totalPages || 1}</span>
            <button onClick={() => setFilters((prev) => ({ ...prev, page: prev.page + 1 }))} disabled={filters.page >= (pagination.totalPages || 1)} className="btn-secondary py-1.5 px-2 text-xs disabled:opacity-40"><ChevronRight size={14} /></button>
          </div>
        </div>
      </div>

      {selected && (
        <PedidoDetalhe
          pedido={selected}
          onClose={() => setSelected(null)}
          onUpdated={(pedido) => {
            setSelected(pedido);
            fetchData();
          }}
          onEdit={() => setEditing(selected)}
        />
      )}
    </div>
  );
}

function ProdutosLivresPage() {
  const [data, setData] = useState([]);
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ search: '', fornecedor: '', page: 1, perPage: 50 });

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = { ...filters };
      Object.keys(params).forEach((key) => {
        if (params[key] === '') delete params[key];
      });
      const res = await comprasApi.produtosLivres(params);
      setData(res.data.data || []);
      setPagination(res.data.pagination || {});
    } catch (err) {
      toast.error('Erro ao carregar produtos livres');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [filters]);

  const updateFilter = (field, value) => setFilters((prev) => ({ ...prev, [field]: value, page: 1 }));

  const vincular = async (item) => {
    const produto_sas_id = prompt(`Produto SAS para "${item.descricao_livre}":`);
    if (!produto_sas_id) return;
    try {
      await comprasApi.vincularSas(item.id, { produto_sas_id, observacao: 'Vinculo manual pelo modulo de compras' });
      toast.success('Item vinculado ao SAS');
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao vincular');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Produtos livres</h1>
          <p className="text-sm text-gray-500 mt-1">Itens de compra ainda sem produto_sas_id.</p>
        </div>
        <button onClick={fetchData} className="btn-secondary" disabled={loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Atualizar
        </button>
      </div>

      <div className="card p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} placeholder="Descricao, familia ou marca..." className="input-field pl-9 w-72" />
          </div>
          <input value={filters.fornecedor} onChange={(event) => updateFilter('fornecedor', event.target.value)} placeholder="Fornecedor..." className="input-field w-56" />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px]">
            <thead>
              <tr className="bg-gray-50/70 border-b border-gray-100">
                <th className="table-header px-3 py-3 text-left">Descricao</th>
                <th className="table-header px-3 py-3 text-left">Fornecedor</th>
                <th className="table-header px-3 py-3 text-left">Pedido</th>
                <th className="table-header px-3 py-3 text-left">Familia</th>
                <th className="table-header px-3 py-3 text-left">Marca</th>
                <th className="table-header px-3 py-3 text-right">Qtd</th>
                <th className="table-header px-3 py-3 text-right">Total</th>
                <th className="table-header px-3 py-3 text-center">Acao</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400"><RefreshCw size={20} className="animate-spin inline mr-2" />Carregando...</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">Nenhum produto livre encontrado.</td></tr>
              ) : data.map((item) => (
                <tr key={item.id} className="border-b border-gray-50">
                  <td className="px-3 py-3 text-sm font-medium text-gray-900">{item.descricao_livre}</td>
                  <td className="px-3 py-3 text-sm text-gray-600">{item.fornecedor_nome || '-'}</td>
                  <td className="px-3 py-3 text-sm font-mono text-gray-500">{item.numero_interno}</td>
                  <td className="px-3 py-3 text-sm text-gray-600">{item.familia || '-'}</td>
                  <td className="px-3 py-3 text-sm text-gray-600">{item.marca || '-'}</td>
                  <td className="px-3 py-3 text-sm text-right">{item.quantidade} {item.unidade}</td>
                  <td className="px-3 py-3 text-sm text-right font-semibold">{formatCurrency(item.total_estimado)}</td>
                  <td className="px-3 py-3 text-center">
                    <button onClick={() => vincular(item)} className="btn-secondary py-1.5 px-3 text-xs">
                      <Link2 size={14} /> Vincular SAS
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
          <p className="text-xs text-gray-500">{pagination.total ? `${pagination.total} itens livres` : ''}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setFilters((prev) => ({ ...prev, page: prev.page - 1 }))} disabled={filters.page <= 1} className="btn-secondary py-1.5 px-2 text-xs disabled:opacity-40"><ChevronLeft size={14} /></button>
            <span className="text-xs text-gray-600">Pag. {pagination.page || 1} de {pagination.totalPages || 1}</span>
            <button onClick={() => setFilters((prev) => ({ ...prev, page: prev.page + 1 }))} disabled={filters.page >= (pagination.totalPages || 1)} className="btn-secondary py-1.5 px-2 text-xs disabled:opacity-40"><ChevronRight size={14} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FuturePage({ title }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          <p className="text-sm text-gray-500 mt-1">Reservado para a fase de inteligencia de compras.</p>
        </div>
      </div>
      <div className="card p-8">
        <div className="max-w-2xl">
          <AlertTriangle size={28} className="text-amber-500 mb-3" />
          <h2 className="text-lg font-bold text-gray-900">Fase futura</h2>
          <p className="text-sm text-gray-600 mt-2">
            Esta area vai usar leitura do SAS, estoque atual, vendas historicas, lead time,
            estoque minimo, curva ABC e orcamento. O MVP atual mantem apenas o anotador de pedidos.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ComprasPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname;

  if (path.endsWith('/novo')) {
    return (
      <PedidoForm
        onCancel={() => navigate('/compras/pedidos')}
        onSaved={(pedido) => navigate(`/compras/pedidos`, { state: { pedidoId: pedido.id } })}
      />
    );
  }

  if (path.endsWith('/produtos-livres')) return <ProdutosLivresPage />;
  if (path.endsWith('/sugestoes')) return <FuturePage title="Sugestoes de compra" />;
  if (path.endsWith('/orcamento')) return <FuturePage title="Orcamento de compras" />;
  if (path.endsWith('/regras-estoque')) return <FuturePage title="Regras de estoque" />;

  return <PedidosLista abertos={path.endsWith('/abertos')} />;
}
