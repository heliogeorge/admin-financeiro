import dayjs from 'dayjs';
import 'dayjs/locale/pt-br';

dayjs.locale('pt-br');

function toDisplayDate(value) {
  if (!value) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return dayjs(`${trimmed}T12:00:00`);
    }

    const isoDateMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})T/);
    if (isoDateMatch) {
      return dayjs(`${isoDateMatch[1]}T12:00:00`);
    }

    const brDateMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (brDateMatch) {
      return dayjs(`${brDateMatch[3]}-${brDateMatch[2]}-${brDateMatch[1]}T12:00:00`);
    }
  }

  return dayjs(value);
}

/**
 * Formata valor monetário em BRL
 */
export function formatCurrency(value) {
  if (value == null || isNaN(value)) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

/**
 * Formata data para exibição
 */
export function formatDate(date, format = 'DD/MM/YYYY') {
  if (!date) return '—';
  return toDisplayDate(date).format(format);
}

/**
 * Formata data relativa (hoje, ontem, etc.)
 */
export function formatDateRelative(date) {
  if (!date) return '—';
  const d = toDisplayDate(date);
  const today = dayjs().startOf('day');
  const diff = d.diff(today, 'day');

  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Amanhã';
  if (diff === -1) return 'Ontem';
  if (diff > 0 && diff <= 7) return `Em ${diff} dias`;
  if (diff < 0 && diff >= -7) return `${Math.abs(diff)} dias atrás`;
  return d.format('DD/MM/YYYY');
}

/**
 * Retorna classe CSS baseada no status
 */
export function getStatusBadge(status) {
  const map = {
    pendente: 'badge-pendente',
    pago: 'badge-pago',
    vencido: 'badge-vencido',
    cancelado: 'badge-cancelado',
  };
  return map[status] || 'badge-pendente';
}

/**
 * Retorna label do status
 */
export function getStatusLabel(status) {
  const map = {
    pendente: 'Pendente',
    pago: 'Pago',
    vencido: 'Vencido',
    cancelado: 'Cancelado',
  };
  return map[status] || status;
}

/**
 * Determina status baseado em data de vencimento e data de baixa
 * (para dados vindos do ERP que não tem campo status explícito)
 */
export function inferStatus(datavenc, databaix) {
  if (databaix) return 'pago';
  const venc = toDisplayDate(datavenc);
  if (venc.isBefore(dayjs(), 'day')) return 'vencido';
  return 'pendente';
}

/**
 * Gera datas padrão para filtros (mês atual)
 */
export function getDefaultDateRange() {
  return {
    dataInicio: dayjs().startOf('month').format('YYYY-MM-DD'),
    dataFim: dayjs().endOf('month').format('YYYY-MM-DD'),
  };
}

/**
 * Mapas de lojas (ajuste conforme seus códigos)
 */
export const LOJAS = {
  '1': 'VIVENDA',
  '2': 'EMBALATTI',
  '01': 'VIVENDA',
  '02': 'EMBALATTI',
};

export function getLojaName(codiloja) {
  const raw = String(codiloja ?? '').trim();
  const normalized = raw.replace(/^0+/, '') || raw;
  return LOJAS[raw] || LOJAS[normalized] || `Loja ${codiloja}`;
}

/**
 * Debounce function
 */
export function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Classnames helper
 */
export function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}

function mod10(digits) {
  let sum = 0;
  let weight = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    let product = parseInt(digits[i], 10) * weight;
    if (product > 9) product = Math.floor(product / 10) + (product % 10);
    sum += product;
    weight = weight === 2 ? 1 : 2;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Converte código de barras de boleto de cobrança (44 dígitos, FEBRABAN)
 * na linha digitável (47 dígitos). Retorna null se não for conversível.
 */
export function linhaDigitavelFromBarras(codigoBarras) {
  const barras = String(codigoBarras || '').replace(/\D/g, '');
  if (barras.length !== 44) return null;
  // Boleto de arrecadação (começa com 8) tem outro layout — não suportado aqui
  if (barras[0] === '8') return null;

  const banco = barras.slice(0, 3);
  const moeda = barras[3];
  const dvGeral = barras[4];
  const fatorValor = barras.slice(5, 19);
  const livre = barras.slice(19);

  const campo1 = banco + moeda + livre.slice(0, 5);
  const campo2 = livre.slice(5, 15);
  const campo3 = livre.slice(15, 25);

  return campo1 + mod10(campo1) + campo2 + mod10(campo2) + campo3 + mod10(campo3) + dvGeral + fatorValor;
}

/**
 * Linha digitável de um documento DDA: usa a armazenada ou deriva do código de barras.
 */
export function getLinhaDigitavel(doc) {
  const stored = String(doc?.linha_digitavel || '').replace(/\D/g, '');
  if (stored.length >= 47) return stored;
  return linhaDigitavelFromBarras(doc?.codigo_barras);
}

/**
 * Copia texto para a área de transferência, com fallback para http sem TLS
 * (produção roda em http://192.168.0.70, onde navigator.clipboard não existe).
 */
export async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // cai no fallback
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}
