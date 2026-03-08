# Docker quick start

## Why startup can be slow

- **11 services** (frontend, gateway, 8 backend microservices, db-migrations).
- **10 backend images** are built separately (each service has its own `SERVICE_DIR`), so a full **build** runs `npm install` many times and can take several minutes.
- **Start** (without build) only starts existing containers and is much faster.

## Fast workflow

### First time (or after changing Dockerfile / package.json)

```bash
# Build all images (parallel when possible). Do this once or after deps change.
docker compose build

# Then start
docker compose up -d
```

### Every other time (no Dockerfile/deps change)

```bash
# Start only – uses existing images. Much faster.
docker compose up -d
```

### After code changes (backend/frontend only)

```bash
# Restart the service(s) you changed; no rebuild.
docker compose restart gateway logistics-service
# or restart all:
docker compose restart
```

## Commands that are slow (avoid for daily use)

- `docker compose up -d --build` – rebuilds all images every time. Use only when you changed Dockerfiles or package.json.
- `docker compose build --no-cache` – full rebuild with no cache. Use only when something is broken.

## If it’s still slow

1. **Check what’s running:** `docker compose ps` – see which services are up.
2. **Start only what you need:** Comment out unneeded services in `docker-compose.yml` for local dev, or use profiles.
3. **Build in parallel:** `docker compose build --parallel` (Compose v2) to use multiple cores.
