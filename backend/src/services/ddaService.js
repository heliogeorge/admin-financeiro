const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { adminDb } = require('../config/database');

const CONTAS = 'contas_pagar';

const BANK_CODES = {
  '001': 'Banco do Brasil',
  '033': 'Santander',
  '041': 'Banrisul',
  '070': 'BRB',
  '077': 'Inter',
  '085': 'Cecred',
  '104': 'Caixa',
  '136': 'Unicred',
  '208': 'BTG Pactual',
  '212': 'Original',
  '237': 'Bradesco',
  '260': 'Nu Pagamentos',
  '290': 'PagSeguro',
  '318': 'BMG',
  '336': 'C6 Bank',
  '341': 'Itaú',
  '389': 'Mercantil',
  '393': 'Volkswagen',
  '422': 'Safra',
  '623': 'PAN',
  '633': 'Rendimento',
  '637': 'Sofisa',
  '655': 'Votorantim',
  '707': 'Daycoval',
  '735': 'Neon',
  '748': 'Sicredi',
  '756': 'Sicoob',
};

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toNumber(value) {
  return Math.round((parseFloat(value || 0) + Number.EPSILON) * 100) / 100;
}

function parseCurrencyBR(text = '') {
  const matches = text.match(/\d{1,3}(?:\.\d{3})*,\d{2}/g) || [];
  if (matches.length === 0) return null;

  const candidate = matches[matches.length - 1];
  const normalized = candidate.replace(/\./g, '').replace(',', '.');
  return toNumber(normalized);
}

function parseDateToken(text = '') {
  if (!text) return null;

  const brMatch = text.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (brMatch) {
    return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
  }

  const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    return isoMatch[0];
  }

  return null;
}

function sanitizeDigits(value = '') {
  return value.replace(/\D/g, '');
}

function guessBankFromCode(code) {
  if (!code) return null;
  const trimmed = String(code).trim();
  return BANK_CODES[trimmed] || BANK_CODES[trimmed.padStart(3, '0')] || null;
}

function guessCedente(lines) {
  const labeledLine = lines.find((line) => /cedente|beneficiario|fornecedor/i.test(line));
  if (labeledLine) {
    return labeledLine.split(/[:\-]/).slice(1).join(' ').trim() || labeledLine.trim();
  }

  const candidate = lines.find((line) => {
    const normalized = normalizeText(line);
    return normalized && normalized.length > 5 && !/\d{6,}/.test(line);
  });

  return candidate || null;
}

function guessBank(text) {
  // First try numeric bank code (e.g., "341" for Itaú)
  const codeMatch = text.match(/\b(\d{3})\b/);
  if (codeMatch) {
    const byCode = guessBankFromCode(codeMatch[1]);
    if (byCode) return byCode;
  }
  // Fall back to text name search
  const nameMatch = text.match(/\b(itau|bradesco|santander|sicredi|caixa|banco do brasil|bb|sicoob)\b/i);
  return nameMatch ? nameMatch[1] : null;
}

// ─── TSV (internet banking) format parser ────────────────────────────────────

/**
 * Returns true when the pasted text looks like a tab-separated table exported
 * from internet banking (each boleto is one tab-delimited row, CNPJ visible).
 */
function isTsvFormat(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  const linesWithTabs = lines.filter((l) => l.includes('\t')).length;
  const hasDocumento = lines.some((l) => {
    const cells = normalizeTsvCells(l);
    return cells.some((cell) => isDocumentCell(cell));
  });
  const hasDatesAndValue = lines.some((l) => {
    const cells = normalizeTsvCells(l);
    const dates = cells.filter((cell) => isDateCell(cell)).length;
    const values = cells.filter((cell) => isCurrencyCell(cell)).length;
    return dates >= 1 && values >= 1;
  });
  return linesWithTabs >= Math.ceil(lines.length * 0.5) && (hasDocumento || hasDatesAndValue);
}

/**
 * Parses one tab-separated line from internet banking.
 *
 * Expected column layout (CNPJ is the reliable anchor):
 *   ... | banco_code | CNPJ_cedente | cedente_nome | nosso_num? | tipo | status | data_venc | data_limite | valor | valor_pagar
 */
function parseTsvLine(line) {
  const cells = line
    .replace(/\r/g, '')
    .split('\t')
    .map((c) => c.replace(/\u00A0/g, ' ').trim());

  // CNPJ format XX.XXX.XXX/XXXX-XX is the most reliable anchor
  const cnpjPattern = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/;
  const cnpjIdx = cells.findIndex((c) => cnpjPattern.test(c));
  if (cnpjIdx < 0) return null;

  const cnpjCedente = cells[cnpjIdx];

  // Bank code is immediately before the CNPJ and may come as 1, 33, 104, etc.
  const bancoCodeRaw = cnpjIdx >= 1 ? cells[cnpjIdx - 1] : null;
  const bancoDigits = bancoCodeRaw ? sanitizeDigits(bancoCodeRaw) : '';
  const bancoCode = bancoDigits && bancoDigits.length <= 3 ? bancoDigits.padStart(3, '0') : null;
  const bancoNome = bancoCode ? (guessBankFromCode(bancoCode) || bancoCode) : null;

  // Cedente name is immediately after CNPJ
  const cedenteNome = cells[cnpjIdx + 1] || null;

  // Nosso número is after cedente name — may be empty or absent
  const nossoNumeroCandidato = cells[cnpjIdx + 2] || '';
  const isKeyword = /^(cobran[cç]a|d[eé]bito|a pagar|pago|vencido|liquidado)$/i.test(nossoNumeroCandidato);
  const nossoNumero = nossoNumeroCandidato && !isKeyword ? nossoNumeroCandidato : null;

  // Collect all dates (DD/MM/YYYY) that appear after the nosso_numero position
  const datePattern = /^\d{2}\/\d{2}\/\d{4}$/;
  const dates = cells.slice(cnpjIdx + 2).filter((c) => datePattern.test(c));
  // First date = data processamento; second date = data vencimento
  const dataVencimento = dates.length >= 2 ? dates[1] : (dates[0] || null);

  // Collect currency values (X.XXX,XX) after nosso_numero position
  const currencyPattern = /^\d{1,3}(?:\.\d{3})*,\d{2}$/;
  const values = cells.slice(cnpjIdx + 2).filter((c) => currencyPattern.test(c));
  const valorDoc = values.length > 0 ? parseCurrencyBR(values[0]) : null;

  const detailCells = cells.slice(cnpjIdx + 2);
  const keywordPatternFlex = /^(cobran[cç]a|d[eé]bito|a pagar|pago|vencido|liquidado)$/i;
  const parsedNossoNumero = detailCells.find((cell) => {
    if (!cell) return false;
    if (keywordPatternFlex.test(cell)) return false;
    if (datePattern.test(cell)) return false;
    if (currencyPattern.test(cell)) return false;
    return /[0-9]/.test(cell);
  }) || nossoNumero;
  const parsedDates = detailCells.filter((c) => datePattern.test(c));
  const parsedDataVencimento = parsedDates[0] || dataVencimento;
  const parsedValues = detailCells.filter((c) => currencyPattern.test(c));
  const parsedValorDoc = parsedValues.length > 0 ? parseCurrencyBR(parsedValues[0]) : valorDoc;

  if (!cedenteNome && parsedValorDoc === null) return null;

  return {
    banco: bancoNome,
    cedente_nome: cedenteNome,
    cedente_documento: sanitizeDigits(cnpjCedente),
    nosso_numero: parsedNossoNumero || null,
    data_vencimento: parsedDataVencimento ? parseDateToken(parsedDataVencimento) : null,
    valor_documento: parsedValorDoc,
    linha_digitavel: null,
    codigo_barras: null,
  };
}

function normalizeTsvCells(line) {
  return String(line || '')
    .replace(/\r/g, '')
    .split('\t')
    .map((c) => c.replace(/\u00A0/g, ' ').trim());
}

function isDocumentCell(value = '') {
  const digits = sanitizeDigits(value);
  return digits.length === 11 || digits.length === 14;
}

function isDateCell(value = '') {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(String(value || '').trim());
}

function isCurrencyCell(value = '') {
  return /^\d{1,3}(?:\.\d{3})*,\d{2}$/.test(String(value || '').trim());
}

function isKeywordCell(value = '') {
  return /^(cobran[cç]a|d[eé]bito|a pagar|pago|vencido|liquidado)$/i.test(String(value || '').trim());
}

function isBankCodeCell(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const digits = sanitizeDigits(raw);
  return digits.length >= 1 && digits.length <= 3 && digits === raw;
}

function isLikelySupplierCell(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (isKeywordCell(raw) || isDateCell(raw) || isCurrencyCell(raw) || isDocumentCell(raw) || isBankCodeCell(raw)) {
    return false;
  }
  return /[A-Za-zÀ-ÿ]/.test(raw) && normalizeText(raw).length >= 4;
}

function parseTsvLineFlexible(line) {
  const cells = normalizeTsvCells(line);
  const documentIdx = cells.findIndex((cell) => isDocumentCell(cell));
  if (documentIdx < 0) return null;

  const documento = sanitizeDigits(cells[documentIdx]);
  const bancoRaw = documentIdx >= 1 ? cells[documentIdx - 1] : '';
  const bancoDigits = sanitizeDigits(bancoRaw);
  const bancoCode = bancoDigits && bancoDigits.length <= 3 ? bancoDigits.padStart(3, '0') : null;
  const banco = bancoCode ? (guessBankFromCode(bancoCode) || bancoCode) : null;
  const cedenteNome = cells[documentIdx + 1] || null;
  const detailCells = cells.slice(documentIdx + 2);

  const nossoNumero = detailCells.find((cell) => {
    if (!cell) return false;
    if (isKeywordCell(cell) || isDateCell(cell) || isCurrencyCell(cell)) return false;
    return /[0-9]/.test(cell);
  }) || null;

  const dates = detailCells.filter(isDateCell);
  const values = detailCells.filter(isCurrencyCell);
  const dataVencimento = dates[0] ? parseDateToken(dates[0]) : null;
  const valorDocumento = values[0] ? parseCurrencyBR(values[0]) : null;

  if (!cedenteNome && valorDocumento === null) return null;

  return {
    banco,
    cedente_nome: cedenteNome,
    cedente_documento: documento || null,
    nosso_numero: nossoNumero,
    data_vencimento: dataVencimento,
    valor_documento: valorDocumento,
    linha_digitavel: null,
    codigo_barras: null,
  };
}

function parseTsvLineWithoutDocument(line) {
  const cells = normalizeTsvCells(line);
  const firstDateIdx = cells.findIndex((cell) => isDateCell(cell));
  const firstValueIdx = cells.findIndex((cell) => isCurrencyCell(cell));

  if (firstDateIdx < 0 || firstValueIdx < 0) return null;

  const bankIdx = cells.findIndex((cell, idx) => idx < firstDateIdx && isBankCodeCell(cell));
  const bancoCode = bankIdx >= 0 ? sanitizeDigits(cells[bankIdx]).padStart(3, '0') : null;
  const banco = bancoCode ? (guessBankFromCode(bancoCode) || bancoCode) : guessBank(line);

  const beforeDates = cells.slice(bankIdx >= 0 ? bankIdx + 1 : 0, firstDateIdx);
  const cedenteCandidates = beforeDates.filter((cell) => isLikelySupplierCell(cell));
  const cedenteNome = cedenteCandidates.sort((a, b) => b.length - a.length)[0] || null;

  const nossoNumero = beforeDates.find((cell) => {
    if (!cell) return false;
    if (isKeywordCell(cell) || isDateCell(cell) || isCurrencyCell(cell) || isDocumentCell(cell) || isBankCodeCell(cell)) {
      return false;
    }
    const digits = sanitizeDigits(cell);
    return digits.length >= 4 && digits.length === String(cell).trim().length;
  }) || null;

  const dates = cells.filter((cell) => isDateCell(cell));
  const values = cells.filter((cell) => isCurrencyCell(cell));
  const dataVencimento = dates[0] ? parseDateToken(dates[0]) : null;
  const valorDocumento = values[0] ? parseCurrencyBR(values[0]) : null;

  if (!cedenteNome || valorDocumento === null || !dataVencimento) return null;

  return {
    banco,
    cedente_nome: cedenteNome,
    cedente_documento: null,
    nosso_numero: nossoNumero ? sanitizeDigits(nossoNumero) || nossoNumero : null,
    data_vencimento: dataVencimento,
    valor_documento: valorDocumento,
    linha_digitavel: null,
    codigo_barras: null,
  };
}

function getTsvIgnoreReason(line) {
  const cells = normalizeTsvCells(line);
  if (cells.length <= 1) return 'sem_tabs';
  if (!cells.some((cell) => isDocumentCell(cell))) return 'sem_documento';
  if (!cells.some((cell) => isDateCell(cell))) return 'sem_data';
  if (!cells.some((cell) => isCurrencyCell(cell))) return 'sem_valor';
  return 'formato_nao_reconhecido';
}

function splitAndParseTsvDetailed(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const results = [];
  const ignored = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!line.includes('\t')) {
      ignored.push({ line, reason: 'sem_tabs' });
      continue;
    }

    const parsed = parseTsvLineFlexible(line) || parseTsvLineWithoutDocument(line) || parseTsvLine(line);
    if (!parsed || (!parsed.cedente_nome && !parsed.cedente_documento)) {
      ignored.push({ line, reason: getTsvIgnoreReason(line) });
      continue;
    }

    const hashBase = [
      parsed.cedente_documento || '',
      parsed.nosso_numero || '',
      parsed.data_vencimento || '',
      String(parsed.valor_documento || ''),
    ].join('|');

    results.push({
      ...parsed,
      status: 'novo',
      texto_original: line,
      hash_documento: crypto.createHash('md5').update(hashBase || line).digest('hex'),
    });
  }

  return { results, ignored };
}

/**
 * Splits and parses all tab-separated boleto lines from the pasted text.
 * Returns an array of parsed boleto objects ready for insertion.
 */
function splitAndParseTsv(text) {
  return splitAndParseTsvDetailed(text).results;
}

// ─── Itaú xlsx (DDA_ConsultaBoletosRecebidos) parser ─────────────────────────

function excelSerialToIso(serial) {
  const ms = Math.round((serial - 25569) * 86400000);
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function xlsxCellText(raw) {
  if (raw === null || raw === undefined) return '';
  if (raw instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(raw.getUTCDate())}/${pad(raw.getUTCMonth() + 1)}/${raw.getUTCFullYear()}`;
  }
  if (typeof raw === 'object') {
    if (Array.isArray(raw.richText)) return raw.richText.map((r) => r.text || '').join('').trim();
    if (raw.text !== undefined) return String(raw.text).trim();
    if (raw.result !== undefined) return xlsxCellText(raw.result);
    return '';
  }
  return String(raw).trim();
}

function parseXlsxValor(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return toNumber(raw);
  const text = xlsxCellText(raw);
  if (!text) return null;
  if (/,\d{2}\s*$/.test(text)) return parseCurrencyBR(text);
  const num = parseFloat(text.replace(/[^\d.-]/g, ''));
  return Number.isFinite(num) ? toNumber(num) : null;
}

function parseXlsxData(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  if (typeof raw === 'number') return excelSerialToIso(raw);
  return parseDateToken(xlsxCellText(raw));
}

const XLSX_HEADER_MAP = [
  { key: 'pagador', pattern: /pagador/ },
  { key: 'cedente_nome', pattern: /beneficiari/ },
  { key: 'cedente_documento', pattern: /cpf|cnpj/ },
  { key: 'data_vencimento', pattern: /^venc/ },
  { key: 'nosso_numero', pattern: /n.{0,2}doc|nosso/ },
  { key: 'valor_documento', pattern: /ate venc/ },
  { key: 'valor_a_pagar', pattern: /a pagar/ },
  { key: 'tipo', pattern: /tipo/ },
  { key: 'banco', pattern: /^banco/ },
  { key: 'codigo_barras', pattern: /barras/ },
];

function matchXlsxHeader(cells) {
  const normalized = cells.map((cell) => normalizeText(xlsxCellText(cell)));
  if (!normalized.some((c) => /beneficiari/.test(c)) || !normalized.some((c) => /^venc/.test(c))) {
    return null;
  }
  const columns = {};
  normalized.forEach((cell, idx) => {
    if (!cell) return;
    for (const { key, pattern } of XLSX_HEADER_MAP) {
      if (columns[key] === undefined && pattern.test(cell)) {
        columns[key] = idx;
        break;
      }
    }
  });
  return (columns.cedente_nome !== undefined && columns.data_vencimento !== undefined) ? columns : null;
}

/**
 * Parses the Itaú "Consulta Boletos Recebidos" xlsx export (DDA).
 * Header row holds: Pagador/Agregado | Beneficiário | CPF/CNPJ | Venc. |
 * Nº Doc. | Até Venc. | A Pagar | Tipo de Boleto | Banco | Observações | Código de barras
 */
async function parseXlsxBoletosDetailed(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { results: [], ignored: [] };

  let columns = null;
  const results = [];
  const ignored = [];

  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cells[colNumber - 1] = cell.value;
    });

    if (!columns) {
      columns = matchXlsxHeader(cells);
      return;
    }

    const get = (key) => (columns[key] !== undefined ? cells[columns[key]] : undefined);
    const textoOriginal = cells.map((c) => xlsxCellText(c)).join(' | ').trim();
    if (!textoOriginal) return;

    const cedenteNome = xlsxCellText(get('cedente_nome')) || null;
    const cedenteDocumento = sanitizeDigits(xlsxCellText(get('cedente_documento'))) || null;
    const dataVencimento = parseXlsxData(get('data_vencimento'));
    const valorDocumento = parseXlsxValor(get('valor_documento')) ?? parseXlsxValor(get('valor_a_pagar'));
    const nossoNumero = xlsxCellText(get('nosso_numero')) || null;
    const bancoCode = sanitizeDigits(xlsxCellText(get('banco')));
    const banco = bancoCode ? (guessBankFromCode(bancoCode.padStart(3, '0')) || bancoCode) : null;
    const barrasDigits = sanitizeDigits(xlsxCellText(get('codigo_barras')));
    const codigoBarras = barrasDigits.length >= 44 ? barrasDigits.slice(0, 48) : null;

    if (!cedenteNome && !cedenteDocumento) {
      ignored.push({ line: textoOriginal, reason: 'sem_cedente' });
      return;
    }
    if (valorDocumento === null) {
      ignored.push({ line: textoOriginal, reason: 'sem_valor' });
      return;
    }
    if (!dataVencimento) {
      ignored.push({ line: textoOriginal, reason: 'sem_data' });
      return;
    }

    // Barcode uniquely identifies the boleto (two real boletos can share
    // cedente+venc+valor, e.g. the same monthly fee billed to two companies).
    // The TSV-era composite hash is kept as hash_legado so re-importing the
    // same boleto previously pasted as text still counts as duplicate.
    const legacyHashBase = [
      cedenteDocumento || '',
      nossoNumero || '',
      dataVencimento || '',
      String(valorDocumento || ''),
    ].join('|');
    const legacyHash = crypto.createHash('md5').update(legacyHashBase || textoOriginal).digest('hex');
    const hashDocumento = codigoBarras
      ? crypto.createHash('md5').update(codigoBarras).digest('hex')
      : legacyHash;

    results.push({
      banco,
      cedente_nome: cedenteNome,
      cedente_documento: cedenteDocumento,
      nosso_numero: nossoNumero,
      data_vencimento: dataVencimento,
      valor_documento: valorDocumento,
      linha_digitavel: null,
      codigo_barras: codigoBarras,
      status: 'novo',
      texto_original: textoOriginal,
      hash_documento: hashDocumento,
      hash_legado: hashDocumento !== legacyHash ? legacyHash : null,
    });
  });

  if (!columns) {
    return {
      results: [],
      ignored: [{ line: '', reason: 'cabecalho_nao_encontrado' }],
    };
  }

  return { results, ignored };
}

// ─── Traditional DDA block parser ────────────────────────────────────────────

function splitBlocks(text = '') {
  const normalizedText = text.replace(/\r/g, '').trim();
  if (!normalizedText) return [];

  const explicitBlocks = normalizedText
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (explicitBlocks.length > 1) return explicitBlocks;

  const lines = normalizedText.split('\n').map((line) => line.trim()).filter(Boolean);
  const groups = [];
  let current = [];

  for (const line of lines) {
    const hasLongDigits = sanitizeDigits(line).length >= 44;
    if (hasLongDigits && current.length > 0) {
      groups.push(current.join('\n'));
      current = [line];
      continue;
    }
    current.push(line);
  }

  if (current.length > 0) groups.push(current.join('\n'));
  return groups.filter(Boolean);
}

function parseBlock(block) {
  const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
  const digitsCandidates = lines
    .map((line) => sanitizeDigits(line))
    .filter((digits) => digits.length >= 44);

  const digits = digitsCandidates[0] || '';
  const linhaDigitavel = digits.length >= 47 ? digits : null;
  const codigoBarras = digits.length >= 44 ? digits.slice(0, 48) : null;

  const valor = parseCurrencyBR(block) || 0;
  const dataVencimento = parseDateToken(block);
  const nossoNumeroMatch = block.match(/nosso\s*num(?:ero)?\s*[:\-]?\s*([0-9.\-/]+)/i);
  const documentoMatch = block.match(/(cnpj|cpf)\s*[:\-]?\s*([0-9./-]+)/i);

  const hashBase = linhaDigitavel || codigoBarras || normalizeText(block);
  const hashDocumento = crypto.createHash('md5').update(hashBase).digest('hex');

  return {
    linha_digitavel: linhaDigitavel,
    codigo_barras: codigoBarras,
    nosso_numero: nossoNumeroMatch ? nossoNumeroMatch[1] : null,
    banco: guessBank(block),
    cedente_nome: guessCedente(lines),
    cedente_documento: documentoMatch ? sanitizeDigits(documentoMatch[2]) : null,
    valor_documento: valor,
    data_vencimento: dataVencimento,
    texto_original: block,
    hash_documento: hashDocumento,
    status: 'novo',
  };
}

// ─── Matching / scoring ───────────────────────────────────────────────────────

function scoreSupplier(ddaName, contaName) {
  const a = normalizeText(ddaName);
  const b = normalizeText(contaName);
  if (!a || !b) return 0;
  if (a === b) return 25;
  if (a.includes(b) || b.includes(a)) return 18;

  const aTokens = new Set(a.split(' '));
  const bTokens = new Set(b.split(' '));
  const overlap = [...aTokens].filter((token) => bTokens.has(token) && token.length > 2).length;
  return Math.min(15, overlap * 5);
}

function scoreDate(ddaDate, contaDate) {
  if (!ddaDate || !contaDate) return 0;
  const dda = new Date(ddaDate);
  const conta = new Date(contaDate);
  const diffDays = Math.abs(Math.round((dda - conta) / 86400000));

  if (diffDays === 0) return 20;
  if (diffDays <= 3) return 14;
  if (diffDays <= 7) return 10;
  if (diffDays <= 15) return 6;
  return 0;
}

function scoreValue(ddaValue, contaValue) {
  const diff = Math.abs(toNumber(ddaValue) - toNumber(contaValue));
  if (diff < 0.01) return 45;
  if (diff <= 1) return 35;
  if (diff <= 5) return 28;
  if (diff <= Math.max(10, toNumber(ddaValue) * 0.03)) return 18;
  return 0;
}

function scoreDocumentMatch(dda, conta) {
  const docs = [
    sanitizeDigits(dda.linha_digitavel || ''),
    sanitizeDigits(dda.codigo_barras || ''),
    sanitizeDigits(dda.nosso_numero || ''),
    sanitizeDigits(dda.cedente_documento || ''),
  ].filter(Boolean);

  const accountFields = [
    sanitizeDigits(conta.linha_digitavel || ''),
    sanitizeDigits(conta.codigo_barras || ''),
    sanitizeDigits(conta.nosso_numero || ''),
    sanitizeDigits(conta.documento || ''),
  ].filter(Boolean);

  if (docs.length === 0 || accountFields.length === 0) return 0;
  const matched = docs.some((doc) => accountFields.some((field) => field && (field.includes(doc) || doc.includes(field))));
  return matched ? 30 : 0;
}

function buildContaScore(dda, conta) {
  return (
    scoreValue(dda.valor_documento, conta.valor) +
    scoreDate(dda.data_vencimento, conta.data_vencimento) +
    scoreSupplier(dda.cedente_nome, conta.fornecedor) +
    scoreDocumentMatch(dda, conta)
  );
}

async function suggestContasForDda(dda, { limit = 8 } = {}) {
  let query = adminDb(CONTAS)
    .select(
      'id',
      'fornecedor',
      'valor',
      'data_vencimento',
      'status',
      'origem',
      'documento',
      'historico',
      'erp_lancamento',
      'erp_fornecedor_id',
      'linha_digitavel',
      'codigo_barras',
      'nosso_numero',
      'natureza',
      'status_conciliacao'
    )
    .where('status', '!=', 'cancelado');

  if (dda.data_vencimento) {
    const baseDate = new Date(dda.data_vencimento);
    const start = new Date(baseDate.getTime() - (45 * 86400000)).toISOString().slice(0, 10);
    const end = new Date(baseDate.getTime() + (45 * 86400000)).toISOString().slice(0, 10);
    query = query.whereBetween('data_vencimento', [start, end]);
  }

  const contas = await query.limit(250);
  return contas
    .map((conta) => ({
      ...conta,
      score: buildContaScore(dda, conta),
    }))
    .filter((conta) => conta.score >= 18)
    .sort((a, b) => b.score - a.score || new Date(a.data_vencimento || 0) - new Date(b.data_vencimento || 0))
    .slice(0, limit);
}

module.exports = {
  normalizeText,
  toNumber,
  parseCurrencyBR,
  parseDateToken,
  sanitizeDigits,
  isTsvFormat,
  splitAndParseTsv,
  splitAndParseTsvDetailed,
  parseXlsxBoletosDetailed,
  splitBlocks,
  parseBlock,
  suggestContasForDda,
  guessBankFromCode,
};
