'use strict';

/**
 * FN-1758 — Tests for the geofence notify dispatcher (Story A — FN-1755).
 *
 * Uses a tiny in-memory knex-shaped read stub plus a fake notification-service
 * (capturing sendEmail / sendInAppNotification calls) so no Postgres, SendGrid,
 * or Twilio is needed. Covers: notify-trigger matching (event_kind + per-vehicle
 * scoping), recipient channel routing (user both/email/in_app, email-only type,
 * broker), the broker load-context template, recipient de-duplication across
 * triggers, and graceful handling of a broker with no contact email.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const dispatcher = require('./geofence-notify-dispatcher');

// ─── Minimal read-only knex stub ─────────────────────────────────────────────

function matchesEq(row, conds) {
  return Object.entries(conds).every(([k, v]) => row[k] === v);
}

class ReadBuilder {
  constructor(rows) {
    this.rows = rows || [];
    this.preds = [];
  }
  where(conds) {
    this.preds.push((r) => matchesEq(r, conds));
    return this;
  }
  whereIn(col, arr) {
    const set = new Set(arr);
    this.preds.push((r) => set.has(r[col]));
    return this;
  }
  _filtered() {
    return this.rows.filter((r) => this.preds.every((p) => p(r)));
  }
  first() {
    return Promise.resolve(this._filtered()[0]);
  }
  then(resolve, reject) {
    try {
      resolve(this._filtered());
    } catch (err) {
      reject ? reject(err) : (() => { throw err; })();
    }
  }
}

function makeKnex(state) {
  return (table) => new ReadBuilder(state[table] || []);
}

// ─── Fake notification-service ───────────────────────────────────────────────

function makeNotifier() {
  const emails = [];
  const inApp = [];
  return {
    emails,
    inApp,
    async sendEmail(opts) {
      emails.push(opts);
      return { sent: true, messageId: `msg-${emails.length}` };
    },
    async sendInAppNotification(_knex, opts) {
      inApp.push(opts);
      return { saved: true, id: `notif-${inApp.length}` };
    },
  };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const GEOFENCE = {
  id: 'gf-1',
  tenant_id: 'tenant-1',
  name: 'Pickup Yard',
  geometry: { type: 'Circle', center: [-87.63, 41.88], radius_m: 500 },
};

function baseState(overrides = {}) {
  return {
    geofences: [GEOFENCE],
    vehicles: [{ id: 'veh-1', unit_number: 'T-101', tenant_id: 'tenant-1' }],
    geofence_events: [{ id: 'evt-1', geofence_id: 'gf-1', vehicle_id: 'veh-1', event_kind: 'exit', ts: '2026-06-03T12:00:00.000Z', load_id: null }],
    geofence_triggers: [],
    geofence_trigger_recipients: [],
    users: [{ id: 'user-1', email: 'ops@acme.com', tenant_id: 'tenant-1' }],
    brokers: [{ id: 'broker-1', legal_name: 'Acme Logistics', email: 'broker@acme.com' }],
    loads: [{ id: 'load-1', load_number: 'L-555', status: 'IN_TRANSIT', pickup_location: 'Chicago, IL', delivery_location: 'Dallas, TX', broker_id: 'broker-1' }],
    ...overrides,
  };
}

const EVENT = { id: 'evt-1', geofence_id: 'gf-1', vehicle_id: 'veh-1', event_kind: 'exit', ts: '2026-06-03T12:00:00.000Z' };

function notifyTrigger(id, { vehicleId = null, eventKind = 'exit' } = {}) {
  return { id, geofence_id: 'gf-1', vehicle_id: vehicleId, event_kind: eventKind, action: 'notify' };
}

// ─── matchTriggers ───────────────────────────────────────────────────────────

describe('matchTriggers — event_kind + per-vehicle scoping', () => {
  it('matches notify triggers of the same event_kind; ignores other actions/kinds', async () => {
    const state = baseState({
      geofence_triggers: [
        notifyTrigger('t-exit'),
        notifyTrigger('t-enter', { eventKind: 'enter' }),
        { id: 't-webhook', geofence_id: 'gf-1', vehicle_id: null, event_kind: 'exit', action: 'webhook' },
        { id: 't-load', geofence_id: 'gf-1', vehicle_id: null, event_kind: 'exit', action: 'update_load_status' },
      ],
    });
    const matched = await dispatcher.matchTriggers(EVENT, makeKnex(state));
    assert.deepEqual(matched.map((t) => t.id), ['t-exit']);
  });

  it('NULL vehicle_id applies to all units; a specific vehicle_id must match', async () => {
    const state = baseState({
      geofence_triggers: [
        notifyTrigger('t-all', { vehicleId: null }),
        notifyTrigger('t-mine', { vehicleId: 'veh-1' }),
        notifyTrigger('t-other', { vehicleId: 'veh-2' }),
      ],
    });
    const matched = await dispatcher.matchTriggers(EVENT, makeKnex(state));
    assert.deepEqual(matched.map((t) => t.id).sort(), ['t-all', 't-mine']);
  });
});

// ─── Channel routing ─────────────────────────────────────────────────────────

describe('dispatchNotifyForEvent — channel routing', () => {
  let notifier;
  beforeEach(() => { notifier = makeNotifier(); });

  it('user + channel=both → in-app AND email to the user account email', async () => {
    const state = baseState({
      geofence_triggers: [notifyTrigger('t-1')],
      geofence_trigger_recipients: [{ id: 'r-1', trigger_id: 't-1', recipient_type: 'user', user_id: 'user-1', channel: 'both' }],
    });
    const res = await dispatcher.dispatchNotifyForEvent(EVENT, { notifier }, makeKnex(state));
    assert.equal(res.recipients, 1);
    assert.equal(notifier.inApp.length, 1);
    assert.equal(notifier.emails.length, 1);
    assert.equal(notifier.inApp[0].userId, 'user-1');
    assert.equal(notifier.inApp[0].type, 'geofence_alert');
    assert.equal(notifier.emails[0].to, 'ops@acme.com');
  });

  it('user + channel=in_app → in-app only (no email)', async () => {
    const state = baseState({
      geofence_triggers: [notifyTrigger('t-1')],
      geofence_trigger_recipients: [{ id: 'r-1', trigger_id: 't-1', recipient_type: 'user', user_id: 'user-1', channel: 'in_app' }],
    });
    await dispatcher.dispatchNotifyForEvent(EVENT, { notifier }, makeKnex(state));
    assert.equal(notifier.inApp.length, 1);
    assert.equal(notifier.emails.length, 0);
  });

  it('user + channel=email → email only (no in-app)', async () => {
    const state = baseState({
      geofence_triggers: [notifyTrigger('t-1')],
      geofence_trigger_recipients: [{ id: 'r-1', trigger_id: 't-1', recipient_type: 'user', user_id: 'user-1', channel: 'email' }],
    });
    await dispatcher.dispatchNotifyForEvent(EVENT, { notifier }, makeKnex(state));
    assert.equal(notifier.inApp.length, 0);
    assert.equal(notifier.emails.length, 1);
  });

  it('email recipient → email only, even with channel=both (no in-app, no user lookup)', async () => {
    const state = baseState({
      geofence_triggers: [notifyTrigger('t-1')],
      geofence_trigger_recipients: [{ id: 'r-1', trigger_id: 't-1', recipient_type: 'email', email: 'dispatch@broker.com', channel: 'both' }],
    });
    await dispatcher.dispatchNotifyForEvent(EVENT, { notifier }, makeKnex(state));
    assert.equal(notifier.inApp.length, 0);
    assert.equal(notifier.emails.length, 1);
    assert.equal(notifier.emails[0].to, 'dispatch@broker.com');
  });
});

// ─── Broker load-context ─────────────────────────────────────────────────────

describe('dispatchNotifyForEvent — broker load-context template', () => {
  it('broker recipient gets an email with load #, status, and the delivery stop on exit', async () => {
    const notifier = makeNotifier();
    const state = baseState({
      geofence_events: [{ id: 'evt-1', geofence_id: 'gf-1', vehicle_id: 'veh-1', event_kind: 'exit', ts: '2026-06-03T12:00:00.000Z', load_id: 'load-1' }],
      geofence_triggers: [notifyTrigger('t-1')],
      geofence_trigger_recipients: [{ id: 'r-1', trigger_id: 't-1', recipient_type: 'broker', broker_id: 'broker-1', channel: 'email' }],
    });
    await dispatcher.dispatchNotifyForEvent(EVENT, { notifier }, makeKnex(state));
    assert.equal(notifier.emails.length, 1);
    const mail = notifier.emails[0];
    assert.equal(mail.to, 'broker@acme.com');
    assert.match(mail.text, /L-555/);
    assert.match(mail.text, /IN_TRANSIT/);
    assert.match(mail.text, /Dallas, TX/); // delivery stop on exit
    assert.match(mail.subject, /L-555/);
  });

  it('broker with no contact email is skipped gracefully (no throw, no email)', async () => {
    const notifier = makeNotifier();
    const state = baseState({
      brokers: [{ id: 'broker-1', legal_name: 'No Email Broker', email: null }],
      geofence_events: [{ id: 'evt-1', geofence_id: 'gf-1', vehicle_id: 'veh-1', event_kind: 'exit', ts: '2026-06-03T12:00:00.000Z', load_id: 'load-1' }],
      geofence_triggers: [notifyTrigger('t-1')],
      geofence_trigger_recipients: [{ id: 'r-1', trigger_id: 't-1', recipient_type: 'broker', broker_id: 'broker-1', channel: 'email' }],
    });
    const res = await dispatcher.dispatchNotifyForEvent(EVENT, { notifier }, makeKnex(state));
    assert.equal(notifier.emails.length, 0);
    assert.equal(res.recipients, 1);
    assert.equal(res.dispatched[0].email.sent, false);
  });
});

// ─── Dedupe + no-op ──────────────────────────────────────────────────────────

describe('dispatchNotifyForEvent — dedupe + no-op', () => {
  it('a user configured on two matching triggers is contacted at most once', async () => {
    const notifier = makeNotifier();
    const state = baseState({
      geofence_triggers: [notifyTrigger('t-1'), notifyTrigger('t-2')],
      geofence_trigger_recipients: [
        { id: 'r-1', trigger_id: 't-1', recipient_type: 'user', user_id: 'user-1', channel: 'both' },
        { id: 'r-2', trigger_id: 't-2', recipient_type: 'user', user_id: 'user-1', channel: 'both' },
      ],
    });
    const res = await dispatcher.dispatchNotifyForEvent(EVENT, { notifier }, makeKnex(state));
    assert.equal(res.recipients, 1);
    assert.equal(notifier.emails.length, 1);
    assert.equal(notifier.inApp.length, 1);
  });

  it('no matching triggers → no recipients, no sends', async () => {
    const notifier = makeNotifier();
    const state = baseState({ geofence_triggers: [], geofence_trigger_recipients: [] });
    const res = await dispatcher.dispatchNotifyForEvent(EVENT, { notifier }, makeKnex(state));
    assert.equal(res.triggers, 0);
    assert.equal(res.recipients, 0);
    assert.equal(notifier.emails.length + notifier.inApp.length, 0);
  });
});
