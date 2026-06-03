'use strict';

/**
 * Shared WebSocket emit helper (FN-811).
 *
 * Microservices import this after successful mutations to broadcast events to
 * the tenant's Socket.IO room on the gateway.
 *
 *   await emitToTenant({ tenantId, event: 'load:updated', payload: load });
 *
 * Delivery mechanics:
 *   - POSTs to `INTERNAL_WS_EMIT_URL` (e.g. `http://gateway/internal/ws/emit`)
 *     with `X-Internal-Token: <INTERNAL_WS_SECRET>`.
 *   - Fire-and-forget — never throws, never blocks the HTTP response. If the
 *     gateway is unreachable or the bridge is not configured, the emit is
 *     silently dropped and a warn-level log is emitted.
 *
 * The gateway attaches the Socket.IO server and mounts `/internal/ws/emit`
 * itself (see `backend/gateway/index.js`). This module never loads socket.io.
 */

const requireFromRoot = require('../internal/require-from-root');
const dtLogger = require('../utils/logger');

const EMIT_TIMEOUT_MS = 2000;

function buildEnvelope({ tenantId, event, payload }) {
	return {
		tenantId,
		event,
		payload: payload == null ? null : payload,
		emittedAt: new Date().toISOString()
	};
}

/**
 * FN-1672 — Live-map broadcast helper.
 *
 * Normalizes a freshly-ingested vehicle position into the wire shape the
 * `/api/vehicle-positions` read endpoint emits per marker, then broadcasts it
 * on the `vehicle:position` event so the live map can patch the marker in place
 * (the client already holds the static vehicle metadata from the initial list).
 *
 * Called fire-and-forget from the telematics ingest path
 * (integrations-service/services/telematics-ingest-service.js) after a ping is
 * persisted. Like emitToTenant, it never throws and never blocks ingestion.
 */
function buildVehiclePositionPayload(position = {}) {
	const num = (v) => (v == null || v === '' ? null : Number(v));
	const ts =
		position.ts == null
			? null
			: position.ts instanceof Date
				? position.ts.toISOString()
				: String(position.ts);
	return {
		vehicleId: position.vehicleId != null ? String(position.vehicleId) : null,
		lat: num(position.lat),
		lng: num(position.lng),
		speedMph: num(position.speedMph),
		headingDeg: num(position.headingDeg),
		ts
	};
}

async function emitVehiclePosition({ tenantId, position } = {}) {
	if (!tenantId || !position || position.vehicleId == null) {
		return { delivered: false, reason: 'missing_args' };
	}
	return emitToTenant({
		tenantId,
		event: 'vehicle:position',
		payload: buildVehiclePositionPayload(position)
	});
}

async function emitToTenant({ tenantId, event, payload } = {}) {
	if (!tenantId || !event) {
		return { delivered: false, reason: 'missing_args' };
	}

	const url = process.env.INTERNAL_WS_EMIT_URL;
	const secret = process.env.INTERNAL_WS_SECRET;
	if (!url || !secret) {
		return { delivered: false, reason: 'no_bridge' };
	}

	const envelope = buildEnvelope({ tenantId, event, payload });

	try {
		const axios = requireFromRoot('axios');
		await axios.post(url, envelope, {
			headers: {
				'X-Internal-Token': secret,
				'Content-Type': 'application/json'
			},
			timeout: EMIT_TIMEOUT_MS
		});
		return { delivered: true };
	} catch (err) {
		dtLogger.warn('ws_emit_failed', {
			event,
			tenantId,
			url,
			error: err.message
		});
		return { delivered: false, reason: 'http_error', error: err.message };
	}
}

module.exports = {
	emitToTenant,
	emitVehiclePosition,
	// exposed for tests
	_buildEnvelope: buildEnvelope,
	_buildVehiclePositionPayload: buildVehiclePositionPayload
};
