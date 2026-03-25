/**
 * FN-238: Add MVR Disclosure, Authorization, and Release of Liability
 * consent templates with DQF auto-completion.
 *
 * 1. Upsert 3 consent templates:
 *    - mvr_disclosure
 *    - mvr_authorization
 *    - mvr_release_of_liability
 * 2. Seed 3 DQF requirements:
 *    - mvr_disclosure_signed
 *    - mvr_authorization_signed
 *    - mvr_release_of_liability_signed
 */

const TEMPLATES = [
  {
    key: 'mvr_disclosure',
    title: 'Motor Vehicle Record (MVR) Disclosure',
    body_text: buildMvrDisclosureHtml(),
    version: 1,
    is_active: true,
    cfr_reference: '15 U.S.C. \u00A71681b(b)(2)',
    requires_signature: true,
    capture_fields: JSON.stringify(['fullName'])
  },
  {
    key: 'mvr_authorization',
    title: 'Motor Vehicle Record (MVR) Authorization',
    body_text: buildMvrAuthorizationHtml(),
    version: 1,
    is_active: true,
    cfr_reference: '15 U.S.C. \u00A71681b(b)(2)',
    requires_signature: true,
    capture_fields: JSON.stringify(['fullName', 'dateOfBirth', 'driversLicenseNumber', 'stateOfIssue'])
  },
  {
    key: 'mvr_release_of_liability',
    title: 'Motor Vehicle Record (MVR) Release of Liability',
    body_text: buildMvrReleaseOfLiabilityHtml(),
    version: 1,
    is_active: true,
    cfr_reference: '15 U.S.C. \u00A71681b(b)(2)',
    requires_signature: true,
    capture_fields: JSON.stringify([])
  }
];

const DQF_REQUIREMENTS = [
  {
    key: 'mvr_disclosure_signed',
    label: 'MVR Disclosure Signed',
    category: 'pre_hire',
    weight: 6
  },
  {
    key: 'mvr_authorization_signed',
    label: 'MVR Authorization Signed',
    category: 'pre_hire',
    weight: 7
  },
  {
    key: 'mvr_release_of_liability_signed',
    label: 'MVR Release of Liability Signed',
    category: 'pre_hire',
    weight: 8
  }
];

exports.up = async function up(knex) {
  // ── 1) Upsert consent templates ───────────────────────────────────────
  const hasTemplatesTable = await knex.schema.hasTable('consent_templates');
  if (hasTemplatesTable) {
    for (const tpl of TEMPLATES) {
      const existing = await knex('consent_templates').where('key', tpl.key).first();
      if (existing) {
        await knex('consent_templates')
          .where('key', tpl.key)
          .update({
            title: tpl.title,
            body_text: tpl.body_text,
            cfr_reference: tpl.cfr_reference,
            requires_signature: tpl.requires_signature,
            capture_fields: tpl.capture_fields,
            updated_at: knex.fn.now()
          });
      } else {
        await knex('consent_templates').insert(tpl);
      }
    }
  }

  // ── 2) Seed DQF requirements ──────────────────────────────────────────
  const hasReqTable = await knex.schema.hasTable('dqf_requirements');
  if (!hasReqTable) return;

  // Check if the table has a 'category' column (some deployments may not)
  const cols = await knex.raw(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'dqf_requirements' AND column_name = 'category'`
  );
  const hasCategory = cols.rows.length > 0;

  for (const r of DQF_REQUIREMENTS) {
    const row = hasCategory
      ? { key: r.key, label: r.label, category: r.category, weight: r.weight }
      : { key: r.key, label: r.label, weight: r.weight };

    await knex('dqf_requirements')
      .insert(row)
      .onConflict('key')
      .ignore();
  }
};

exports.down = async function down(knex) {
  const hasTemplatesTable = await knex.schema.hasTable('consent_templates');
  if (hasTemplatesTable) {
    await knex('consent_templates')
      .whereIn('key', TEMPLATES.map((t) => t.key))
      .del();
  }

  const hasReqTable = await knex.schema.hasTable('dqf_requirements');
  if (hasReqTable) {
    await knex('dqf_requirements')
      .whereIn('key', DQF_REQUIREMENTS.map((r) => r.key))
      .del();
  }
};

// ── HTML template builders ──────────────────────────────────────────────

function buildMvrDisclosureHtml() {
  return `<h2>MOTOR VEHICLE RECORD (MVR) DISCLOSURE</h2>
<p>{{companyName}} (the "Company") may obtain information about you from a consumer reporting agency for employment purposes. This may include obtaining your Motor Vehicle Record ("MVR"), which contains information regarding your driving history, including traffic violations, accidents, license status, and other related information.</p>
<p>This information will be used solely for employment-related purposes, including but not limited to:</p>
<ul>
<li>Determining your eligibility for employment as a commercial driver</li>
<li>Evaluating your qualifications for continued employment</li>
<li>Compliance with Federal Motor Carrier Safety Administration (FMCSA) regulations</li>
</ul>
<p>The Company may obtain your MVR:</p>
<ul>
<li>Prior to employment</li>
<li>Periodically during your employment</li>
<li>When otherwise necessary for compliance or safety purposes</li>
</ul>
<p>The consumer reporting agency providing this information is not responsible for the Company's employment decisions.</p>
<p>This disclosure is provided in accordance with the Fair Credit Reporting Act (FCRA), 15 U.S.C. \u00A71681b(b)(2).</p>
<h3>ACKNOWLEDGMENT OF DISCLOSURE</h3>
<p>By signing below, I acknowledge that I have received and read this Motor Vehicle Record (MVR) Disclosure.</p>`;
}

function buildMvrAuthorizationHtml() {
  return `<h2>MOTOR VEHICLE RECORD (MVR) AUTHORIZATION</h2>
<p>I, the undersigned, hereby authorize {{companyName}} (the "Company") and/or its designated agents to obtain my Motor Vehicle Record (MVR) from any state motor vehicle agency or other authorized source.</p>
<p>I understand that this authorization allows the Company to:</p>
<ul>
<li>Obtain my driving record for employment purposes</li>
<li>Verify my eligibility to operate a commercial motor vehicle</li>
<li>Monitor my driving record during my employment</li>
</ul>
<p>This authorization is valid for:</p>
<ul>
<li>Pre-employment screening</li>
<li>Ongoing employment (including periodic reviews)</li>
</ul>
<p>I certify that the information I have provided is true and correct.</p>
<p>I understand that I have the right to request information about the nature and scope of this report.</p>
<p>This authorization is provided in compliance with the Fair Credit Reporting Act (FCRA), 15 U.S.C. \u00A71681b(b)(2), and applicable FMCSA regulations.</p>`;
}

function buildMvrReleaseOfLiabilityHtml() {
  return `<h2>MOTOR VEHICLE RECORD (MVR) RELEASE OF LIABILITY</h2>
<p>I, the undersigned, hereby release and hold harmless {{companyName}}, its officers, employees, agents, and any consumer reporting agencies from any and all liability arising from:</p>
<ul>
<li>The request for my Motor Vehicle Record (MVR)</li>
<li>The use of such information for employment purposes</li>
<li>Any decisions made based on the contents of my driving record</li>
</ul>
<p>I understand that my driving record may be obtained from state agencies and may include personal and sensitive information related to my driving history.</p>
<p>I acknowledge that this release is given voluntarily and is intended to be as broad and inclusive as permitted by law.</p>`;
}
