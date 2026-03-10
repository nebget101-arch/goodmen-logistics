#!/bin/bash
# Resilient Docker Startup - avoids buildx hangs and starts services in stages

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Work around broken buildx "driver not connecting" issues
export DOCKER_BUILDKIT=0
export COMPOSE_DOCKER_CLI_BUILD=0

echo "🧹 Cleaning up..."
docker compose down --remove-orphans --volumes 2>/dev/null || true

echo "🧼 Resetting buildx state (best-effort)..."
docker buildx rm default >/dev/null 2>&1 || true
docker buildx rm desktop-linux >/dev/null 2>&1 || true

echo ""
echo "🚀 Building services (this may take 2-3 minutes)..."
docker compose build reporting-service integrations-service auth-users-service drivers-compliance-service vehicles-maintenance-service inventory-service ai-service

echo "🔁 Rebuilding logistics + gateway to ensure latest shared settlement code is used..."
docker compose build --no-cache logistics-service gateway

echo ""
echo "✅ Starting backend services..."
# Start all services at once, no dependency chain
docker compose up -d \
    reporting-service \
    integrations-service \
    auth-users-service \
    drivers-compliance-service \
    vehicles-maintenance-service \
    logistics-service \
    inventory-service \
    ai-service

echo ""
echo "⏳ Waiting 10 seconds for services to start..."
sleep 10

echo ""
echo "🚪 Starting gateway..."
docker compose up -d gateway

echo "⏳ Waiting 5 seconds for gateway..."
sleep 5

if docker compose ps | grep -q "fleetneuron-gateway"; then
    echo "✅ Gateway container created."
else
    echo "❌ Gateway did not start. Showing logs:"
    docker compose logs --tail=100 gateway || true
    exit 1
fi

echo ""
echo "🖥️  Starting frontend UI..."
docker compose up -d frontend

echo "⏳ Waiting 5 seconds for frontend..."
sleep 5

if docker compose ps | grep -q "fleetneuron-frontend"; then
    echo "✅ Frontend container created."
else
    echo "❌ Frontend did not start. Showing logs:"
    docker compose logs --tail=100 frontend || true
    exit 1
fi

echo ""
echo "📊 Service Status:"
docker compose ps

echo ""
echo "✅ Done! Gateway should be running at http://localhost:4000"
echo "✅ UI should be running at http://localhost:4200"
echo ""
echo "Check logs with: docker compose logs -f gateway frontend"
