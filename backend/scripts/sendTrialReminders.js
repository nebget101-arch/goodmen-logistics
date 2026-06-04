#!/usr/bin/env node
/**
 * FN-1694 (Story B / FN-1687) — Trial reminder runner.
 *
 * REPAIR of the previous version, which was unrunnable: it JOINed a
 * `trial_status` TABLE that does not exist (trial state lives in COLUMNS on
 * `tenants`), used MySQL `INTERVAL N DAY` syntax against Postgres, referenced
 * columns/tables that were never created (last_reminder_7d, email_preferences,
 * data_expiry_date, fleet_records), and required modules that don't exist
 * (`../database`, `../utils/logger`, and a trialEmailService whose `./emailService`
 * dependency is absent). It is also wired into nothing.
 *
 * This rewrite queries the REAL `tenants` trial columns with the shared knex
 * client, and sends through the shared billing-email-service (SendGrid, the same
 * primitive the other email services use). It is a one-shot CLI — run it from a
 * scheduler (Render Cron Job: `node backend/scripts/sendTrialReminders.js`,
 * suggested daily ~14:00 UTC). node-cron self-scheduling was removed (it was the
 * only consumer of that dep and the process was never started anywhere).
 *
 *   Reminders sent (only to active trials WITHOUT a card on file — a tenant with
 *   a payment method will be auto-converted by processTrialConversions.js, so a
 *   "your trial is ending, add a card" nudge would be wrong):
 *     • trial ends in exactly 7 / 3 / 1 day(s)  → "trial ending soon"
 *     • trial ended within the last day, not converted → "trial ended"
 *
 *   Once-per-threshold dedup without a tracking column: the day-distance buckets
 *   (7/3/1) are exact, so a daily run hits each tenant at most once per threshold.
 *   If the cadence ever changes from daily, add sent-tracking columns.
 *
 * Usage (from repo root):
 *   node backend/scripts/sendTrialReminders.js            # send
 *   node backend/scripts/sendTrialReminders.js --dry-run  # log recipients, send nothing
 *
 * Env: DATABASE_URL (or PG_* / DB_* vars) + SendGrid vars (SENDGRID_API_KEY,
 * SENDGRID_FROM_EMAIL). With SendGrid unconfigured the emails no-op gracefully
 * and the run still reports who WOULD have been notified.
 */

'use strict';

const path = require('path');
const fs = require('fs');

const backendDir = path.join(__dirname, '..');
const repoRoot = path.join(backendDir, '..');
process.chdir(repoRoot);

try {
  const dotenvPath = require.resolve('dotenv', {
    paths: [path.join(backendDir, 'packages', 'goodmen-shared')]
  });
  const dotenv = require(dotenvPath);
  const envFile =
    process.env.NODE_ENV === 'production' && fs.existsSync(path.join(repoRoot, '.env.production'))
      ? path.join(repoRoot, '.env.production')
      : path.join(repoRoot, '.env');
  dotenv.config({ path: envFile });
} catch (_) {
  /* dotenv optional */
}

const knex = require('../packages/goodmen-shared/config/knex');
const logger = require('../packages/goodmen-shared/utils/logger');
const billingEmailService = require('../packages/goodmen-shared/services/billing-email-service');

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_THRESHOLD_DAYS = [7, 3, 1];

/** Whole-days until `date` from `nowMs`, rounded up (a trial ending in 6.2 days → 7). */
function daysUntil(date, nowMs) {
  return Math.ceil((new Date(date).getTime() - nowMs) / DAY_MS);
}

/**
 * Active trials WITHOUT a payment method whose trial_end is within the next 8
 * days — the candidate set for the 7/3/1-day "ending soon" reminders.
 */
async function getEndingSoonCandidates(now) {
  const horizon = new Date(now.getTime() + 8 * DAY_MS);
  return knex('tenants')
    .where('trial_status', 'active')
    .whereNull('stripe_payment_method_id')
    .whereNotNull('trial_end')
    .where('trial_end', '>', now)
    .where('trial_end', '<=', horizon)
    .whereNotNull('email')
    .select('id', 'name', 'email', 'trial_end');
}

/**
 * Trials that lapsed within the last day without converting (no card) — the
 * "your trial has ended" notice, sent once on the day it ends.
 */
async function getJustEndedCandidates(now) {
  const since = new Date(now.getTime() - DAY_MS);
  return knex('tenants')
    .whereIn('trial_status', ['active', 'expired'])
    .whereNull('stripe_payment_method_id')
    .whereNotNull('trial_end')
    .where('trial_end', '<=', now)
    .where('trial_end', '>', since)
    .whereNotNull('email')
    .select('id', 'name', 'email', 'trial_end');
}

async function processTrialReminders({ dryRun = false } = {}) {
  const now = new Date();
  const nowMs = now.getTime();
  const summary = { endingSoon: 0, ended: 0, skipped: 0, failed: 0 };

  const [endingSoon, justEnded] = await Promise.all([
    getEndingSoonCandidates(now),
    getJustEndedCandidates(now)
  ]);

  // "Ending soon" — only the tenants exactly 7/3/1 days out.
  for (const tenant of endingSoon) {
    const daysRemaining = daysUntil(tenant.trial_end, nowMs);
    if (!REMINDER_THRESHOLD_DAYS.includes(daysRemaining)) {
      summary.skipped++;
      continue;
    }
    if (dryRun) {
      logger.info('trial_reminder_dry_run', { type: 'ending_soon', tenantId: tenant.id, email: tenant.email, daysRemaining });
      summary.endingSoon++;
      continue;
    }
    const res = await billingEmailService.sendTrialEndingSoonEmail({
      to: tenant.email,
      tenantName: tenant.name,
      daysRemaining,
      trialEndDate: tenant.trial_end
    });
    if (res.sent || res.reason === 'email_not_configured') summary.endingSoon++;
    else { summary.failed++; logger.error('trial_reminder_send_failed', { tenantId: tenant.id, reason: res.reason, error: res.error }); }
  }

  // "Trial ended"
  for (const tenant of justEnded) {
    if (dryRun) {
      logger.info('trial_reminder_dry_run', { type: 'ended', tenantId: tenant.id, email: tenant.email });
      summary.ended++;
      continue;
    }
    const res = await billingEmailService.sendTrialEndedEmail({ to: tenant.email, tenantName: tenant.name });
    if (res.sent || res.reason === 'email_not_configured') summary.ended++;
    else { summary.failed++; logger.error('trial_ended_send_failed', { tenantId: tenant.id, reason: res.reason, error: res.error }); }
  }

  logger.info('trial_reminders_complete', {
    dryRun,
    endingSoonCandidates: endingSoon.length,
    justEndedCandidates: justEnded.length,
    ...summary
  });
  return summary;
}

async function main() {
  const dryRun = process.argv.slice(2).includes('--dry-run');
  console.log(`— Trial reminders (FN-1694)${dryRun ? ' [dry-run]' : ''} —`);
  const summary = await processTrialReminders({ dryRun });
  console.log(
    `Done. ending-soon: ${summary.endingSoon}, ended: ${summary.ended}, ` +
      `skipped(out-of-window): ${summary.skipped}, failed: ${summary.failed}`
  );
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error('✗ Trial reminder run failed:', err.message);
      process.exitCode = 1;
    })
    .finally(() => knex.destroy());
}

module.exports = { processTrialReminders };
