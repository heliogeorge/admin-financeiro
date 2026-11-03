import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

function extractApiErrorMessage(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  if (typeof payload?.error === 'string') return payload.error;
  if (typeof payload?.message === 'string') return payload.message;
  if (typeof payload?.error?.message === 'string') return payload.error.message;
  return '';
}

const api = axios.create({
  baseURL: API_BASE,
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const apiMessage = extractApiErrorMessage(error.response?.data);
    if (apiMessage) {
      error.apiMessage = apiMessage;
      if (error.response?.data && typeof error.response.data === 'object') {
        error.response.data.error = apiMessage;
        error.response.data.message = apiMessage;
      }
    }
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  login: (username, password) => api.post('/auth/login', { username, password }),
  me: () => api.get('/auth/me'),
};

export const pagameApi = {
  list: (params) => api.get('/pagame', { params }),
  resumo: (params) => api.get('/pagame/resumo', { params }),
  fluxo: (params) => api.get('/pagame/fluxo', { params }),
  topFornecedores: (params) => api.get('/pagame/top-fornecedores', { params }),
  get: (lancamen, params) => api.get(`/pagame/${lancamen}`, { params }),
};

export const relrecApi = {
  list: (params) => api.get('/relrec', { params }),
  resumo: (params) => api.get('/relrec/resumo', { params }),
  semVinculo: (params) => api.get('/relrec/sem-vinculo', { params }),
  byFornecedor: (codiforn, params) => api.get(`/relrec/fornecedor/${codiforn}`, { params }),
  byNfe: (chave) => api.get(`/relrec/nfe/${chave}`),
  get: (numerorr, params) => api.get(`/relrec/${numerorr}`, { params }),
};

function buildBaixaFormData(data, arquivo) {
  const fd = new FormData();
  Object.entries(data || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') fd.append(k, v);
  });
  if (arquivo) fd.append('comprovante', arquivo);
  return fd;
}

export const contasPagarApi = {
  list: (params) => api.get('/contas-pagar', { params }),
  resumo: (params) => api.get('/contas-pagar/resumo', { params }),
  recorrentes: (params) => api.get('/contas-pagar/recorrentes', { params }),
  get: (id) => api.get(`/contas-pagar/${id}`),
  rastreio: (id) => api.get(`/contas-pagar/${id}/rastreio`),
  create: (data) => api.post('/contas-pagar', data),
  update: (id, data) => api.put(`/contas-pagar/${id}`, data),

  // CRUD de baixas (histórico de pagamentos)
  listBaixas: (id) => api.get(`/contas-pagar/${id}/baixas`),
  createBaixa: (id, data, arquivo) => api.post(
    `/contas-pagar/${id}/baixas`,
    buildBaixaFormData(data, arquivo),
    { headers: { 'Content-Type': 'multipart/form-data' } }
  ),
  updateBaixa: (id, baixaId, data, arquivo) => api.put(
    `/contas-pagar/${id}/baixas/${baixaId}`,
    buildBaixaFormData(data, arquivo),
    { headers: { 'Content-Type': 'multipart/form-data' } }
  ),
  deleteBaixa: (id, baixaId, motivo) => api.delete(
    `/contas-pagar/${id}/baixas/${baixaId}`,
    { data: { motivo } }
  ),
  getBaixaDocumento: (documentoId) => api.get(`/contas-pagar/baixas/documentos/${documentoId}`),
  updateBaixaDocumento: (documentoId, data) => api.put(`/contas-pagar/baixas/documentos/${documentoId}`, data),
  deleteBaixaDocumento: (documentoId, motivo) => api.delete(
    `/contas-pagar/baixas/documentos/${documentoId}`,
    { data: { motivo } }
  ),
  previewJuros: (id, data_pagamento) =>
    api.post(`/contas-pagar/${id}/preview-juros`, { data_pagamento }),
  baixaLote: (data) => api.post('/contas-pagar/baixas/lote', data),

  // Legado: ainda suportado — internamente cria uma baixa
  baixa: (id, data) => api.put(`/contas-pagar/${id}/baixa`, data),

  uploadComprovante: (id, file) => {
    const formData = new FormData();
    formData.append('arquivo', file);
    return api.post(`/contas-pagar/${id}/comprovante`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  delete: (id) => api.delete(`/contas-pagar/${id}`),
};

export const contasBancariasApi = {
  list: (params) => api.get('/contas-bancarias', { params }),
  get: (id) => api.get(`/contas-bancarias/${id}`),
  create: (data) => api.post('/contas-bancarias', data),
  update: (id, data) => api.put(`/contas-bancarias/${id}`, data),
  delete: (id) => api.delete(`/contas-bancarias/${id}`),
  extratos: (id, params) => api.get(`/contas-bancarias/${id}/extratos`, { params }),
};

export const fornecedorRegrasApi = {
  list: (params) => api.get('/fornecedor-regras', { params }),
  create: (data) => api.post('/fornecedor-regras', data),
  update: (id, data) => api.put(`/fornecedor-regras/${id}`, data),
  delete: (id) => api.delete(`/fornecedor-regras/${id}`),
};

export const conciliacaoApi = {
  importarOfx: (contaBancariaId, file) => {
    const fd = new FormData();
    fd.append('arquivo', file);
    return api.post(`/conciliacao/ofx/${contaBancariaId}`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  extratos: (params) => api.get('/conciliacao/extratos', { params }),
  conciliar: (extratoId, data) =>
    api.post(`/conciliacao/extratos/${extratoId}/conciliar`, data),
  criarConta: (extratoId, data) =>
    api.post(`/conciliacao/extratos/${extratoId}/criar-conta`, data),
  ignorar: (extratoId) => api.post(`/conciliacao/extratos/${extratoId}/ignorar`),
  sugestoes: (extratoId, params) => api.get(`/conciliacao/sugestoes/${extratoId}`, { params }),
  extratoConta: (contaId, params) => api.get(`/conciliacao/extrato-conta/${contaId}`, { params }),
};

export const mpApi = {
  contas: () => api.get('/mp/contas'),
  sync: (data) => api.post('/mp/sync', data || {}),
};

export const bbApi = {
  status: () => api.get('/bb/status'),
  sync: (data) => api.post('/bb/sync', data || {}),
};

export const syncApi = {
  syncPagame: (data) => api.post('/sync/pagame', data || {}),
  syncRelrec: (data) => api.post('/sync/relrec', data || {}),
  status: () => api.get('/sync/status'),
};

export const entradasApi = {
  list: (params) => api.get('/entradas', { params }),
  resumo: (params) => api.get('/entradas/resumo', { params }),
  get: (id) => api.get(`/entradas/${id}`),
  update: (id, data) => api.put(`/entradas/${id}`, data),
  vincularContas: (id, contas_ids) => api.post(`/entradas/${id}/vincular-contas`, { contas_ids }),
  desvincularConta: (id, contaId) => api.delete(`/entradas/${id}/desvincular-conta/${contaId}`),
  autoVincular: (id) => api.post(`/entradas/${id}/auto-vincular`),
};

export const ddaApi = {
  list: (params) => api.get('/dda', { params }),
  resumo: () => api.get('/dda/resumo'),
  get: (id) => api.get(`/dda/${id}`),
  importarTexto: (texto) => api.post('/dda/importar-texto', { texto }),
  importarArquivo: (file) => {
    const formData = new FormData();
    formData.append('arquivo', file);
    return api.post('/dda/importar-arquivo', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  vincularConta: (id, conta_pagar_id) => api.post(`/dda/${id}/vincular-conta`, { conta_pagar_id }),
  delete: (id) => api.delete(`/dda/${id}`),
};

export const planoContasApi = {
  list: (params) => api.get('/plano-contas', { params }),
  sync: (data) => api.post('/plano-contas/sync', data || {}),
};

export const chequesApi = {
  list: (params) => api.get('/cheques', { params }),
  resumo: () => api.get('/cheques/resumo'),
  get: (id) => api.get(`/cheques/${id}`),
  create: (data) => api.post('/cheques', data),
  createLote: (data) => api.post('/cheques/lote', data),
  update: (id, data) => api.put(`/cheques/${id}`, data),
  compensar: (id, data) => api.put(`/cheques/${id}/compensar`, data || {}),
  devolver: (id, data) => api.put(`/cheques/${id}/devolver`, data || {}),
  vincular: (id, data) => api.post(`/cheques/${id}/vincular`, data),
  delete: (id) => api.delete(`/cheques/${id}`),
};

export const comprasApi = {
  fornecedores: (params) => api.get('/compras/fornecedores', { params }),
  createFornecedor: (data) => api.post('/compras/fornecedores', data),
  list: (params) => api.get('/compras/pedidos', { params }),
  resumo: () => api.get('/compras/pedidos/resumo'),
  get: (id) => api.get(`/compras/pedidos/${id}`),
  create: (data) => api.post('/compras/pedidos', data),
  update: (id, data) => api.put(`/compras/pedidos/${id}`, data),
  changeStatus: (id, data) => api.post(`/compras/pedidos/${id}/status`, data),
  aprovar: (id, data) => api.post(`/compras/pedidos/${id}/aprovar`, data || {}),
  cancelar: (id, motivo) => api.post(`/compras/pedidos/${id}/cancelar`, { motivo }),
  uploadAnexo: (id, data) => api.post(`/compras/pedidos/${id}/anexos`, data, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  deleteAnexo: (id) => api.delete(`/compras/anexos/${id}`),
  exportPedido: (id, format) => api.get(`/compras/pedidos/${id}/export/${format}`, { responseType: 'blob' }),
  produtosLivres: (params) => api.get('/compras/produtos-livres', { params }),
  vincularSas: (id, data) => api.post(`/compras/itens/${id}/vincular-sas`, data),
};

export const rankingVendasApi = {
  list: (params) => api.get('/ranking-vendas', { params }),
  resumo: (params) => api.get('/ranking-vendas/resumo', { params }),
};

export const vendasAnaliticoApi = {
  list: (params) => api.get('/vendas-analitico', { params }),
  resumo: (params) => api.get('/vendas-analitico/resumo', { params }),
};

export const precosApi = {
  list: (params) => api.get('/precos', { params }),
  resumo: (params) => api.get('/precos/resumo', { params }),
  ultimasEntradas: (codiprod) => api.get(`/precos/produtos/${encodeURIComponent(codiprod)}/ultimas-entradas`),
};

export const lojasApi = {
  list: () => api.get('/lojas'),
};

export const lojaInfoApi = {
  list: (params) => api.get('/loja-info', { params }),
  resumo: () => api.get('/loja-info/resumo'),
  get: (id) => api.get(`/loja-info/${id}`),
  create: (data) => api.post('/loja-info', data),
  update: (id, data) => api.put(`/loja-info/${id}`, data),
  delete: (id) => api.delete(`/loja-info/${id}`),
  uploadDocumento: (id, file, descricao) => {
    const fd = new FormData();
    fd.append('arquivo', file);
    if (descricao) fd.append('descricao', descricao);
    return api.post(`/loja-info/${id}/documentos`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  deleteDocumento: (id, docId) => api.delete(`/loja-info/${id}/documentos/${docId}`),
};

export const inboxApi = {
  list: () => api.get('/inbox/comprovantes'),
  vincular: (id, conta_pagar_id) => api.post(`/inbox/comprovantes/${id}/vincular`, { conta_pagar_id }),
  delete: (id) => api.delete(`/inbox/comprovantes/${id}`),
};

export const dashboardApi = {
  overview: (params) => api.get('/dashboard/overview', { params }),
  fluxoCaixa: (params) => api.get('/dashboard/fluxo-caixa', { params }),
};

export default api;
