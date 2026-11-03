/**
 * Agendador do sync MercadoPago: uma vez por dia, a partir das 07:00
 * (horário de São Paulo), sincroniza as movimentações das empresas
 * configuradas e roda a baixa automática.
 *
 * Desative com MP_SYNC_AUTO=0 no .env.
 */
const {
  getEmpresas, syncEmpresa, autoConciliarMp, syncRelatoriosEmpresa,
} = require('./mpService');
const bbService = require('./bbService');

const HORA_MINIMA = 7;
const CHECK_INTERVAL_MS = 10 * 60 * 1000;

let ultimaDataExecutada = null;
let executando = false;

function agoraSaoPaulo() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return { data: `${get('year')}-${get('month')}-${get('day')}`, hora: parseInt(get('hour'), 10) };
}

async function rodarSyncDiario() {
  if (executando) return;
  executando = true;
  try {
    console.log('[mp-scheduler] iniciando sync diário MercadoPago...');
    for (const emp of getEmpresas()) {
      try {
        const r = await syncEmpresa(emp.slug, { dias: 15, username: 'mp-scheduler' });
        console.log(`[mp-scheduler] ${r.label}: ${r.inserted} novos, ${r.duplicated} duplicados`);
      } catch (err) {
        console.error(`[mp-scheduler] erro no sync ${emp.slug}:`, err.message);
      }
      try {
        const rel = await syncRelatoriosEmpresa(emp.slug, { username: 'mp-scheduler' });
        console.log(`[mp-scheduler] ${rel.label} relatórios: ${rel.arquivos_novos} arquivos, `
          + `${rel.movimentos_inseridos} movimentos novos`);
      } catch (err) {
        console.error(`[mp-scheduler] erro nos relatórios ${emp.slug}:`, err.message);
      }
    }
    if (bbService.isConfigured()) {
      try {
        const bb = await bbService.syncExtratoBb({ dias: 15, username: 'mp-scheduler' });
        console.log(`[mp-scheduler] Banco do Brasil: ${bb.inserted} novos, ${bb.duplicated} duplicados`);
      } catch (err) {
        console.error('[mp-scheduler] erro no sync BB:', err.message);
      }
    }
    try {
      const auto = await autoConciliarMp({ username: 'mp-scheduler' });
      console.log(`[mp-scheduler] baixa automática: ${auto.dda_pagos.length} DDA pagos, `
        + `${auto.baixados.length} baixas, ${auto.ambiguos} ambíguos, ${auto.sem_match} sem match`);
    } catch (err) {
      console.error('[mp-scheduler] erro na baixa automática:', err.message);
    }
  } finally {
    executando = false;
  }
}

function startMpScheduler() {
  if (process.env.MP_SYNC_AUTO === '0') {
    console.log('[mp-scheduler] desativado via MP_SYNC_AUTO=0');
    return;
  }
  if (getEmpresas().length === 0 && !bbService.isConfigured()) {
    console.log('[mp-scheduler] nenhuma integração bancária configurada — agendador inativo');
    return;
  }

  const check = async () => {
    const { data, hora } = agoraSaoPaulo();
    if (hora < HORA_MINIMA || ultimaDataExecutada === data) return;
    ultimaDataExecutada = data;
    await rodarSyncDiario();
  };

  setInterval(check, CHECK_INTERVAL_MS);
  setTimeout(check, 30 * 1000); // primeira checagem logo após subir
  console.log(`[mp-scheduler] ativo — sync diário a partir das ${String(HORA_MINIMA).padStart(2, '0')}:00 (America/Sao_Paulo)`);
}

module.exports = { startMpScheduler, rodarSyncDiario };
