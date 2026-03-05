# FleetNeuron API Gateway

Proxies `/api/*` to the backend so the frontend can talk to one origin in development and production.

## Setup

```bash
cp .env.example .env
# Edit .env: set PORT, TARGET_BACKEND_URL, CORS_ORIGIN (and NODE_ENV=production for prod)
npm install
npm start
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | Port the gateway listens on |
| `TARGET_BACKEND_URL` | `http://localhost:3000` | Backend base URL (no trailing slash) |
| `CORS_ORIGIN` | `http://localhost:4200` | Allowed origin for CORS (your frontend URL) |
| `NODE_ENV` | - | Set to `production` for quieter logs and proxy `warn` level |

## Endpoints

- `GET /health` – Gateway health (returns `target` backend URL).
- `GET /api/*` – Proxied to `TARGET_BACKEND_URL/api/*`. On backend errors, returns `502` with JSON `{ error: "Bad Gateway", message: "..." }`.

## Production

1. Set `TARGET_BACKEND_URL` to your backend (e.g. `https://your-backend.onrender.com`).
2. Set `CORS_ORIGIN` to your frontend origin (e.g. `https://your-app.example.com`).
3. Set `NODE_ENV=production`.
4. Point the frontend `environment.prod.ts` `apiUrl` at this gateway (e.g. `https://api.yourdomain.com/api` or `/api` if same host).
