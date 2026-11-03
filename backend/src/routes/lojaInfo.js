const express = require('express');
const router = express.Router();
const { adminDb } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const TABLE = 'loja_info';
const CAMPOS = 'loja_info_campos';
const DOCS = 'loja_info_documentos';

const CATEGORIAS = new Set([
  'contas_servicos',
  'contratos',
  'documentos_socios',
  'imovel',
  'outros',
]);

// Upload config (mesmo padrão de contasPagar/compras)
const uploadRoot = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'));
fs.mkdirSync(uploadRoot, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadRoot, 'loja-info', new Date().toISOString().slice(0, 7));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safeExt = path.extname(file.originalname).toLowerCase();
    cb(null, `info-${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
  },
});

const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const ALLOWED_EXTS = /\.(jpeg|jpg|png|gif|webp|pdf|txt|csv|xls|xlsx|doc|docx)$/i;

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const extOk = ALLOWED_EXTS.test(path.extname(file.originalname));
    const mimeOk = ALLOWED_MIMES.has(file.mimetype) || file.mimetype === 'application/octet-stream';
    if (extOk && mimeOk) return cb(null, true);
    cb(new Error('Formato não permitido. Envie PDF, imagem, planilha ou documento.'));
  },
});

// Informações sensíveis: todas as rotas exigem login
router.use(authMiddleware);

function sanitizeCampos(campos) {
  if (!Array.isArray(campos)) return [];
  return campos
    .map((c, i) => ({
      chave: String(c?.chave || '').trim().slice(0, 120),
      valor: c?.valor === undefined || c?.valor === null ? null : String(c.valor).trim().slice(0, 500),
      ordem: i,
    }))
    .filter((c) => c.chave);
}

async function buildInfoDetalhe(infoId) {
  const info = await adminDb(TABLE).where('id', infoId).first();
  if (!info) return null;

  const campos = await adminDb(CAMPOS)
    .where('info_id', infoId)
    .orderBy('ordem', 'asc')
    .orderBy('id', 'asc');

  const documentos = await adminDb(DOCS)
    .where('info_id', infoId)
    .orderBy('id', 'desc');

  return { ...info, campos, documentos };
}

/**
 * GET /api/loja-info
 * Lista registros com busca (título, descrição, chave/valor) e filtro por categoria.
 */
router.get('/', async (req, res, next) => {
  try {
    const { search, categoria } = req.query;

    let query = adminDb(TABLE).select('*');

    if (categoria && CATEGORIAS.has(categoria)) {
      query = query.where('categoria', categoria);
    }

    if (search) {
      const like = `%${search}%`;
      query = query.where(function () {
        this.where('titulo', 'like', like)
          .orWhere('descricao', 'like', like)
          .orWhereIn('id', function () {
            this.select('info_id').from(CAMPOS)
              .where('chave', 'like', like)
              .orWhere('valor', 'like', like);
          });
      });
    }

    const data = await query.orderBy('updated_at', 'desc');

    // Anexa campos e documentos de todos os registros listados
    const ids = data.map((r) => r.id);
    let camposMap = {};
    let docsMap = {};
    if (ids.length > 0) {
      const campos = await adminDb(CAMPOS)
        .whereIn('info_id', ids)
        .orderBy('ordem', 'asc')
        .orderBy('id', 'asc');
      camposMap = campos.reduce((acc, c) => {
        (acc[c.info_id] = acc[c.info_id] || []).push(c);
        return acc;
      }, {});

      const docs = await adminDb(DOCS)
        .whereIn('info_id', ids)
        .orderBy('id', 'desc');
      docsMap = docs.reduce((acc, d) => {
        (acc[d.info_id] = acc[d.info_id] || []).push(d);
        return acc;
      }, {});
    }

    res.json({
      data: data.map((r) => ({
        ...r,
        campos: camposMap[r.id] || [],
        documentos: docsMap[r.id] || [],
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/loja-info/resumo
 * Contagem de registros por categoria (para os filtros).
 */
router.get('/resumo', async (req, res, next) => {
  try {
    const rows = await adminDb(TABLE)
      .select('categoria')
      .count('* as total')
      .groupBy('categoria');
    res.json({
      total: rows.reduce((acc, r) => acc + Number(r.total), 0),
      porCategoria: rows.reduce((acc, r) => { acc[r.categoria] = Number(r.total); return acc; }, {}),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/loja-info/:id
 */
router.get('/:id', async (req, res, next) => {
  try {
    const info = await buildInfoDetalhe(req.params.id);
    if (!info) return res.status(404).json({ error: 'Registro não encontrado' });
    res.json(info);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/loja-info
 * Cria registro com campos chave-valor.
 */
router.post('/', async (req, res, next) => {
  try {
    const { titulo, categoria, descricao, campos } = req.body;

    if (!titulo || !String(titulo).trim()) {
      return res.status(400).json({ error: 'titulo é obrigatório' });
    }

    const cat = CATEGORIAS.has(categoria) ? categoria : 'outros';
    const camposLimpos = sanitizeCampos(campos);
    let infoId;

    await adminDb.transaction(async (trx) => {
      const [newId] = await trx(TABLE).insert({
        titulo: String(titulo).trim().slice(0, 180),
        categoria: cat,
        descricao: descricao || null,
        criado_por: req.user.username,
        atualizado_por: req.user.username,
      });
      infoId = newId;

      if (camposLimpos.length > 0) {
        await trx(CAMPOS).insert(camposLimpos.map((c) => ({ ...c, info_id: infoId })));
      }
    });

    const info = await buildInfoDetalhe(infoId);
    res.status(201).json(info);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/loja-info/:id
 * Atualiza registro; se vier "campos", substitui todos os chave-valor.
 */
router.put('/:id', async (req, res, next) => {
  try {
    const existente = await adminDb(TABLE).where('id', req.params.id).first();
    if (!existente) return res.status(404).json({ error: 'Registro não encontrado' });

    const { titulo, categoria, descricao, campos } = req.body;

    const updates = { atualizado_por: req.user.username };
    if (titulo !== undefined) {
      if (!String(titulo).trim()) return res.status(400).json({ error: 'titulo não pode ficar vazio' });
      updates.titulo = String(titulo).trim().slice(0, 180);
    }
    if (categoria !== undefined) {
      updates.categoria = CATEGORIAS.has(categoria) ? categoria : 'outros';
    }
    if (descricao !== undefined) updates.descricao = descricao || null;

    await adminDb.transaction(async (trx) => {
      await trx(TABLE).where('id', req.params.id).update(updates);

      if (campos !== undefined) {
        const camposLimpos = sanitizeCampos(campos);
        await trx(CAMPOS).where('info_id', req.params.id).del();
        if (camposLimpos.length > 0) {
          await trx(CAMPOS).insert(camposLimpos.map((c) => ({
            ...c,
            info_id: parseInt(req.params.id, 10),
          })));
        }
      }
    });

    const info = await buildInfoDetalhe(req.params.id);
    res.json(info);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/loja-info/:id
 * Exclui o registro (campos e documentos caem por CASCADE; arquivos são removidos do disco).
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const existente = await adminDb(TABLE).where('id', req.params.id).first();
    if (!existente) return res.status(404).json({ error: 'Registro não encontrado' });

    const docs = await adminDb(DOCS).where('info_id', req.params.id);
    await adminDb(TABLE).where('id', req.params.id).del();

    for (const doc of docs) {
      if (doc.caminho_arquivo) {
        fs.unlink(doc.caminho_arquivo, () => {});
      }
    }

    res.json({ message: 'Registro excluído' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/loja-info/:id/documentos
 * Anexa um documento ao registro (multipart, campo "arquivo").
 */
router.post('/:id/documentos', upload.single('arquivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

    const info = await adminDb(TABLE).where('id', req.params.id).first();
    if (!info) return res.status(404).json({ error: 'Registro não encontrado' });

    const relativePath = path.relative(uploadRoot, req.file.path).replace(/\\/g, '/');
    const arquivoUrl = `/uploads/${relativePath}`;

    const [docId] = await adminDb(DOCS).insert({
      info_id: parseInt(req.params.id, 10),
      arquivo_url: arquivoUrl,
      caminho_arquivo: req.file.path.replace(/\\/g, '/'),
      nome_arquivo: req.file.originalname,
      mime_type: req.file.mimetype,
      tamanho_bytes: req.file.size,
      descricao: req.body.descricao || null,
      criado_por: req.user.username,
    });

    await adminDb(TABLE).where('id', req.params.id).update({ atualizado_por: req.user.username });

    const doc = await adminDb(DOCS).where('id', docId).first();
    res.status(201).json(doc);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/loja-info/:id/documentos/:docId
 */
router.delete('/:id/documentos/:docId', async (req, res, next) => {
  try {
    const doc = await adminDb(DOCS)
      .where('id', req.params.docId)
      .where('info_id', req.params.id)
      .first();
    if (!doc) return res.status(404).json({ error: 'Documento não encontrado' });

    await adminDb(DOCS).where('id', req.params.docId).del();
    if (doc.caminho_arquivo) {
      fs.unlink(doc.caminho_arquivo, () => {});
    }

    res.json({ message: 'Documento removido' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
