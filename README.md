# Admin Financeiro

UI administrativa moderna para gestão financeira, integrada com ERP via MySQL.

## Arquitetura

```
SEU PC (Windows)                          SERVIDOR LOJA (Linux)
┌──────────────────────────────┐          ┌──────────────────┐
│                              │          │                  │
│  ┌────────┐   ┌───────────┐ │          │   ┌──────────┐   │
│  │ React  │──▶│ API Node  │─┼── rede ──┼──▶│ MySQL    │   │
│  │ :5173  │◀──│ :3001     │ │  local   │   │ SAS (ERP)│   │
│  └────────┘   └─────┬─────┘ │          │   │ :3306    │   │
│                     │       │          │   └──────────┘   │
│               ┌─────▼─────┐ │          │                  │
│               │  Docker   │ │          └──────────────────┘
│               │  MySQL    │ │
│               │  admin_   │ │
│               │  financ.  │ │
│               │  :3307    │ │
│               └───────────┘ │
└──────────────────────────────┘
```

## Pré-requisitos

- **Docker Desktop** → https://www.docker.com/products/docker-desktop/
- **Node.js 18+** → https://nodejs.org/
- **Seu PC na mesma rede** do servidor do ERP (192.168.0.2)

---

## Setup Passo a Passo

### Passo 1 — Subir o MySQL no Docker

Abra o terminal (PowerShell ou CMD) na pasta do projeto:

```bash
docker-compose up -d
```

Isso vai:
- Baixar a imagem do MySQL 8.0 (só na primeira vez)
- Criar o banco `admin_financeiro` automaticamente
- Criar o usuário `admin_app` automaticamente
- Expor na porta **3307** do seu PC

Para verificar se subiu:
```bash
docker ps
```
Deve aparecer o container `admin-financeiro-db` com status `Up`.

### Passo 2 — Instalar dependências

```bash
npm run install:all
```

### Passo 3 — Rodar as migrations (criar tabelas no banco admin)

```bash
cd backend
npx knex migrate:latest --knexfile src/config/knexfile.js
```

Deve aparecer:
```
Batch 1 run: 1 migrations
```

### Passo 4 — Iniciar o projeto

```bash
cd ..
npm run dev
```

Isso inicia o backend (porta 3001) e o frontend (porta 5173) simultaneamente.

### Passo 5 — Acessar

Abra o browser em: **http://localhost:5173**

Login: use o `ADMIN_USERNAME` e `ADMIN_PASSWORD` configurados em `backend/.env`.

---

## Comandos Úteis

```bash
# Iniciar tudo (backend + frontend)
npm run dev

# Só backend
npm run dev:backend

# Só frontend
npm run dev:frontend

# Subir banco Docker
docker-compose up -d

# Parar banco Docker
docker-compose down

# Ver logs do banco
docker logs admin-financeiro-db

# Acessar MySQL do Docker pelo terminal
docker exec -it admin-financeiro-db mysql -u admin_app -p admin_financeiro

# Rodar nova migration
cd backend
npx knex migrate:latest --knexfile src/config/knexfile.js
```

## Acessar o banco admin pelo HeidiSQL

Se quiser visualizar o banco admin pelo HeidiSQL:

- **Host:** 127.0.0.1
- **Porta:** 3307
- **Usuário:** admin_app
- **Senha:** SuaSenhaForte123!
- **Banco:** admin_financeiro

---

## Estrutura do Projeto

```
admin-financeiro/
├── docker-compose.yml         ← MySQL admin no Docker
├── backend/
│   ├── .env                   ← Configurações (ERP + Admin)
│   ├── src/
│   │   ├── server.js          ← Entry point da API
│   │   ├── config/
│   │   │   └── database.js    ← Duas conexões (ERP read + Admin write)
│   │   ├── models/
│   │   │   ├── pagame.js      ← Leitura tabela PAGAME do ERP
│   │   │   └── relrec.js      ← Leitura tabela RELREC do ERP
│   │   ├── routes/
│   │   │   ├── auth.js        ← Login JWT
│   │   │   ├── pagame.js      ← Rotas PAGAME
│   │   │   ├── relrec.js      ← Rotas RELREC
│   │   │   ├── dashboard.js   ← Dados agregados
│   │   │   └── contasPagar.js ← CRUD contas (banco admin)
│   │   └── middleware/
│   │       └── auth.js
│   └── migrations/            ← Tabelas do banco admin
├── frontend/
│   ├── src/
│   │   ├── App.jsx            ← Router principal
│   │   ├── pages/
│   │   │   ├── DashboardPage.jsx
│   │   │   ├── PagamePage.jsx
│   │   │   ├── RelrecPage.jsx
│   │   │   ├── ContasPagarPage.jsx
│   │   │   └── VinculosPage.jsx
│   │   ├── hooks/useAuth.jsx
│   │   └── lib/
│   │       ├── api.js         ← Cliente HTTP (axios)
│   │       └── utils.js       ← Formatação, datas
│   └── package.json
└── package.json               ← Scripts do monorepo
```

## Módulos

| Módulo | Status | Fonte | Operação |
|--------|--------|-------|----------|
| Dashboard | ✅ | ERP | Leitura |
| Contas a Pagar (ERP) | ✅ | PAGAME | Leitura |
| Entradas de Mercadoria | ✅ | RELREC | Leitura |
| Contas a Pagar (Admin) | ✅ | Docker MySQL | CRUD |
| Vínculos Pagamento ↔ NF | 🔜 | Docker MySQL | CRUD |
| Varredura DDA Bancária | 🔜 | Docker MySQL | CRUD |

## Dados Persistentes

Os dados do MySQL ficam no Docker volume `admin_db_data`. Mesmo se você parar ou recriar o container, os dados são mantidos. Para apagar tudo e recomeçar do zero:

```bash
docker-compose down -v   # o -v remove os volumes
docker-compose up -d
cd backend && npx knex migrate:latest --knexfile src/config/knexfile.js
```

## Deploy no Debian com Docker

O repositÃ³rio agora inclui um `Dockerfile` para empacotar backend e frontend no mesmo container.
Em produÃ§Ã£o, a API serve o `frontend/dist` em `http://IP_DO_SERVIDOR:3001`.

### 1. Ajustar o `backend/.env` no servidor

Confirme estes campos antes do deploy:

- `NODE_ENV=production`
- `PORT=3001`
- `ERP_DB_HOST`, `ERP_DB_PORT`, `ERP_DB_NAME`, `ERP_DB_USER`, `ERP_DB_PASS`
- `ADMIN_DB_HOST`, `ADMIN_DB_PORT`, `ADMIN_DB_NAME`, `ADMIN_DB_USER`, `ADMIN_DB_PASS`
- Opcional para pedidos/vendas da loja 2 em outro servidor:
  - `ERP_LOJA2_DB_HOST=192.168.0.200`
  - `ERP_LOJA2_DB_PORT` (se vazio usa `ERP_DB_PORT`)
  - `ERP_LOJA2_DB_NAME` (se vazio usa `ERP_DB_NAME`)
  - `ERP_LOJA2_DB_USER` (se vazio usa `ERP_DB_USER`)
  - `ERP_LOJA2_DB_PASS` (se vazio usa `ERP_DB_PASS`)

ObservaÃ§Ãµes:

- se o banco admin estiver em outro container Docker, use o nome do serviÃ§o ou IP desse banco em `ADMIN_DB_HOST`
- se o banco admin estiver fora do Docker, use o IP/host real acessÃ­vel a partir do Debian

### 2. Build da imagem

```bash
docker compose -f docker-compose.app.yml build
```

### 3. Rodar as migrations

```bash
docker compose -f docker-compose.app.yml run --rm admin-financeiro-app npm --prefix backend run migrate
```

### 4. Subir a aplicaÃ§Ã£o

```bash
docker compose -f docker-compose.app.yml up -d
```

### 5. Acompanhar logs

```bash
docker compose -f docker-compose.app.yml logs -f admin-financeiro-app
```

### 6. Atualizar depois de novas mudanÃ§as

```bash
docker compose -f docker-compose.app.yml build
docker compose -f docker-compose.app.yml run --rm admin-financeiro-app npm --prefix backend run migrate
docker compose -f docker-compose.app.yml up -d
```
