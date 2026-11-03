#!/usr/bin/env bash
# ============================================================
# deploy.sh — Atualiza o admin-financeiro no servidor Debian
# Uso: ./deploy.sh
# ============================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$APP_DIR/docker-compose.app.yml"
SERVICE="admin-financeiro-app"

echo ""
echo "========================================"
echo "  Admin Financeiro — Deploy"
echo "========================================"

# 1. Build da nova imagem
echo ""
echo "[1/4] Construindo imagem Docker..."
docker compose -f "$COMPOSE_FILE" build --no-cache "$SERVICE"

# 2. Rodar migrations antes de subir (safe: cria tabelas novas, não destrói dados)
echo ""
echo "[2/4] Rodando migrations do banco..."
docker compose -f "$COMPOSE_FILE" run --rm "$SERVICE" npm --prefix backend run migrate

# 3. Reiniciar o container (zero-downtime: up -d recria só se mudou)
echo ""
echo "[3/4] Reiniciando container..."
docker compose -f "$COMPOSE_FILE" up -d "$SERVICE"

# 4. Aguardar health check
echo ""
echo "[4/4] Verificando saúde da aplicação..."
sleep 5
PORT=$(docker compose -f "$COMPOSE_FILE" port "$SERVICE" 3001 2>/dev/null | cut -d: -f2 || echo "3001")
if curl -sf "http://localhost:${PORT}/api/health" > /dev/null 2>&1; then
  echo "  Aplicação OK — http://localhost:${PORT}"
else
  echo "  ATENÇÃO: health check falhou. Verifique os logs:"
  echo "  docker compose -f docker-compose.app.yml logs -f $SERVICE"
  exit 1
fi

echo ""
echo "Deploy concluído com sucesso!"
echo ""
