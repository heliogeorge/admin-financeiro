import { useEffect, useMemo, useState } from 'react';
import { lojasApi } from '../lib/api';

const FALLBACK_LOJAS = [
  { codiloja: '01', nomeloja: 'VIVENDA' },
  { codiloja: '02', nomeloja: 'EMBALATTI' },
];

const FIXED_LOJA_NAMES = {
  1: 'VIVENDA',
  2: 'EMBALATTI',
};

let cachedLojas = null;
let pendingRequest = null;

function normalizeCode(value) {
  const raw = String(value ?? '').trim();
  const withoutZeros = raw.replace(/^0+/, '');
  return withoutZeros || raw || '';
}

function formatAppCode(value) {
  const raw = String(value ?? '').trim();
  if (/^\d$/.test(raw)) return raw.padStart(2, '0');
  return raw;
}

function fixedLojaName(codiloja, fallback = '') {
  return FIXED_LOJA_NAMES[normalizeCode(codiloja)] || fallback;
}

function normalizeRows(rows) {
  const seen = new Set();
  return (rows || [])
    .map((row) => ({
      codiloja: formatAppCode(row.codiloja),
      nomeloja: fixedLojaName(row.codiloja, String(row.nomeloja ?? row.nome ?? '').trim()),
    }))
    .filter((row) => row.codiloja)
    .filter((row) => {
      const key = normalizeCode(row.codiloja);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function loadLojas() {
  if (cachedLojas) return cachedLojas;
  if (!pendingRequest) {
    pendingRequest = lojasApi.list()
      .then((res) => {
        cachedLojas = normalizeRows(res.data?.data);
        if (!cachedLojas.length) cachedLojas = FALLBACK_LOJAS;
        return cachedLojas;
      })
      .catch(() => {
        cachedLojas = FALLBACK_LOJAS;
        return cachedLojas;
      })
      .finally(() => {
        pendingRequest = null;
      });
  }
  return pendingRequest;
}

export function getLojaFallbackName(codiloja) {
  if (!codiloja) return '-';
  return fixedLojaName(codiloja, `Loja ${codiloja}`);
}

export function useLojas() {
  const [lojas, setLojas] = useState(cachedLojas || FALLBACK_LOJAS);
  const [loading, setLoading] = useState(!cachedLojas);

  useEffect(() => {
    let mounted = true;
    loadLojas()
      .then((rows) => {
        if (mounted) setLojas(rows);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const byCode = useMemo(() => {
    const map = new Map();
    lojas.forEach((loja) => {
      map.set(normalizeCode(loja.codiloja), loja);
    });
    return map;
  }, [lojas]);

  function getLojaName(codiloja) {
    const code = normalizeCode(codiloja);
    return byCode.get(code)?.nomeloja || getLojaFallbackName(codiloja);
  }

  return { lojas, loading, getLojaName };
}
