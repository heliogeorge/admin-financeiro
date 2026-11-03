import { useState, useEffect, useCallback } from 'react';
import { lojaInfoApi } from '../lib/api';
import { formatDate } from '../lib/utils';
import {
  Plus, X, Pencil, Trash2, RefreshCw, Search, Upload,
  FolderArchive, FileText, Image as ImageIcon, File, Paperclip,
  Zap, FileSignature, Users, Home, Tag, ExternalLink,
} from 'lucide-react';
import toast from 'react-hot-toast';

const CATEGORIAS = [
  { value: 'contas_servicos', label: 'Contas e serviços', icon: Zap, badge: 'bg-amber-100 text-amber-700' },
  { value: 'contratos', label: 'Contratos', icon: FileSignature, badge: 'bg-blue-100 text-blue-700' },
  { value: 'documentos_socios', label: 'Documentos dos sócios', icon: Users, badge: 'bg-purple-100 text-purple-700' },
  { value: 'imovel', label: 'Imóvel', icon: Home, badge: 'bg-emerald-100 text-emerald-700' },
  { value: 'outros', label: 'Outros', icon: Tag, badge: 'bg-gray-100 text-gray-600' },
];

const catInfo = (value) => CATEGORIAS.find((c) => c.value === value) || CATEGORIAS[CATEGORIAS.length - 1];

function docUrl(doc) {
  if (doc.arquivo_url) {
    const p = doc.arquivo_url.replace(/\\/g, '/');
    return p.startsWith('/') ? p : `/${p}`;
  }
  const p = (doc.caminho_arquivo || '').replace(/\\/g, '/').replace(/^.*?(uploads\/)/, 'uploads/');
  return `/${p}`;
}

function docIcon(mime) {
  if (mime?.startsWith('image/')) return ImageIcon;
  if (mime === 'application/pdf') return FileText;
  return File;
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================
// Modal de criar/editar registro
// ============================================
function InfoForm({ isOpen, onClose, onSaved, editData }) {
  const [form, setForm] = useState({ titulo: '', categoria: 'contas_servicos', descricao: '' });
  const [campos, setCampos] = useState([]);
  const [documentos, setDocumentos] = useState([]);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (editData) {
      setForm({
        titulo: editData.titulo || '',
        categoria: editData.categoria || 'outros',
        descricao: editData.descricao || '',
      });
      setCampos((editData.campos || []).map((c) => ({ chave: c.chave, valor: c.valor || '' })));
      setDocumentos(editData.documentos || []);
    } else {
      setForm({ titulo: '', categoria: 'contas_servicos', descricao: '' });
      setCampos([]);
      setDocumentos([]);
    }
    setPendingFiles([]);
  }, [editData, isOpen]);

  if (!isOpen) return null;

  const setCampo = (i, key, value) => {
    setCampos((prev) => prev.map((c, idx) => (idx === i ? { ...c, [key]: value } : c)));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        campos: campos.filter((c) => c.chave.trim()),
      };
      let saved;
      if (editData) {
        saved = (await lojaInfoApi.update(editData.id, payload)).data;
      } else {
        saved = (await lojaInfoApi.create(payload)).data;
      }

      // Envia anexos selecionados antes de salvar (criação)
      for (const file of pendingFiles) {
        try {
          await lojaInfoApi.uploadDocumento(saved.id, file);
        } catch (err) {
          toast.error(`Falha ao anexar ${file.name}: ${err.response?.data?.error || 'erro no upload'}`);
        }
      }

      toast.success(editData ? 'Registro atualizado' : 'Registro criado');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (files) => {
    // Copia a FileList antes de qualquer setState: o input é limpo logo após
    // o change e a FileList viva esvaziaria junto.
    const lista = Array.from(files || []);
    if (lista.length === 0) return;
    if (!editData) {
      // Registro ainda não existe: guarda para enviar junto com o salvar
      setPendingFiles((prev) => [...prev, ...lista]);
      return;
    }
    setUploading(true);
    try {
      for (const file of lista) {
        const res = await lojaInfoApi.uploadDocumento(editData.id, file);
        setDocumentos((prev) => [res.data, ...prev]);
      }
      toast.success('Documento anexado');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro no upload');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDoc = async (doc) => {
    if (!confirm(`Remover o documento "${doc.nome_arquivo || 'sem nome'}"?`)) return;
    try {
      await lojaInfoApi.deleteDocumento(editData.id, doc.id);
      setDocumentos((prev) => prev.filter((d) => d.id !== doc.id));
      toast.success('Documento removido');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao remover');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-bold">{editData ? 'Editar Registro' : 'Novo Registro'}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Título *</label>
              <input required value={form.titulo}
                onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
                className="input-field" placeholder="Ex: Conta de luz Enel — Loja 1" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Categoria</label>
              <select value={form.categoria}
                onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value }))}
                className="input-field">
                {CATEGORIAS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Descrição / anotações</label>
            <textarea rows={3} value={form.descricao}
              onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
              className="input-field" placeholder="Anotações livres sobre este registro..." />
          </div>

          {/* Campos chave-valor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-semibold text-gray-600">Dados estruturados (chave → valor)</label>
              <button type="button"
                onClick={() => setCampos((prev) => [...prev, { chave: '', valor: '' }])}
                className="text-xs font-medium text-brand-700 hover:text-brand-800 flex items-center gap-1">
                <Plus size={13} /> Adicionar campo
              </button>
            </div>
            {campos.length === 0 ? (
              <p className="text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg px-3 py-3">
                Nenhum campo. Use para dados como "Nº instalação Enel", "Conta Sabesp", "Linha Vivo"...
              </p>
            ) : (
              <div className="space-y-2">
                {campos.map((c, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input value={c.chave} onChange={(e) => setCampo(i, 'chave', e.target.value)}
                      className="input-field flex-1" placeholder="Chave (ex: Nº instalação Enel)" />
                    <input value={c.valor} onChange={(e) => setCampo(i, 'valor', e.target.value)}
                      className="input-field flex-1" placeholder="Valor (ex: 12345678)" />
                    <button type="button"
                      onClick={() => setCampos((prev) => prev.filter((_, idx) => idx !== i))}
                      className="p-1.5 rounded hover:bg-red-50 text-red-400 flex-shrink-0">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Documentos anexos */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-semibold text-gray-600">Documentos anexos</label>
              <label className={`text-xs font-medium text-brand-700 hover:text-brand-800 flex items-center gap-1 cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                <Upload size={13} /> {uploading ? 'Enviando...' : 'Anexar arquivo'}
                <input type="file" multiple className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.txt,.csv,.xls,.xlsx,.doc,.docx"
                  onChange={(e) => { handleUpload(e.target.files); e.target.value = ''; }} />
              </label>
            </div>

            {documentos.length === 0 && pendingFiles.length === 0 ? (
              <p className="text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg px-3 py-3">
                Nenhum documento. Anexe contratos, faturas, documentos pessoais (PDF, imagens...).
              </p>
            ) : (
              <div className="space-y-1.5">
                {pendingFiles.map((f, i) => (
                  <div key={`p-${i}`} className="flex items-center gap-2 text-sm bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    <Paperclip size={14} className="text-amber-500 flex-shrink-0" />
                    <span className="flex-1 truncate">{f.name}</span>
                    <span className="text-[10px] text-amber-600">será enviado ao salvar</span>
                    <button type="button"
                      onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      className="p-1 rounded hover:bg-amber-100 text-amber-500"><X size={13} /></button>
                  </div>
                ))}
                {documentos.map((d) => {
                  const Icon = docIcon(d.mime_type);
                  return (
                    <div key={d.id} className="flex items-center gap-2 text-sm bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                      <Icon size={14} className="text-gray-400 flex-shrink-0" />
                      <a href={docUrl(d)} target="_blank" rel="noreferrer"
                        className="flex-1 truncate text-brand-700 hover:underline">
                        {d.nome_arquivo || 'arquivo'}
                      </a>
                      <span className="text-[10px] text-gray-400">{formatBytes(d.tamanho_bytes)}</span>
                      <button type="button" onClick={() => handleDeleteDoc(d)}
                        className="p-1 rounded hover:bg-red-50 text-red-400"><Trash2 size={13} /></button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================
// Card de registro
// ============================================
function InfoCard({ registro, onEdit, onDelete }) {
  const cat = catInfo(registro.categoria);
  const CatIcon = cat.icon;

  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${cat.badge}`}>
            <CatIcon size={11} /> {cat.label}
          </span>
          <h3 className="font-semibold text-gray-900 mt-1.5 leading-snug">{registro.titulo}</h3>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <button onClick={() => onEdit(registro)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500" title="Editar">
            <Pencil size={14} />
          </button>
          <button onClick={() => onDelete(registro)} className="p-1.5 rounded hover:bg-red-50 text-red-400" title="Excluir">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {registro.descricao && (
        <p className="text-sm text-gray-500 whitespace-pre-line line-clamp-4">{registro.descricao}</p>
      )}

      {registro.campos?.length > 0 && (
        <dl className="text-sm divide-y divide-gray-50 border border-gray-100 rounded-lg overflow-hidden">
          {registro.campos.map((c) => (
            <div key={c.id} className="flex justify-between gap-3 px-3 py-1.5 bg-gray-50/50">
              <dt className="text-gray-500 text-xs pt-0.5 flex-shrink-0">{c.chave}</dt>
              <dd className="font-mono text-[13px] text-gray-800 text-right break-all select-all">{c.valor || '—'}</dd>
            </div>
          ))}
        </dl>
      )}

      {registro.documentos?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {registro.documentos.map((d) => {
            const Icon = docIcon(d.mime_type);
            return (
              <a key={d.id} href={docUrl(d)} target="_blank" rel="noreferrer"
                title={d.nome_arquivo}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-brand-50 text-brand-700 hover:bg-brand-100 text-xs font-medium max-w-[180px]">
                <Icon size={12} className="flex-shrink-0" />
                <span className="truncate">{d.nome_arquivo || 'arquivo'}</span>
                <ExternalLink size={10} className="flex-shrink-0 opacity-60" />
              </a>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-auto">
        Atualizado em {formatDate(registro.updated_at)}
      </p>
    </div>
  );
}

// ============================================
// Página principal
// ============================================
export default function LojaInfoPage() {
  const [registros, setRegistros] = useState([]);
  const [resumo, setResumo] = useState({ total: 0, porCategoria: {} });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [categoria, setCategoria] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, resumoRes] = await Promise.all([
        lojaInfoApi.list({ search: search || undefined, categoria: categoria || undefined }),
        lojaInfoApi.resumo(),
      ]);
      setRegistros(listRes.data.data || []);
      setResumo(resumoRes.data || { total: 0, porCategoria: {} });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao carregar registros');
    } finally {
      setLoading(false);
    }
  }, [search, categoria]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Debounce da busca
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const handleEdit = async (registro) => {
    try {
      const res = await lojaInfoApi.get(registro.id);
      setEditItem(res.data);
      setShowForm(true);
    } catch {
      toast.error('Erro ao abrir registro');
    }
  };

  const handleDelete = async (registro) => {
    if (!confirm(`Excluir o registro "${registro.titulo}"? Os documentos anexados também serão removidos.`)) return;
    try {
      await lojaInfoApi.delete(registro.id);
      toast.success('Registro excluído');
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao excluir');
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FolderArchive size={24} className="text-brand-600" /> Informações da Loja
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Cofre central de informações e documentos da empresa — contas, contratos, documentos dos sócios.
          </p>
        </div>
        <button onClick={() => { setEditItem(null); setShowForm(true); }} className="btn-primary">
          <Plus size={16} /> Novo Registro
        </button>
      </div>

      {/* Busca + filtro por categoria */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar por título, anotação, chave ou valor..."
            className="input-field pl-9 w-full" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setCategoria('')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              categoria === '' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            Todas ({resumo.total || 0})
          </button>
          {CATEGORIAS.map((c) => (
            <button key={c.value} onClick={() => setCategoria(categoria === c.value ? '' : c.value)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                categoria === c.value ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              <c.icon size={11} /> {c.label} ({resumo.porCategoria?.[c.value] || 0})
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="card p-10 text-center text-gray-400">
          <RefreshCw size={18} className="animate-spin inline mr-2" /> Carregando...
        </div>
      ) : registros.length === 0 ? (
        <div className="card p-10 text-center text-gray-400">
          {search || categoria
            ? 'Nenhum registro encontrado com esses filtros.'
            : 'Nenhum registro ainda. Clique em "Novo Registro" para começar a guardar as informações da empresa.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {registros.map((r) => (
            <InfoCard key={r.id} registro={r} onEdit={handleEdit} onDelete={handleDelete} />
          ))}
        </div>
      )}

      <InfoForm
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditItem(null); }}
        onSaved={() => { setShowForm(false); setEditItem(null); fetchData(); }}
        editData={editItem}
      />
    </div>
  );
}
