# Runbook: Real-time WebSocket + SMS (FN-1198)

## Overview

FleetNeuron's real-time notification stack (FN-1198) delivers `incident.state_changed`
events to connected browser clients via Socket.IO and optionally via Twilio SMS to
opted-in recipients.

**Services involved:**
| Service | Render name | Role |
|---------|-------------|------|
| Gateway | `fleetneuron-logistics-gateway` | Socket.IO broker; exposes `/internal/ws/emit` |
| Drivers Compliance | `fleetneuron-drivers-compliance-service` | Fires events on `PATCH /api/roadside/calls/:id/status` |

**Code:**
- `backend/gateway/services/incident-broadcaster.js` — WS emit wrapper
- `backend/microservices/drivers-compliance-service/services/incident-event-publisher.js` — HTTP → gateway
- `backend/microservices/drivers-compliance-service/services/incident-sms-notify.js` — Twilio SMS
- `backend/microservices/drivers-compliance-service/routes/roadside-realtime.js` — PATCH intercept

---

## Required Environment Variables

### Gateway (`fleetneuron-logistics-gateway`)

| Variable | Required | Notes |
|----------|----------|-------|
| `INTERNAL_WS_SECRET` | Yes | Shared secret for `/internal/ws/emit`. Generate: `openssl rand -hex 32`. Must match value on drivers-compliance. |

### Drivers Compliance (`fleetneuron-drivers-compliance-service`)

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `INTERNAL_GATEWAY_URL` | Yes | `http://localhost:4000` | URL of the gateway service. Set to `https://fleetneuron-logistics-gateway.onrender.com` on Render (or internal service URL). |
| `INTERNAL_WS_SECRET` | Yes | — | Same value as on the gateway. |
| `TWILIO_ACCOUNT_SID` | Yes | — | Twilio account SID (already used for voice calls). |
| `TWILIO_AUTH_TOKEN` | Yes | — | Twilio auth token. |
| `TWILIO_PHONE_NUMBER` | Yes | — | Outbound SMS sender number (E.164). |

---

## Deployment Steps (first-time setup)

1. **Generate a shared secret:**
   ```bash
   openssl rand -hex 32
   ```

2. **Set `INTERNAL_WS_SECRET`** on both:
   - `fleetneuron-logistics-gateway` (Render Dashboard → Environment → Add)
   - `fleetneuron-drivers-compliance-service`

3. **Set `INTERNAL_GATEWAY_URL`** on `fleetneuron-drivers-compliance-service`:
   ```
   https://fleetneuron-logistics-gateway.onrender.com
   ```
   (or the Render private service hostname if both are on the same network)

4. **Enable sticky sessions on the gateway:**
   Render Dashboard → `fleetneuron-logistics-gateway` → Settings → Session Affinity → **Cookie**
   *(See `infra/render/gateway.yaml` for the Blueprint YAML equivalent.)*

5. **Run FN-1241 migrations** before redeploying drivers-compliance:
   ```bash
   npx knex migrate:latest --env production
   # migrations: 20260610120000_create_sms_optin, 20260610120100_create_event_log
   ```

6. **Deploy in order:**
   1. `fleetneuron-logistics-gateway` (new broadcaster wiring)
   2. `fleetneuron-drivers-compliance-service` (new routes + publisher)

---

## Verifying the Stack

### 1. WebSocket delivery

Connect a Socket.IO client in the correct tenant room, then patch an incident:

```bash
# Patch incident status
curl -X PATCH https://fleetneuron-logistics-gateway.onrender.com/api/roadside/calls/<ID>/status \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"status":"IN_PROGRESS"}'
```

Expected: `incident.state_changed` event arrives on the connected WS client within ~200ms.

### 2. Telemetry log

Check drivers-compliance logs for:
```json
{"event":"incident.dispatch","ws_published":true,"latency_ms":85,"duplicate":false}
```

### 3. Idempotency (event_log)

Re-send the same status patch (same incident + state). Drivers-compliance log should show:
```json
{"event":"incident.dispatch","ws_published":false,"duplicate":true}
```

### 4. SMS (opted-in recipient)

Insert a test `sms_optin` row then patch status:
```sql
INSERT INTO sms_optin (tenant_id, phone_e164) VALUES ('<tenant>', '+15550001234');
```

Expect an SMS to that number within seconds. Twilio Logs confirm delivery.

---

## Scaling Notes

### Single-instance (current — Starter plan)

The gateway runs as one instance on Render's Starter plan. Sticky sessions are
configured but have no effect at 1 instance. This is fine for Phase 1 load.

### Scaling to multiple instances

When the gateway scales beyond 1 instance (e.g. upgrading to Standard and enabling
autoscaling), **sticky sessions alone are not sufficient** because events emitted from
drivers-compliance arrive at one gateway instance and will only reach clients connected
to that instance.

**Resolution:** Replace `incident-broadcaster.js` with a Socket.IO Redis Adapter:

```bash
npm install @socket.io/redis-adapter ioredis
```

```js
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('ioredis');
const pubClient = createClient({ url: process.env.REDIS_URL });
const subClient = pubClient.duplicate();
io.adapter(createAdapter(pubClient, subClient));
```

Required env var: `REDIS_URL` on the gateway service. Redis instance can be the
existing `REDIS_URL` or a dedicated Render Redis.

The Redis adapter allows any gateway instance to broadcast to all connected clients
regardless of which instance received the `/internal/ws/emit` POST.

**Do not scale without the Redis adapter.** Sticky sessions only ensure a given
browser's polling fallback hits the same instance — they do not solve the cross-instance
broadcast problem.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| WS event never arrives | Missing `INTERNAL_WS_SECRET` on gateway | Set env var, redeploy gateway |
| `503 Internal WS emit disabled` in drivers-compliance logs | `INTERNAL_WS_SECRET` not set on drivers-compliance | Set env var, redeploy |
| WS disconnects randomly on Render | Sticky sessions not enabled | Enable via Dashboard or Blueprint YAML |
| SMS not sent | `sms_optin` row missing for phone | Insert opt-in record; check Twilio balance/number |
| `duplicate: true` on first call | Stale `event_log` row from a prior attempt | Safe to ignore; idempotency working correctly |
| Events lost after gateway restart | In-memory Socket.IO rooms cleared | Expected; clients reconnect and re-join rooms via JWT auth |
