# backend/scripts

One-off operational scripts. Run from the **repo root** with Node ≥ 18.

Each script reads the DB connection from the environment via the shared knex
client (`backend/packages/goodmen-shared/config/knex`, which uses
`goodmen-database/knexfile`). They auto-load `.env` (or `.env.production` when
`NODE_ENV=production`) like the rest of the backend tooling.

**Connection env (either form works):**

```bash
# Preferred — a single connection string (e.g. Render Internal Database URL):
export DATABASE_URL="postgresql://user:pass@host:5432/dbname"

# …or discrete vars:
export PG_HOST=localhost PG_PORT=5432 PG_DATABASE=goodmen_logistics PG_USER=postgres PG_PASSWORD=...
```

---

## Demo live-tracking scripts (FN-1682 / Story H)

Synthetic vehicle-position data that drives the **real** Phase 1 live map at
`/tracking` — no live Samsara/Motive feed required, no frontend changes. The
simulator writes interpolated pings into `vehicle_position_pings`; Story D's
WebSocket broadcast (`vehicle:position`) pushes them to the map unchanged.

All demo loads use a `DEMO-` `load_number` prefix and all demo pings use
`source_event_id = 'demo-sim'`, so teardown is unambiguous and never touches real
data.

> **Tenant scoping matters.** The live map only shows vehicles whose
> `vehicles.tenant_id` matches the logged-in tenant. The seed picks trucks for one
> tenant (auto-detected, or `--tenant=<uuid>` / `DEMO_TENANT_ID`). **Log in as a
> user of that tenant** to see the markers. The seed prints which tenant it used.

### 1. Seed demo loads — `seed-demo-tracking-loads.js`

Idempotent. Upserts the well-known route zip codes into `zip_codes`, then creates
up to 5 `DEMO-` loads in `IN_TRANSIT`, each assigned to an in-service truck +
active driver, with PICKUP/DELIVERY stops (Chicago→Dallas, Atlanta→Miami,
LA→Phoenix, Seattle→Denver, LA→New York).

```bash
node backend/scripts/seed-demo-tracking-loads.js
node backend/scripts/seed-demo-tracking-loads.js --tenant=<tenant-uuid> --count=4
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--tenant=<uuid>` | auto (tenant with most in-service trucks) | which tenant's trucks/drivers to use |
| `--count=<n>` | 5 (capped at available trucks) | how many demo loads to create |

### 2. Run the simulator — `demo-tracking-simulator.js`

`setInterval` loop that interpolates each demo load's position from pickup → delivery
and inserts a ping per tick. Linear lat/lng interpolation (this is a demo, not
navigation); `speed_mph` is random 50–65, `heading_deg` is the segment bearing. A
full trip takes ~5 min of wall-clock regardless of real distance. **Leave it
running** during the demo; stop with `Ctrl+C`.

```bash
node backend/scripts/demo-tracking-simulator.js                       # interval 5s, loop mode
node backend/scripts/demo-tracking-simulator.js --interval=3000       # faster ticks
node backend/scripts/demo-tracking-simulator.js --mode=once           # stop each load at delivery
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--interval=<ms>` | `5000` | tick period |
| `--mode=loop\|once` | `loop` | `loop`: on arrival, pause 30s then restart from pickup (runs forever). `once`: mark DELIVERED and stop. |

### 3. Tear it down — `teardown-demo-tracking.js`

Deletes the demo pings (`source_event_id='demo-sim'` on the demo trucks), then the
`DEMO-` loads + their stops. Leaves `zip_codes` and all real data untouched. Prints
a summary.

```bash
node backend/scripts/teardown-demo-tracking.js
```

---

## Demo prep checklist (client meeting)

1. **Point at the right DB.** `export DATABASE_URL=...` for the env the demo
   browser uses (usually dev). Confirm with `node backend/scripts/diagnose-loads-db.js`.
2. **Seed.** `node backend/scripts/seed-demo-tracking-loads.js`. Note the **tenant
   id** it prints.
3. **Log in** to the app as a user of that tenant.
4. **Start the simulator** in a terminal you can leave running:
   `node backend/scripts/demo-tracking-simulator.js`. Watch for `inserted N ping(s)`.
5. **Open `/tracking`.** Markers should appear within ~one interval and move every
   tick. Click a marker → side panel (driver shows if the truck has a
   `leased_driver_id`).
6. **(Optional)** `--interval=2000` for snappier motion on a short call.
7. **After the demo:** `Ctrl+C` the simulator, then
   `node backend/scripts/teardown-demo-tracking.js` to remove the synthetic data.
