/**
 * Cadastro de Fornecedores (F2 da remodelagem do Contas a Pagar).
 *
 * Espelho do CADFOR do ERP: o sync faz upsert por codiforn dos campos-base
 * (nome, razão, CNPJ, cidade...) e NUNCA toca nos campos de regra do app
 * (aliases, complemento_*). Depois do upsert, amarra contas_pagar.fornecedor_id
 * pelas contas que têm erp_fornecedor_id.
 */
const { erpDb, adminDb } = require('../config/database');

const CADFOR = 'CADFOR';
const TABLE = 'fornecedores';

function normalizeCodiforn(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  // ERP guarda decimal(6,0) → vem '64', '64.0' etc.; contas usam string simples
  const n = Number(s);
  return Number.isFinite(n) ? String(Math.trunc(n)) : s;
}

function pickMelhorCadastro(rows) {
  // codiforn pode existir em mais de uma loja; prefere situacao 'A' e loja menor
  return [...rows].sort((a, b) => {
    const ativoA = a.situacao === 'A' ? 0 : 1;
    const ativoB = b.situacao === 'A' ? 0 : 1;
    if (ativoA !== ativoB) return ativoA - ativoB;
    return String(a.codiloja || '').localeCompare(String(b.codiloja || ''));
  })[0];
}

async function syncFornecedores({ username = 'system' } = {}) {
  const stats = { total_erp: 0, inserted: 0, updated: 0, unchanged: 0, contas_vinculadas: 0 };

  const erpRows = await erpDb(CADFOR).select(
    'codiloja', 'codiforn', 'situacao', 'nomeforn', 'razaforn',
    'cgc_forn', 'cidaforn', 'estaforn', 'foneforn', 'emaiforn'
  );

  // dedupe por codiforn
  const porCodiforn = new Map();
  for (const row of erpRows) {
    const codiforn = normalizeCodiforn(row.codiforn);
    if (!codiforn) continue;
    if (!porCodiforn.has(codiforn)) porCodiforn.set(codiforn, []);
    porCodiforn.get(codiforn).push(row);
  }
  stats.total_erp = porCodiforn.size;

  const existentes = await adminDb(TABLE).select(
    'id', 'codiforn', 'nome', 'razao_social', 'cnpj_cpf',
    'cidade', 'uf', 'telefone', 'email', 'situacao_erp'
  );
  const existentesMap = new Map(existentes.map((f) => [f.codiforn, f]));

  const agora = new Date();
  for (const [codiforn, rows] of porCodiforn) {
    const erp = pickMelhorCadastro(rows);
    const base = {
      nome: (erp.nomeforn || `Fornecedor ${codiforn}`).trim(),
      razao_social: (erp.razaforn || '').trim() || null,
      cnpj_cpf: (erp.cgc_forn || '').trim() || null,
      cidade: (erp.cidaforn || '').trim() || null,
      uf: (erp.estaforn || '').trim() || null,
      telefone: (erp.foneforn || '').trim() || null,
      email: (erp.emaiforn || '').trim() || null,
      situacao_erp: erp.situacao || null,
    };

    const existente = existentesMap.get(codiforn);
    if (!existente) {
      await adminDb(TABLE).insert({
        codiforn,
        ...base,
        ultima_sync_at: agora,
        atualizado_por: username,
      });
      stats.inserted += 1;
    } else {
      const mudou = Object.keys(base).some((k) => (existente[k] || null) !== (base[k] || null));
      if (mudou) {
        await adminDb(TABLE).where('id', existente.id).update({
          ...base,
          ultima_sync_at: agora,
          atualizado_em: agora,
          atualizado_por: username,
        });
        stats.updated += 1;
      } else {
        stats.unchanged += 1;
      }
    }
  }

  // amarra contas_pagar.fornecedor_id pelo codiforn (só onde ainda está nulo)
  stats.contas_vinculadas = await adminDb.raw(`
    UPDATE contas_pagar cp
    JOIN fornecedores f ON f.codiforn = cp.erp_fornecedor_id
    SET cp.fornecedor_id = f.id
    WHERE cp.fornecedor_id IS NULL AND cp.erp_fornecedor_id IS NOT NULL
  `).then(([r]) => r.affectedRows || 0);

  return stats;
}

async function listFornecedores({ q = null, ativo = null, com_regra = null, page = 1, perPage = 50 } = {}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(perPage, 10) || 50));

  function applyFilters(query) {
    if (q) {
      query = query.where((b) => {
        b.where('nome', 'like', `%${q}%`)
          .orWhere('razao_social', 'like', `%${q}%`)
          .orWhere('codiforn', q)
          .orWhere('cnpj_cpf', 'like', `%${q}%`);
      });
    }
    if (ativo === 'true') query = query.where('ativo', true);
    if (ativo === 'false') query = query.where('ativo', false);
    if (com_regra === 'true') query = query.whereNot('complemento_tipo', 'nenhum');
    return query;
  }

  const countRow = await applyFilters(adminDb(TABLE)).count('* as total').first();
  const data = await applyFilters(adminDb(TABLE))
    .select('*')
    .orderBy('nome', 'asc')
    .limit(pageSize)
    .offset((pageNum - 1) * pageSize);

  // contas em aberto por fornecedor (só dos da página)
  if (data.length > 0) {
    const ids = data.map((f) => f.id);
    const abertos = await adminDb('contas_pagar')
      .select('fornecedor_id')
      .whereIn('fornecedor_id', ids)
      .whereIn('status', ['pendente', 'vencido'])
      .sum('saldo_aberto as saldo')
      .count('* as qtd')
      .groupBy('fornecedor_id');
    const mapa = abertos.reduce((acc, r) => { acc[r.fornecedor_id] = r; return acc; }, {});
    for (const f of data) {
      f.contas_abertas = Number(mapa[f.id]?.qtd || 0);
      f.saldo_aberto = Number(mapa[f.id]?.saldo || 0);
    }
  }

  return {
    data,
    pagination: {
      page: pageNum,
      perPage: pageSize,
      total: Number(countRow.total),
      totalPages: Math.ceil(Number(countRow.total) / pageSize) || 1,
    },
  };
}

// Campos que o app pode editar (regras) — o resto é espelho do ERP
const CAMPOS_REGRA = [
  'aliases', 'complemento_tipo', 'complemento_fator', 'complemento_base',
  'complemento_vencimento', 'complemento_dias', 'complemento_obs',
  'complemento_desde', 'ativo',
];

async function updateRegras(id, payload, username) {
  const fornecedor = await adminDb(TABLE).where('id', id).first();
  if (!fornecedor) return null;

  const updates = {};
  for (const campo of CAMPOS_REGRA) {
    if (payload[campo] !== undefined) updates[campo] = payload[campo];
  }

  if (updates.complemento_tipo === 'fator') {
    const fator = Number(updates.complemento_fator ?? fornecedor.complemento_fator);
    if (!Number.isFinite(fator) || fator <= 0) {
      throw Object.assign(new Error('Informe um fator maior que zero (ex.: 0.30 = +30%).'), { status: 400 });
    }
  }
  if (updates.complemento_tipo === 'nenhum') {
    updates.complemento_fator = null;
    updates.complemento_dias = null;
  }
  // Ao ligar uma regra sem data de corte, só vale de hoje em diante:
  // nada de gerar "por fora" retroativo para notas antigas já acertadas.
  const tipoFinal = updates.complemento_tipo ?? fornecedor.complemento_tipo;
  const desdeFinal = updates.complemento_desde !== undefined
    ? updates.complemento_desde
    : fornecedor.complemento_desde;
  if (tipoFinal !== 'nenhum' && !desdeFinal) {
    updates.complemento_desde = new Date().toISOString().slice(0, 10);
  }
  if ((updates.complemento_vencimento ?? fornecedor.complemento_vencimento) === 'data_fixa') {
    const dias = Number(updates.complemento_dias ?? fornecedor.complemento_dias);
    const tipo = updates.complemento_tipo ?? fornecedor.complemento_tipo;
    if (tipo !== 'nenhum' && (!Number.isFinite(dias) || dias < 0)) {
      throw Object.assign(new Error('Informe os dias após a entrada para o vencimento em data fixa.'), { status: 400 });
    }
  }

  if (Object.keys(updates).length > 0) {
    updates.atualizado_em = new Date();
    updates.atualizado_por = username;
    await adminDb(TABLE).where('id', id).update(updates);
  }
  return adminDb(TABLE).where('id', id).first();
}

module.exports = { syncFornecedores, listFornecedores, updateRegras, CAMPOS_REGRA };
