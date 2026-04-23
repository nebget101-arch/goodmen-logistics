'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const wsService = require('./websocket.service');

test('emitToTenant returns missing_args when inputs are incomplete', async () => {
	const r1 = await wsService.emitToTenant({});
	assert.equal(r1.delivered, false);
	assert.equal(r1.reason, 'missing_args');

	const r2 = await wsService.emitToTenant({ tenantId: 't1' });
	assert.equal(r2.delivered, false);
	assert.equal(r2.reason, 'missing_args');

	const r3 = await wsService.emitToTenant({ event: 'load:created' });
	assert.equal(r3.delivered, false);
	assert.equal(r3.reason, 'missing_args');
});

test('emitToTenant returns no_bridge when env is not configured', async () => {
	const prevUrl = process.env.INTERNAL_WS_EMIT_URL;
	const prevSecret = process.env.INTERNAL_WS_SECRET;
	delete process.env.INTERNAL_WS_EMIT_URL;
	delete process.env.INTERNAL_WS_SECRET;
	try {
		const r = await wsService.emitToTenant({
			tenantId: 't1',
			event: 'load:created',
			payload: { id: 'abc' }
		});
		assert.equal(r.delivered, false);
		assert.equal(r.reason, 'no_bridge');
	} finally {
		if (prevUrl !== undefined) process.env.INTERNAL_WS_EMIT_URL = prevUrl;
		if (prevSecret !== undefined) process.env.INTERNAL_WS_SECRET = prevSecret;
	}
});

test('_buildEnvelope includes tenantId, event, payload, emittedAt', () => {
	const env = wsService._buildEnvelope({
		tenantId: 't1',
		event: 'load:updated',
		payload: { id: 'x' }
	});
	assert.equal(env.tenantId, 't1');
	assert.equal(env.event, 'load:updated');
	assert.deepEqual(env.payload, { id: 'x' });
	assert.ok(typeof env.emittedAt === 'string' && env.emittedAt.length > 0);
});

test('_buildEnvelope normalizes null payload', () => {
	const env = wsService._buildEnvelope({ tenantId: 't1', event: 'e' });
	assert.equal(env.payload, null);
});
