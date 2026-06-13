'use strict';

/**
 * FN-1758 — Geofence notify dispatcher (Story A — FN-1755).
 *
 * Turns a newly-written `geofence_events` row into real notifications. For the
 * crossing's geofence it loads the `notify` triggers whose `event_kind` matches
 * the crossing (respecting per-vehicle scoping: a trigger with `vehicle_id`
 * NULL applies to every unit, otherwise it must match the event's vehicle),
 * resolves each trigger's `geofence_trigger_recipients`, and dispatches an
 * email (SendGrid) and/or an in-app `user_notifications` row through the shared
 * `notification-service.js`.
 *
 * Recipient types:
 *   user   → in-app bell + email to the user's account email (honors `channel`)
 *   email  → email only
 *   broker → email only, with a load-context template (load #, stop, status)
 *           keyed off the event's `load_id` (stamped by load-status automation)
 *
 * Channels: 'email' | 'in_app' | 'both'. `in_app` is only meaningful for the
 * `user` type (email/broker recipients have no in-app bell). No SMS — Phase-2
 * decision (FN-1755).
 *
 * Idempotency: the worker only calls this for a NEWLY inserted `geofence_events`
 * row — `insertEvent` returns null on the (ping_id, geofence_id, event_kind)
 * unique conflict, so a reprocessed ping never re-dispatches. That event-level
 * uniqueness IS the at-most-once guard; there is no separate dispatch ledger.
 * Within a single event, a recipient configured on more than one matching
 * trigger is de-duplicated here so it is contacted at most once.
 *
 * Best-effort: this module never throws into the worker. Per-recipient failures
 * are captured in the returned summary and skipped, so a notification problem
 * can never regress event writing or the load-status automation that runs
 * before it.
 */

const dbModule = require('../internal/db');
const defaultNotifier = require('./notification-service');

const GEOFENCE_ALERT_TYPE = 'geofence_alert';

// Human-readable verb per crossing kind, used in subjects/bodies.
const EVENT_VERBS = Object.freeze({
  enter: 'entered',
  exit: 'exited',
  dwell: 'is dwelling in',
});

function getDb() {
  return dbModule.knex;
}

function eventVerb(kind) {
  return EVENT_VERBS[kind] || kind;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? String(ts) : d.toISOString();
}

/** Parse a stored GeoJSON geometry (object or jsonb-as-string) → object|null. */
function parseGeometry(geometry) {
  if (typeof geometry === 'string') {
    try {
      return JSON.parse(geometry);
    } catch (_err) {
      return null;
    }
  }
  return geometry || null;
}

/** A representative [lng, lat] for a geofence: circle center or first vertex. */
function representativePoint(geometry) {
  const g = parseGeometry(geometry);
  if (!g) return null;
  if (Array.isArray(g.center)) return g.center;
  const ring = g.coordinates && g.coordinates[0];
  if (Array.isArray(ring) && ring.length) return ring[0];
  return null;
}

/** Google Maps link to a geofence's representative point, or null. */
function geofenceMapsUrl(geofence) {
  const point = geofence && representativePoint(geofence.geometry);
  if (!point) return null;
  const [lng, lat] = point;
  if (!Number.isFinite(Number(lng)) || !Number.isFinite(Number(lat))) return null;
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

// ─── Email templates (reusable alert + broker load-context variant) ──────────

/**
 * Reusable geofence-alert email: unit #, geofence name, event kind, timestamp,
 * location link. Used for `user` and `email` recipients (and as the body the
 * in-app bell reuses).
 */
function buildAlertEmail(ctx) {
  const verb = eventVerb(ctx.eventKind);
  const subject = `Geofence alert: ${ctx.unitLabel} ${verb} ${ctx.geofenceName}`;
  const lines = [
    `${ctx.unitLabel} ${verb} the geofence "${ctx.geofenceName}".`,
    `Event: ${ctx.eventKind}`,
    `Time: ${formatTimestamp(ctx.ts)}`,
  ];
  if (ctx.mapsUrl) lines.push(`Location: ${ctx.mapsUrl}`);
  const text = lines.join('\n');
  const html =
    `<p>${escapeHtml(ctx.unitLabel)} <strong>${escapeHtml(verb)}</strong> the geofence ` +
    `"<strong>${escapeHtml(ctx.geofenceName)}</strong>".</p>` +
    `<ul><li>Event: ${escapeHtml(ctx.eventKind)}</li>` +
    `<li>Time: ${escapeHtml(formatTimestamp(ctx.ts))}</li>` +
    (ctx.mapsUrl ? `<li>Location: <a href="${escapeHtml(ctx.mapsUrl)}">map</a></li>` : '') +
    `</ul>`;
  return { subject, text, html };
}

/**
 * Broker variant: the alert plus load context (load #, stop, status) drawn from
 * the event's load. The relevant stop is the delivery on an exit crossing and
 * the pickup otherwise (best-effort — geofences are not hard-linked to a stop).
 */
function buildBrokerAlertEmail(ctx, broker) {
  const base = buildAlertEmail(ctx);
  const brokerName = (broker && (broker.legal_name || broker.dba_name)) || 'Broker';
  const load = ctx.load;

  if (!load) {
    const text = `Hello ${brokerName},\n\n${base.text}`;
    const html = `<p>Hello ${escapeHtml(brokerName)},</p>${base.html}`;
    return { subject: base.subject, text, html };
  }

  const stop = ctx.eventKind === 'exit' ? load.delivery_location : load.pickup_location;
  const loadLines = [
    `Load #: ${load.load_number || '—'}`,
    `Status: ${load.status || '—'}`,
  ];
  if (stop) loadLines.push(`Stop: ${stop}`);

  const verb = eventVerb(ctx.eventKind);
  const subject = `Load ${load.load_number || ''} — ${ctx.unitLabel} ${verb} ${ctx.geofenceName}`.replace(/\s+/g, ' ').trim();
  const text = `Hello ${brokerName},\n\n${base.text}\n\n${loadLines.join('\n')}`;
  const html =
    `<p>Hello ${escapeHtml(brokerName)},</p>${base.html}` +
    `<ul>${loadLines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`;
  return { subject, text, html };
}

// ─── Resolution ──────────────────────────────────────────────────────────────

/**
 * `notify` triggers for the event's geofence whose event_kind matches, scoped
 * to the event's vehicle (NULL vehicle_id = all units).
 */
async function matchTriggers(event, conn = getDb()) {
  const rows = await conn('geofence_triggers').where({
    geofence_id: event.geofence_id,
    action: 'notify',
    event_kind: event.event_kind,
  });
  return rows.filter((t) => t.vehicle_id == null || t.vehicle_id === event.vehicle_id);
}

/** Stable identity for a recipient, so the same person on two triggers is contacted once. */
function recipientDedupeKey(r) {
  if (r.recipient_type === 'user') return `user:${r.user_id}`;
  if (r.recipient_type === 'email') return `email:${String(r.email || '').trim().toLowerCase()}`;
  if (r.recipient_type === 'broker') return `broker:${r.broker_id}`;
  return `id:${r.id}`;
}

function wantsEmail(channel) {
  return channel === 'email' || channel === 'both';
}
function wantsInApp(channel) {
  return channel === 'in_app' || channel === 'both';
}

/** Dispatch one resolved recipient. Returns a per-channel send summary. */
async function dispatchRecipient(recipient, ctx, conn, notifier) {
  const channel = recipient.channel || 'both';
  const out = { recipientType: recipient.recipient_type, email: null, inApp: null };

  if (recipient.recipient_type === 'user') {
    const user = await conn('users').where({ id: recipient.user_id }).first();
    const tmpl = buildAlertEmail(ctx);
    if (wantsInApp(channel) && user) {
      out.inApp = await notifier.sendInAppNotification(conn, {
        userId: recipient.user_id,
        tenantId: ctx.tenantId,
        type: GEOFENCE_ALERT_TYPE,
        title: tmpl.subject,
        body: tmpl.text,
        meta: {
          geofence_event_id: ctx.eventId,
          geofence_id: ctx.geofenceId,
          event_kind: ctx.eventKind,
          load_id: ctx.load ? ctx.load.id : null,
        },
      });
    }
    if (wantsEmail(channel) && user && user.email) {
      out.email = await notifier.sendEmail({ to: user.email, subject: tmpl.subject, text: tmpl.text, html: tmpl.html });
    } else if (wantsEmail(channel) && (!user || !user.email)) {
      out.email = { sent: false, error: 'user has no account email' };
    }
    return out;
  }

  if (recipient.recipient_type === 'email') {
    // External email address — email only regardless of channel.
    if (recipient.email) {
      const tmpl = buildAlertEmail(ctx);
      out.email = await notifier.sendEmail({ to: recipient.email, subject: tmpl.subject, text: tmpl.text, html: tmpl.html });
    } else {
      out.email = { sent: false, error: 'email recipient has no address' };
    }
    return out;
  }

  if (recipient.recipient_type === 'broker') {
    // Broker — email only, load-context template.
    const broker = recipient.broker_id
      ? await conn('brokers').where({ id: recipient.broker_id }).first()
      : null;
    if (broker && broker.email) {
      const tmpl = buildBrokerAlertEmail(ctx, broker);
      out.email = await notifier.sendEmail({ to: broker.email, subject: tmpl.subject, text: tmpl.text, html: tmpl.html });
    } else {
      out.email = { sent: false, error: 'broker has no contact email' };
    }
    return out;
  }

  return out;
}

/**
 * Dispatch notifications for one newly-written geofence event.
 *
 * @param {object} event  a geofence_events row { id, geofence_id, vehicle_id, event_kind, ts, load_id? }
 * @param {object} [options]
 * @param {object} [options.notifier]  notification-service shim (DI for tests)
 * @param {import('knex').Knex} [conn]
 * @returns {Promise<{triggers:number, recipients:number, dispatched:Array}>}
 */
async function dispatchNotifyForEvent(event, options = {}, conn = getDb()) {
  const notifier = options.notifier || defaultNotifier;
  const result = { triggers: 0, recipients: 0, dispatched: [] };
  if (!event || !event.id || !event.geofence_id || !event.event_kind) return result;

  const triggers = await matchTriggers(event, conn);
  if (!triggers.length) return result;
  result.triggers = triggers.length;

  const triggerIds = triggers.map((t) => t.id);
  const recipients = await conn('geofence_trigger_recipients').whereIn('trigger_id', triggerIds);
  if (!recipients.length) return result;

  // Shared context for templates. load_id is stamped onto the event by
  // load-status automation (which runs before dispatch), so re-read it.
  const geofence = await conn('geofences').where({ id: event.geofence_id }).first();
  const vehicle = await conn('vehicles').where({ id: event.vehicle_id }).first();
  const stamped = await conn('geofence_events').where({ id: event.id }).first();
  const loadId = (stamped && stamped.load_id) || event.load_id || null;
  const load = loadId ? await conn('loads').where({ id: loadId }).first() : null;

  const ctx = {
    eventId: event.id,
    geofenceId: event.geofence_id,
    eventKind: event.event_kind,
    ts: event.ts,
    geofenceName: (geofence && geofence.name) || 'geofence',
    tenantId: (geofence && geofence.tenant_id) || null,
    unitLabel: (vehicle && (vehicle.unit_number || vehicle.name)) || 'Unit',
    mapsUrl: geofenceMapsUrl(geofence),
    load: load || null,
  };

  const seen = new Set();
  for (const recipient of recipients) {
    const key = recipientDedupeKey(recipient);
    if (seen.has(key)) continue;
    seen.add(key);
    result.recipients += 1;
    try {
      const sent = await dispatchRecipient(recipient, ctx, conn, notifier);
      result.dispatched.push({ recipientId: recipient.id, ...sent });
    } catch (err) {
      result.dispatched.push({ recipientId: recipient.id, error: err.message || String(err) });
    }
  }

  return result;
}

module.exports = {
  GEOFENCE_ALERT_TYPE,
  dispatchNotifyForEvent,
  // exported for the worker + unit tests
  matchTriggers,
  buildAlertEmail,
  buildBrokerAlertEmail,
  geofenceMapsUrl,
};
