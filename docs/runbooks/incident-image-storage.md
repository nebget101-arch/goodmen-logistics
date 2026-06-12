# Runbook: Incident image storage (FN-1195 / FN-1233)

## Overview

Roadside v2 Story 3.1 lets drivers upload damage photos that are stored securely
and associated with an incident. Images live in a **Cloudflare R2** bucket
(S3-compatible API) under a **tenant-scoped prefix**; metadata rows live in the
`incident_images` Postgres table. Pre-signed `GET` URLs are generated on demand and
never persisted.

**Object key layout** (built by `incident-images.service.js` → `buildS3Key`):

```
tenants/{tenantId}/incidents/{incidentId}/{timestamp}-{filename}
```

**Services involved:**

| Component | Render name | Role |
|-----------|-------------|------|
| Drivers Compliance | `fleetneuron-drivers-compliance-service` | Hosts `POST /incidents/:id/images` upload + signed-URL retrieval |

**Code:**
- `backend/packages/goodmen-shared/storage/r2-storage.js` — R2 S3 client, `uploadBuffer`, `getSignedDownloadUrl`
- `backend/packages/goodmen-shared/services/incident-images.service.js` — validation, key building, tenant access check, metadata persistence
- `backend/packages/goodmen-shared/routes/incident-images.js` — route wiring
- `backend/packages/goodmen-database/migrations/20260611120000_create_incident_images.js` — `incident_images` table

**Validation enforced before any write:** max 10 MB; MIME ∈ {`image/jpeg`, `image/png`, `image/heic`}.

## Environment variables

Read by `r2-storage.js` / `incident-images.service.js`. **Required** vars throw on
first upload if unset.

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `R2_ACCOUNT_ID` | ✅ | — | Cloudflare account id. S3 endpoint derived as `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`. |
| `R2_BUCKET` | ✅ | — | Per-environment bucket (see naming below). |
| `R2_ACCESS_KEY_ID` | ✅ | — | Access key of the bucket-scoped R2 API token. |
| `R2_SECRET_ACCESS_KEY` | ✅ | — | Secret of the R2 API token. |
| `R2_REGION` | — | `auto` | R2 ignores region; the S3 client needs a value. |
| `INCIDENT_IMAGE_SIGNED_URL_TTL` | — | `900` | Signed GET URL lifetime (s), incident-image specific. |
| `R2_SIGNED_URL_EXPIRES_SECONDS` | — | `900` | Generic storage fallback TTL (s). |

The canonical declaration is `infra/render/drivers-compliance.yaml`; the
developer template is the incident-image block in `.env.example`. Secrets are set
in the **Render dashboard** (`sync: false`) — never committed.

> **Note on the original ticket text.** FN-1233 was written assuming AWS S3
> (`S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`). The
> backend (FN-1231) shipped on Cloudflare R2, so this runbook wires the `R2_*` vars
> the merged code actually reads. The AWS-S3 IAM policy in
> `infra/buckets/incident-images-policy.json` remains the canonical access intent
> and applies directly if the bucket is ever migrated to AWS S3.

## Bucket naming convention

| Environment | Bucket |
|-------------|--------|
| dev | `fleetneuron-incident-images-dev` |
| staging | `fleetneuron-incident-images-staging` |
| prod | `fleetneuron-incident-images-prod` |

## Tenant isolation — defense in depth

R2 does not enforce per-prefix IAM the way AWS S3 does, so isolation is layered:

1. **Application prefix enforcement (primary).** `buildS3Key` always writes under
   `tenants/{tenantId}/...` using the tenant id from the authenticated context, and
   `assertCallAccess` confirms the incident belongs to the caller's tenant before
   any read/write. A caller cannot address another tenant's prefix.
2. **Bucket-scoped API token.** The R2 token is scoped to the single
   incident-images bucket for that environment — a leaked key cannot reach other
   FleetNeuron buckets.
3. **Policy of record.** `infra/buckets/incident-images-policy.json` documents the
   tenant-prefix-scoped S3 IAM policy (Put/Get/Delete on
   `tenants/*/incidents/*`, List restricted to `tenants/*`, explicit Deny outside
   the prefix). Apply it verbatim on AWS S3; on R2 it is the reference intent.

## Provisioning a new environment

1. **Create the bucket** (Cloudflare dashboard → R2, or `wrangler`):
   ```bash
   wrangler r2 bucket create fleetneuron-incident-images-dev
   ```
2. **CORS** — allow the app origin to `GET`/`PUT` (signed URLs are used directly by
   the browser for retrieval):
   ```json
   [
     {
       "AllowedOrigins": ["https://<app-origin>"],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
3. **Lifecycle (optional)** — expire orphaned multipart uploads after 7 days; keep
   objects indefinitely (retention is product-driven, not set here).
4. **Create a bucket-scoped API token** (R2 → Manage API Tokens → Object
   Read & Write, scoped to this bucket). Record the Access Key ID + Secret.
5. **Wire env vars** into `fleetneuron-drivers-compliance-service` (Render →
   Environment), using `infra/render/drivers-compliance.yaml` as the checklist. Set
   `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`; the
   non-secret `R2_REGION` / TTL vars can take their documented defaults.
6. **Redeploy** the service so it picks up the new env.

## Verification

```bash
# 1. Upload (multipart) — expect 201 + JSON metadata row
curl -sS -X POST "$BASE/api/roadside/calls/$INCIDENT_ID/images" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@./damage.jpg;type=image/jpeg" | jq

# 2. Oversize / wrong format — expect 4xx with file_too_large / unsupported_format
curl -sS -X POST "$BASE/api/roadside/calls/$INCIDENT_ID/images" \
  -H "Authorization: Bearer $TOKEN" -F "file=@./big.tiff;type=image/tiff" -i | head

# 3. Retrieve — expect a short-lived signed URL; confirm it 200s, then 403s after TTL
curl -sS "$BASE/api/roadside/calls/$INCIDENT_ID/images" -H "Authorization: Bearer $TOKEN" | jq

# 4. Confirm the object landed under the tenant prefix
wrangler r2 object get "fleetneuron-incident-images-dev/tenants/$TENANT_ID/incidents/$INCIDENT_ID/..." --pipe | file -
```

Tenant isolation check: a token from tenant A must not retrieve tenant B's image
(expect 404 from `assertCallAccess`).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Missing required env var: R2_ACCOUNT_ID` (or `R2_BUCKET` / keys) on upload | env not wired on the service | Set the var in Render → Environment → redeploy |
| `403 SignatureDoesNotMatch` from R2 | wrong/rotated API token, or `R2_ACCOUNT_ID` mismatch | Re-check token pair + account id; confirm the endpoint host |
| `NoSuchBucket` | `R2_BUCKET` typo or wrong environment | Match bucket name to the env (naming table above) |
| Browser can't load signed URL (CORS) | bucket CORS missing the app origin | Add the origin to the bucket CORS policy |
| Signed URL works then 403s | expected — TTL elapsed | Re-request the listing endpoint for a fresh URL; tune `INCIDENT_IMAGE_SIGNED_URL_TTL` |

## Key rotation

1. Create a new bucket-scoped R2 API token.
2. Update `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` on the service → redeploy.
3. Verify an upload + retrieval.
4. Revoke the old token in Cloudflare.
