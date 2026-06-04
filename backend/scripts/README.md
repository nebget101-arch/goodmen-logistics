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

All demo loads use a `DEMO-` `load_number` prefix, the minted demo trucks use a
`DEMO-TRUCK-` `unit_number` prefix, and all demo pings use
`source_event_id = 'demo-sim'`, so teardown is unambiguous and never touches real
data.

> **Tenant scoping matters.** The live map only shows vehicles whose
> `vehicles.tenant_id` matches the logged-in tenant. The seed mints its demo trucks
> under one tenant (auto-detected, or `--tenant=<uuid>` / `DEMO_TENANT_ID`). **Log
> in as a user of that tenant** to see the markers. The seed prints which tenant it
> used.

> **FN-1716 (Story I) — scaled to 50 trucks.** The seed now *mints its own* demo
> fleet (`DEMO-TRUCK-001`…`050`) rather than borrowing existing in-service trucks,
> so the demo is self-contained and doesn't need the DB to already have 50 real
> trucks. Routes are spread across ~40 US metros, the simulator drives all of them
> each tick with a single bulk insert, and teardown also removes the minted trucks.

### 1. Seed demo trucks + loads — `seed-demo-tracking-loads.js`

Idempotent. Upserts the well-known route zip codes into `zip_codes`, then mints
`DEMO_TRUCK_COUNT` demo trucks (`DEMO-TRUCK-001`…) and one `DEMO-TRUCK-NNN`
`IN_TRANSIT` load each, on geographically varied pickup→delivery routes drawn from
~40 US metros, each assigned an active driver (cycled) when one exists.

```bash
node backend/scripts/seed-demo-tracking-loads.js                          # 50 trucks
node backend/scripts/seed-demo-tracking-loads.js --tenant=<uuid> --count=20
DEMO_TRUCK_COUNT=10 node backend/scripts/seed-demo-tracking-loads.js
```

| Flag / env | Default | Meaning |
|------------|---------|---------|
| `--tenant=<uuid>` / `DEMO_TENANT_ID` | auto (tenant with most in-service trucks, else first tenant) | which tenant the demo trucks belong to |
| `--count=<n>` | `DEMO_TRUCK_COUNT` | how many demo trucks/loads to create |
| `DEMO_TRUCK_COUNT` (env) | `50` | default fleet size (the single knob); `--count` overrides it |

### 2. Run the simulator — `demo-tracking-simulator.js`

`setInterval` loop that interpolates **every** demo load's position from pickup →
delivery and inserts one ping per truck per tick. Linear lat/lng interpolation
(this is a demo, not navigation); `speed_mph` is random 50–65, `heading_deg` is the
segment bearing. A full trip takes ~5 min of wall-clock regardless of real
distance. Each tick does ~3 SELECTs + **one bulk INSERT** for all trucks (not one
query per truck) and logs how long it took (`inserted N ping(s) in Mms`) so you can
confirm it stays well under the interval at 50 trucks. **Leave it running** during
the demo; stop with `Ctrl+C`.

```bash
node backend/scripts/demo-tracking-simulator.js                       # interval 5s, loop mode
node backend/scripts/demo-tracking-simulator.js --interval=3000       # faster ticks
node backend/scripts/demo-tracking-simulator.js --mode=once           # stop each load at delivery
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--interval=<ms>` | `5000` | tick period |
| `--mode=loop\|once` | `loop` | `loop`: on arrival, pause 30s then restart from pickup (runs forever; the load stays `IN_TRANSIT`). `once`: mark DELIVERED and stop. |

### 3. Tear it down — `teardown-demo-tracking.js`

In one transaction, deletes the demo pings (`source_event_id='demo-sim'`), the
`DEMO-` loads + their stops, and the minted `DEMO-TRUCK-` trucks (no orphans).
Leaves `zip_codes` and all real data untouched. Prints a summary.

```bash
node backend/scripts/teardown-demo-tracking.js
```

---

## Demo prep checklist (client meeting)

1. **Point at the right DB.** `export DATABASE_URL=...` for the env the demo
   browser uses (usually dev). Confirm with `node backend/scripts/diagnose-loads-db.js`.
2. **Seed.** `node backend/scripts/seed-demo-tracking-loads.js` (50 demo trucks by
   default; dial with `--count=<n>` / `DEMO_TRUCK_COUNT`). Note the **tenant id** it
   prints.
3. **Log in** to the app as a user of that tenant.
4. **Start the simulator** in a terminal you can leave running:
   `node backend/scripts/demo-tracking-simulator.js`. Watch for `inserted N ping(s)`.
5. **Open `/tracking`.** ~50 markers spread across the country should appear within
   ~one interval and move every tick. Click a marker → side panel (driver shows if
   the truck has a `leased_driver_id`).
6. **(Optional)** `--interval=2000` for snappier motion on a short call.
7. **After the demo:** `Ctrl+C` the simulator, then
   `node backend/scripts/teardown-demo-tracking.js` to remove the synthetic data.
