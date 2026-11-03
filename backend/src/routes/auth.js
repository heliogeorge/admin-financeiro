const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Credenciais do admin via variáveis de ambiente
// Configure ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_NOME e JWT_SECRET no .env
if (!process.env.ADMIN_PASSWORD) {
  throw new Error('ADMIN_PASSWORD nao definida no .env.');
}

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET nao definido no .env.');
}

const USERS = [
  {
    id: 1,
    username: process.env.ADMIN_USERNAME || 'admin',
    passwordHash: bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10),
    nome: process.env.ADMIN_NOME || 'Administrador',
    role: 'admin',
  },
];

/**
 * POST /api/auth/login
 */
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username e password são obrigatórios' });
    }

    const user = USERS.find(u => u.username === username);
    if (!user) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        nome: user.nome,
        role: user.role,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/me
 */
router.get('/me', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Não autenticado' });

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = USERS.find(u => u.id === decoded.id);
    if (!user) return res.status(401).json({ error: 'Usuário não encontrado' });

    res.json({
      id: user.id,
      username: user.username,
      nome: user.nome,
      role: user.role,
    });
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
});

module.exports = router;
