const { erpDb, adminDb } = require('../config/database');
const crypto = require('crypto');

const PAGAME_TABLE = 'PAGAME';
const CADFOR_TABLE = 'CADFOR';
const CONTAS_TABLE = 'contas_pagar';
const COL_FORNECEDOR = 'fornclie';

/**
 * Gera hash dos campos do ERP para detectar mudanças
 */
function generateHash(row) {
  const data = [
    row.valorent, row.datavenc, row.databaix,
    row.valordes, row.valorjur, row.banbaixa, row.docbaixa,
  ].join('|');
  return crypto.createHash('md5').update(data).digest('hex');
}

/**
 * Determina o status baseado nos dados do ERP
 */
function inferStatus(row) {
  if (row.databaix) return 'pago';
  const venc = new Date(row.datavenc);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  if (venc < hoje) return 'vencido';
  return 'pendente';
}

function buildFinanceSnapshot(status, value) {
  const numericValue = parseFloat(value) || 0;
  return {
    valor_pago: status === 'pago' ? numericValue : 0,
    saldo_aberto: ['pago', 'cancelado'].includes(status) ? 0 : numericValue,
    status_conciliacao: 'sem_itens',
  };
}

const RELREC_TABLE = 'RELREC';
const ENTRADAS_TABLE = 'entradas_mercadoria';

function generateEntradaHash(row) {
  const data = [
    row.totalpro, row.totalfat, row.totaicms, row.totalipi,
    row.valorfre, row.valorseg, row.desconto,
  ].join('|');
  return crypto.createHash('md5').update(data).digest('hex');
}

function normalizeKeyPart(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function buildEntradaKey(row) {
  return [
    normalizeKeyPart(row.numerorr),
    normalizeKeyPart(row.codiempr),
    normalizeKeyPart(row.codiloja),
  ].join('|');
}

function buildEntradaLegacyKey(row) {
  return [
    normalizeKeyPart(row.numerorr),
    normalizeKeyPart(row.codiempr),
  ].join('|');
}

function toCurrency(value) {
  return Math.round((parseFloat(value || 0) + Number.EPSILON) * 100) / 100;
}

function sameEntradaFromLegacyKey(existing, row, hash) {
  const sameNfe = normalizeKeyPart(row.nfe_chav)
    && normalizeKeyPart(row.nfe_chav) === normalizeKeyPart(existing.nfe_chav);
  if (sameNfe) return true;

  const sameBasicIdentity = normalizeKeyPart(row.numeronf) === normalizeKeyPart(existing.numeronf)
    && normalizeKeyPart(row.codiforn) === normalizeKeyPart(existing.codiforn)
    && normalizeKeyPart(row.dataemis) === normalizeKeyPart(existing.data_emissao);

  if (!sameBasicIdentity) return false;

  const sameValue = Math.abs(toCurrency(row.totalfat) - toCurrency(existing.total_faturado)) < 0.01;
  return sameValue || existing.sync_hash === hash;
}

const SyncService = {
  /**
   * Sincroniza lançamentos do PAGAME para o banco admin
   * 
   * Lógica:
   * 1. Lê todos os registros do PAGAME (com filtro opcional)
   * 2. Para cada registro, verifica se já existe no admin (por lancamen + codiempr)
   * 3. Se não existe → INSERT
   * 4. Se existe → UPDATE apenas campos do ERP (preserva dados manuais como categoria, comprovante, etc)
   * 5. Retorna estatísticas da sync
   */
  async syncPagame({ codiloja = null, dataInicio = null, dataFim = null, username = 'system' } = {}) {
    const startTime = Date.now();
    const stats = { total: 0, inserted: 0, updated: 0, unchanged: 0, errors: 0 };

    // 1. Buscar registros do ERP
    let erpQuery = erpDb(PAGAME_TABLE)
      .select(`${PAGAME_TABLE}.*`, `${CADFOR_TABLE}.nomeforn`)
      .leftJoin(CADFOR_TABLE, `${PAGAME_TABLE}.${COL_FORNECEDOR}`, `${CADFOR_TABLE}.codiforn`);

    if (codiloja) erpQuery = erpQuery.where(`${PAGAME_TABLE}.codiloja`, codiloja);
    if (dataInicio) erpQuery = erpQuery.where(`${PAGAME_TABLE}.datavenc`, '>=', dataInicio);
    if (dataFim) erpQuery = erpQuery.where(`${PAGAME_TABLE}.datavenc`, '<=', dataFim);

    const erpRecords = await erpQuery;
    stats.total = erpRecords.length;

    console.log(`🔄 Sync: ${stats.total} registros do ERP para processar...`);

    // 2. Buscar registros existentes no admin (para comparar)
    const existingRecords = await adminDb(CONTAS_TABLE)
      .select('id', 'erp_lancamento', 'codiempr', 'sync_hash')
      .where('origem', 'erp')
      .whereNotNull('erp_lancamento');

    // Mapa para lookup rápido
    const existingMap = new Map();
    for (const rec of existingRecords) {
      const key = `${rec.erp_lancamento}|${rec.codiempr}`;
      existingMap.set(key, rec);
    }

    // 3. Processar cada registro
    const batchInserts = [];
    const batchUpdates = [];

    for (const row of erpRecords) {
      try {
        const key = `${row.lancamen}|${row.codiempr}`;
        const hash = generateHash(row);
        const existing = existingMap.get(key);

        if (!existing) {
          const status = inferStatus(row);
          // Novo registro → INSERT
          batchInserts.push({
            origem: 'erp',
            natureza: 'nao_classificada',
            fornecedor: row.nomeforn || `Fornecedor ${row[COL_FORNECEDOR] || 'desconhecido'}`,
            descricao: null,
            documento: row.document || null,
            historico: row.historic || null,
            referencia: row.referenc || null,
            valor: row.valorent || 0,
            valor_desconto: row.valordes || 0,
            valor_juros: row.valorjur || 0,
            data_vencimento: row.datavenc,
            data_emissao: row.dataemis || null,
            data_pagamento: row.databaix || null,
            status,
            codiloja: row.codiloja,
            codiempr: row.codiempr,
            erp_lancamento: row.lancamen,
            erp_fornecedor_id: row[COL_FORNECEDOR] || null,
            banco_baixa: row.banbaixa || null,
            doc_baixa: row.docbaixa || null,
            forma_pagamento: null,
            categoria_id: null,
            comprovante_path: null,
            observacoes: null,
            sync_hash: hash,
            ultima_sync_at: new Date(),
            criado_por: username,
            ...buildFinanceSnapshot(status, row.valorent),
          });
          stats.inserted++;
        } else if (existing.sync_hash !== hash) {
          const status = inferStatus(row);
          // Registro existente com mudanças → UPDATE (só campos do ERP)
          batchUpdates.push({
            id: existing.id,
            data: {
              fornecedor: row.nomeforn || `Fornecedor ${row[COL_FORNECEDOR] || 'desconhecido'}`,
              documento: row.document || null,
              historico: row.historic || null,
              referencia: row.referenc || null,
              valor: row.valorent || 0,
              valor_desconto: row.valordes || 0,
              valor_juros: row.valorjur || 0,
              data_vencimento: row.datavenc,
              data_emissao: row.dataemis || null,
              data_pagamento: row.databaix || null,
              status,
              banco_baixa: row.banbaixa || null,
              doc_baixa: row.docbaixa || null,
              sync_hash: hash,
              ultima_sync_at: new Date(),
              atualizado_por: username,
              ...buildFinanceSnapshot(status, row.valorent),
            },
          });
          stats.updated++;
        } else {
          stats.unchanged++;
        }
      } catch (err) {
        console.error(`❌ Erro ao processar lancamento ${row.lancamen}:`, err.message);
        stats.errors++;
      }
    }

    // 4. Executar em batch
    if (batchInserts.length > 0) {
      // Inserir em chunks de 100 para não sobrecarregar
      const chunkSize = 100;
      for (let i = 0; i < batchInserts.length; i += chunkSize) {
        const chunk = batchInserts.slice(i, i + chunkSize);
        await adminDb(CONTAS_TABLE).insert(chunk);
      }
    }

    for (const update of batchUpdates) {
      await adminDb(CONTAS_TABLE).where('id', update.id).update(update.data);
    }

    // 5. Atualizar status de vencidos (contas pendentes com data passada)
    const hoje = new Date().toISOString().slice(0, 10);
    await adminDb(CONTAS_TABLE)
      .where('status', 'pendente')
      .where('data_vencimento', '<', hoje)
      .update({ status: 'vencido' });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`✅ Sync concluída em ${elapsed}s:`);
    console.log(`   → ${stats.inserted} novos | ${stats.updated} atualizados | ${stats.unchanged} sem mudança | ${stats.errors} erros`);

    return {
      ...stats,
      elapsed: parseFloat(elapsed),
      timestamp: new Date().toISOString(),
    };
  },

  /**
   * Sincroniza RELREC → entradas_mercadoria
   */
  async syncRelrec({ codiloja = null, dataInicio = null, dataFim = null, username = 'system' } = {}) {
    const startTime = Date.now();
    const stats = { total: 0, inserted: 0, updated: 0, repairedStore: 0, unchanged: 0, errors: 0 };

    let erpQuery = erpDb(RELREC_TABLE)
      .select(`${RELREC_TABLE}.*`, `${CADFOR_TABLE}.nomeforn`)
      .leftJoin(CADFOR_TABLE, `${RELREC_TABLE}.codiforn`, `${CADFOR_TABLE}.codiforn`);

    if (codiloja) erpQuery = erpQuery.where(`${RELREC_TABLE}.codiloja`, codiloja);
    if (dataInicio) erpQuery = erpQuery.where(`${RELREC_TABLE}.dataemis`, '>=', dataInicio);
    if (dataFim) erpQuery = erpQuery.where(`${RELREC_TABLE}.dataemis`, '<=', dataFim);

    const erpRecords = await erpQuery;
    stats.total = erpRecords.length;

    const erpLegacyKeyCounts = new Map();
    for (const row of erpRecords) {
      const legacyKey = buildEntradaLegacyKey(row);
      erpLegacyKeyCounts.set(legacyKey, (erpLegacyKeyCounts.get(legacyKey) || 0) + 1);
    }

    console.log(`🔄 Sync Entradas: ${stats.total} registros do ERP...`);

    const existing = await adminDb(ENTRADAS_TABLE)
      .select(
        'id',
        'numerorr',
        'codiempr',
        'codiloja',
        'sync_hash',
        'nfe_chav',
        'numeronf',
        'codiforn',
        'data_emissao',
        'total_faturado',
      )
      .where('origem', 'erp')
      .whereNotNull('numerorr');

    const existingMap = new Map();
    const legacyMap = new Map();
    for (const rec of existing) {
      existingMap.set(buildEntradaKey(rec), rec);

      const legacyKey = buildEntradaLegacyKey(rec);
      if (!legacyMap.has(legacyKey)) legacyMap.set(legacyKey, []);
      legacyMap.get(legacyKey).push(rec);
    }

    const batchInserts = [];
    const batchUpdates = [];
    const claimedExistingIds = new Set();
    const seenExactKeys = new Set(existingMap.keys());

    for (const row of erpRecords) {
      try {
        const key = buildEntradaKey(row);
        const legacyKey = buildEntradaLegacyKey(row);
        const hash = generateEntradaHash(row);
        let ex = existingMap.get(key);
        let repairedStore = false;
        let ignoredMismatchedExact = false;

        if (ex && (erpLegacyKeyCounts.get(legacyKey) || 0) > 1 && !sameEntradaFromLegacyKey(ex, row, hash)) {
          ex = null;
          ignoredMismatchedExact = true;
        }

        if (!ex) {
          const legacyCandidates = legacyMap.get(legacyKey) || [];
          ex = legacyCandidates.find((candidate) => (
            !claimedExistingIds.has(candidate.id)
            && normalizeKeyPart(candidate.codiloja) !== normalizeKeyPart(row.codiloja)
            && sameEntradaFromLegacyKey(candidate, row, hash)
          ));

          if (ex) {
            const oldKey = buildEntradaKey(ex);
            repairedStore = true;
            claimedExistingIds.add(ex.id);
            existingMap.delete(oldKey);
            seenExactKeys.delete(oldKey);
            existingMap.set(key, ex);
            seenExactKeys.add(key);
          }
        }

        const record = {
          numerorr: row.numerorr || null,
          codiempr: row.codiempr || null,
          codiloja: row.codiloja || null,
          fornecedor: row.nomeforn || `Fornecedor ${row.codiforn || '?'}`,
          codiforn: row.codiforn || null,
          numeronf: row.numeronf || null,
          nfe_chav: row.nfe_chav || null,
          data_emissao: row.dataemis || null,
          data_entrada: row.recebinf || null,
          total_produtos: row.totalpro || 0,
          total_faturado: row.totalfat || 0,
          valor_icms: row.totaicms || 0,
          valor_ipi: row.totalipi || 0,
          valor_frete: row.valorfre || 0,
          valor_seguro: row.valorseg || 0,
          valor_desconto: row.desconto || 0,
          tipo_entrada: row.tipodeem || null,
          natureza: row.codinatu || null,
          cond_pagamento: row.condreaj || null,
          cod_pagamento: row.codipaga || null,
          pedido_compra: row.numeropc || null,
          observacoes: row.observac || null,
          sync_hash: hash,
          ultima_sync_at: new Date(),
        };

        if (!ex) {
          if (seenExactKeys.has(key) && !ignoredMismatchedExact) {
            stats.unchanged++;
            continue;
          }

          batchInserts.push({
            ...record,
            origem: 'erp',
            status_pagamento: 'em_aberto',
            total_titulado: 0,
            total_pago: 0,
            saldo_sem_titulo: row.totalfat || 0,
            saldo_a_pagar: 0,
            status_titulacao: 'sem_titulo',
            criado_por: username,
          });
          seenExactKeys.add(key);
          stats.inserted++;
        } else if (ex.sync_hash !== hash || repairedStore) {
          batchUpdates.push({
            id: ex.id,
            data: { ...record, atualizado_por: username },
          });
          stats.updated++;
          if (repairedStore) stats.repairedStore++;
        } else {
          stats.unchanged++;
        }
      } catch (err) {
        console.error(`❌ Erro entrada ${row.numerorr}:`, err.message);
        stats.errors++;
      }
    }

    for (const update of batchUpdates) {
      await adminDb(ENTRADAS_TABLE).where('id', update.id).update(update.data);
    }

    if (batchInserts.length > 0) {
      const chunkSize = 100;
      for (let i = 0; i < batchInserts.length; i += chunkSize) {
        await adminDb(ENTRADAS_TABLE).insert(batchInserts.slice(i, i + chunkSize));
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Sync Entradas em ${elapsed}s: ${stats.inserted} novos | ${stats.updated} atualizados | ${stats.repairedStore} lojas corrigidas | ${stats.unchanged} sem mudança`);

    // F3: gera complementos "por fora" das entradas novas (regra por fornecedor)
    let complementos = null;
    try {
      const { gerarComplementosPendentes } = require('./complementosService');
      complementos = await gerarComplementosPendentes({ username });
    } catch (err) {
      console.error('❌ Erro ao gerar complementos:', err.message);
    }

    return { ...stats, complementos, elapsed: parseFloat(elapsed), timestamp: new Date().toISOString() };
  },

  /**
   * Retorna status da última sincronização (contas + entradas)
   */
  async getLastSync() {
    const lastContas = await adminDb(CONTAS_TABLE)
      .where('origem', 'erp')
      .max('ultima_sync_at as lastSync')
      .first();

    const lastEntradas = await adminDb(ENTRADAS_TABLE)
      .where('origem', 'erp')
      .max('ultima_sync_at as lastSync')
      .first();

    const contasCounts = await adminDb(CONTAS_TABLE)
      .select('origem').count('* as total').groupBy('origem');

    const entradasCount = await adminDb(ENTRADAS_TABLE).count('* as total').first();

    return {
      lastSync: lastContas?.lastSync || null,
      lastSyncEntradas: lastEntradas?.lastSync || null,
      counts: contasCounts.reduce((acc, row) => { acc[row.origem] = row.total; return acc; }, {}),
      entradasTotal: entradasCount?.total || 0,
    };
  },
};

module.exports = SyncService;
