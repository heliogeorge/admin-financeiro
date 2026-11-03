const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { adminDb } = require('../config/database');

// ─── Auth por API Key ────────────────────────────────────────────────────────
function shortcutAuth(req, res, next) {
  const key = req.headers['x-shortcut-key'];
  if (!key || key !== process.env.SHORTCUT_API_KEY) {
    return res.status(401).json({ error: 'API Key inválida' });
  }
  next();
}

// ─── Upload config ───────────────────────────────────────────────────────────
const uploadDir = process.env.UPLOAD_DIR || './uploads';

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadDir, 'comprovantes', new Date().toISOString().slice(0, 7));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `comp-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'image/heic', 'image/heif']);

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIMES.has(file.mimetype)) return cb(null, true);
    // iPhone às vezes envia sem MIME correto — aceita pelo nome também
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.pdf', '.heic', '.heif'].includes(ext)) return cb(null, true);
    cb(new Error('Formato não permitido'));
  },
});

// ─── GET /api/shortcut/contas-pendentes ─────────────────────────────────────
// Retorna contas pendentes/vencidas para o Atalho exibir a lista de escolha
router.get('/contas-pendentes', shortcutAuth, async (req, res, next) => {
  try {
    const { q, valor } = req.query;

    const query = adminDb('contas_pagar')
      .select('id', 'fornecedor', 'valor', 'data_vencimento', 'status', 'codiloja')
      .whereIn('status', ['pendente', 'vencido'])
      .orderBy('data_vencimento', 'asc')
      .limit(30);

    if (q) query.where('fornecedor', 'like', `%${q}%`);
    if (valor) {
      const v = parseFloat(valor.replace(',', '.'));
      if (!isNaN(v)) query.whereBetween('valor', [v - 0.05, v + 0.05]);
    }

    const contas = await query;

    // Retorna strings no formato "ID||label" — iOS Shortcuts consegue usar direto no Choose from List
    const lista = contas.map(c =>
      `${c.id}||${c.fornecedor} - R$ ${Number(c.valor).toFixed(2).replace('.', ',')} - venc. ${c.data_vencimento || '?'}`
    );

    res.json({ contas: lista });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/shortcut/comprovante ─────────────────────────────────────────
// Recebe imagem + conta_id, salva e vincula à conta
router.post('/comprovante', shortcutAuth, upload.any(), async (req, res, next) => {
  try {
    const file = req.file || (req.files && req.files[0]);
    if (!file) {
      console.log('[shortcut] campos recebidos:', Object.keys(req.body || {}));
      return res.status(400).json({ error: 'Nenhum arquivo enviado', campos: Object.keys(req.body || {}) });
    }

    const contaId = req.body.conta_id ? parseInt(req.body.conta_id, 10) : null;
    const comprovantePath = file.path.replace(/\\/g, '/');

    if (contaId) {
      const conta = await adminDb('contas_pagar').where('id', contaId).first();
      if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });

      await adminDb('contas_pagar').where('id', contaId).update({
        comprovante_path: comprovantePath,
        atualizado_por: 'shortcut-ios',
      });

      return res.json({
        ok: true,
        mensagem: `Comprovante vinculado a: ${conta.fornecedor}`,
        conta_id: contaId,
        arquivo: comprovantePath,
      });
    }

    // Sem conta_id — salva na "caixa de entrada" (comprovante solto)
    const [id] = await adminDb('comprovantes_inbox').insert({
      arquivo_path: comprovantePath,
      criado_em: new Date(),
    });

    res.json({
      ok: true,
      mensagem: 'Comprovante salvo na caixa de entrada. Vincule na tela de Contas a Pagar.',
      inbox_id: id,
      arquivo: comprovantePath,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/shortcut/upload-raw?conta_id=X ───────────────────────────────
// Recebe imagem como corpo bruto da requisição (mais fácil de usar no iOS Shortcuts)
router.post('/upload-raw', shortcutAuth, async (req, res, next) => {
  try {
    const contaId = req.query.conta_id ? parseInt(req.query.conta_id, 10) : null;
    const contentType = req.headers['content-type'] || 'image/jpeg';

    // Determina extensão pelo content-type
    const extMap = {
      'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
      'image/heic': '.heic', 'image/heif': '.heif', 'image/webp': '.webp',
      'application/pdf': '.pdf',
    };
    const ext = extMap[contentType.split(';')[0].trim()] || '.jpg';

    // Salva o arquivo
    const dir = path.join(uploadDir, 'comprovantes', new Date().toISOString().slice(0, 7));
    fs.mkdirSync(dir, { recursive: true });
    const filename = `comp-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    const filePath = path.join(dir, filename);

    await new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        fs.writeFile(filePath, Buffer.concat(chunks), err => err ? reject(err) : resolve());
      });
      req.on('error', reject);
    });

    const comprovantePath = filePath.replace(/\\/g, '/');

    if (contaId) {
      const conta = await adminDb('contas_pagar').where('id', contaId).first();
      if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });

      await adminDb('contas_pagar').where('id', contaId).update({
        comprovante_path: comprovantePath,
        atualizado_por: 'shortcut-ios',
      });

      return res.json({
        ok: true,
        mensagem: `Comprovante vinculado a: ${conta.fornecedor}`,
      });
    }

    // Sem conta_id — salva na caixa de entrada
    const [id] = await adminDb('comprovantes_inbox').insert({
      arquivo_path: comprovantePath,
      criado_em: new Date(),
    });

    res.json({
      ok: true,
      mensagem: 'Comprovante salvo na caixa de entrada.',
      inbox_id: id,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/shortcut/upload-base64 ───────────────────────────────────────
// Recebe { imagem: "<base64>", conta_id: "123", mime_type: "image/jpeg" }
// Muito mais fácil de usar no iOS Shortcuts (body JSON normal)
router.post('/upload-base64', shortcutAuth, async (req, res, next) => {
  try {
    const { imagem, conta_id: contaIdRaw, mime_type } = req.body;
    if (!imagem) return res.status(400).json({ error: 'Campo "imagem" ausente no JSON' });

    const contaId = contaIdRaw ? parseInt(contaIdRaw, 10) : null;

    const extMap = {
      'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
      'image/heic': '.heic', 'image/heif': '.heif', 'image/webp': '.webp',
      'application/pdf': '.pdf',
    };
    const ext = extMap[mime_type] || '.jpg';

    const dir = path.join(uploadDir, 'comprovantes', new Date().toISOString().slice(0, 7));
    fs.mkdirSync(dir, { recursive: true });
    const filename = `comp-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    const filePath = path.join(dir, filename);

    fs.writeFileSync(filePath, Buffer.from(imagem, 'base64'));

    const comprovantePath = filePath.replace(/\\/g, '/');

    if (contaId) {
      const conta = await adminDb('contas_pagar').where('id', contaId).first();
      if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });

      await adminDb('contas_pagar').where('id', contaId).update({
        comprovante_path: comprovantePath,
        atualizado_por: 'shortcut-ios',
      });

      return res.json({
        ok: true,
        mensagem: `Comprovante vinculado a: ${conta.fornecedor}`,
        conta_id: contaId,
      });
    }

    const [id] = await adminDb('comprovantes_inbox').insert({
      arquivo_path: comprovantePath,
      criado_em: new Date(),
    });

    res.json({
      ok: true,
      mensagem: 'Comprovante salvo na caixa de entrada.',
      inbox_id: id,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
