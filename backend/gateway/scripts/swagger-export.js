#!/usr/bin/env node
/**
 * Fetches the aggregated OpenAPI spec from the gateway and writes it to
 * docs/api/openapi.json.
 *
 * Usage:
 *   node backend/gateway/scripts/swagger-export.js
 *   # or via npm script in backend/gateway:
 *   npm run swagger:export
 *
 * The gateway must be running (locally or on Render).
 */

const fs = require('fs');
const path = require('path');

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4000';
const OUTPUT_PATH = path.resolve(__dirname, '../../../docs/api/openapi.json');

async function main() {
  const specUrl = `${GATEWAY_URL}/api-docs-json`;

  // eslint-disable-next-line no-console
  console.log(`Fetching aggregated spec from ${specUrl} ...`);

  const res = await fetch(specUrl);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  const spec = await res.json();

  const pathCount = spec.paths ? Object.keys(spec.paths).length : 0;
  // eslint-disable-next-line no-console
  console.log(`Received spec with ${pathCount} paths`);

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(spec, null, 2) + '\n');

  // eslint-disable-next-line no-console
  console.log(`Written to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('swagger:export failed:', err.message);
  process.exit(1);
});
