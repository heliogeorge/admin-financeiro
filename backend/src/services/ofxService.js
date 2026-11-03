/**
 * Parser simples de OFX (Open Financial Exchange).
 *
 * OFX pode vir em XML (>= 2.x) ou SGML (1.x). Aqui aceitamos ambos: antes
 * de processar, normalizamos tags auto-fechantes do SGML (<TAG>valor) para
 * XML (<TAG>valor</TAG>).
 */

function normalizeSgmlToXml(ofxText) {
  // SGML: <TAG>valor sem fechamento. Converte para <TAG>valor</TAG>.
  // A regex captura TAG e valor (não permitindo < ou >) numa mesma linha.
  return ofxText.replace(/<([A-Z0-9.]+)>([^<\r\n]+)/g, (m, tag, val) => {
    // se já for fechado em outra linha (tag com children), deixa
    if (val.trim() === '') return m;
    return `<${tag}>${val.trim()}</${tag}>`;
  });
}

function stripHeader(ofxText) {
  // Remove cabeçalho SGML antes do <OFX>
  const idx = ofxText.indexOf('<OFX>');
  return idx >= 0 ? ofxText.slice(idx) : ofxText;
}

function extractAll(xml, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function extractOne(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : null;
}

function parseOfxDate(raw) {
  if (!raw) return null;
  // Formato: YYYYMMDDHHMMSS[.xxx][tz]
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function parseOfx(ofxText) {
  const xml = stripHeader(normalizeSgmlToXml(ofxText));

  const bankAcct = extractOne(xml, 'ACCTID');
  const bankId = extractOne(xml, 'BANKID');
  const branchId = extractOne(xml, 'BRANCHID');
  const acctType = extractOne(xml, 'ACCTTYPE');

  const transactions = extractAll(xml, 'STMTTRN').map((blk) => {
    const valor = parseFloat(extractOne(blk, 'TRNAMT') || '0');
    return {
      fit_id: extractOne(blk, 'FITID'),
      data: parseOfxDate(extractOne(blk, 'DTPOSTED')),
      tipo: valor < 0 ? 'debito' : 'credito',
      valor: Math.abs(valor),
      descricao: extractOne(blk, 'MEMO') || extractOne(blk, 'NAME') || '',
      documento: extractOne(blk, 'CHECKNUM') || extractOne(blk, 'REFNUM') || null,
      trntype: extractOne(blk, 'TRNTYPE'),
    };
  });

  return {
    conta: {
      acctid: bankAcct,
      bankid: bankId,
      branchid: branchId,
      acctType,
    },
    transactions,
  };
}

module.exports = { parseOfx };
