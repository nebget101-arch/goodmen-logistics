/**
 * FN-228: Add FMCSA consent/authorization form legal text and new columns.
 *
 * 1. Add requires_signature (boolean) and capture_fields (jsonb) to consent_templates.
 * 2. Upsert 4 consent templates with full legal text:
 *    - fcra_disclosure
 *    - fcra_authorization
 *    - release_of_information
 *    - drug_alcohol_release (new key)
 * 3. Seed DQF requirement: drug_alcohol_release_signed
 */

exports.up = async function (knex) {
  // ── 1) Add new columns to consent_templates ──────────────────────────
  const hasTable = await knex.schema.hasTable('consent_templates');
  if (hasTable) {
    const hasRequiresSignature = await knex.schema.hasColumn('consent_templates', 'requires_signature');
    if (!hasRequiresSignature) {
      await knex.schema.alterTable('consent_templates', (t) => {
        t.boolean('requires_signature').defaultTo(true).comment('Whether this template requires a driver signature');
      });
    }

    const hasCaptureFields = await knex.schema.hasColumn('consent_templates', 'capture_fields');
    if (!hasCaptureFields) {
      await knex.schema.alterTable('consent_templates', (t) => {
        t.jsonb('capture_fields').defaultTo('[]').comment('JSON array of field names to capture during signing');
      });
    }
  }

  // ── 2) Upsert consent templates with full legal text ─────────────────
  if (hasTable) {
    const templates = [
      {
        key: 'fcra_disclosure',
        title: 'Fair Credit Reporting Act (FCRA) Disclosure',
        body_text: buildFcraDisclosureHtml(),
        version: 1,
        is_active: true,
        cfr_reference: '15 U.S.C. \u00A7 1681 et seq.',
        requires_signature: false,
        capture_fields: JSON.stringify([])
      },
      {
        key: 'fcra_authorization',
        title: 'Fair Credit Reporting Act (FCRA) Authorization',
        body_text: buildFcraAuthorizationHtml(),
        version: 1,
        is_active: true,
        cfr_reference: '15 U.S.C. \u00A7 1681b',
        requires_signature: true,
        capture_fields: JSON.stringify(['fullName', 'dateOfBirth', 'ssnLast4', 'driversLicenseNumber', 'stateOfIssue'])
      },
      {
        key: 'release_of_information',
        title: 'Release of Information Authorization (Driver Qualification & Safety Performance History)',
        body_text: buildReleaseOfInformationHtml(),
        version: 1,
        is_active: true,
        cfr_reference: '49 CFR \u00A7391.23',
        requires_signature: true,
        capture_fields: JSON.stringify(['fullName', 'dateOfBirth', 'driversLicenseNumber', 'stateOfIssue'])
      },
      {
        key: 'drug_alcohol_release',
        title: 'Release of Information Authorization (49 CFR Part 40 \u2013 Drug and Alcohol Testing Records)',
        body_text: buildDrugAlcoholReleaseHtml(),
        version: 1,
        is_active: true,
        cfr_reference: '49 CFR Part 40',
        requires_signature: true,
        capture_fields: JSON.stringify(['fullName', 'dateOfBirth', 'driversLicenseNumber', 'stateOfIssue'])
      }
    ];

    for (const tpl of templates) {
      // Check if the key already exists
      const existing = await knex('consent_templates').where('key', tpl.key).first();
      if (existing) {
        // Update existing template with full legal text
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
        // Insert new template
        await knex('consent_templates').insert(tpl);
      }
    }
  }

  // ── 3) Seed DQF requirement for drug_alcohol_release ─────────────────
  const hasReqTable = await knex.schema.hasTable('dqf_requirements');
  if (hasReqTable) {
    await knex('dqf_requirements')
      .insert({
        key: 'drug_alcohol_release_signed',
        label: 'Drug & Alcohol Release of Information Signed (49 CFR Part 40)',
        weight: 5
      })
      .onConflict('key')
      .ignore();
  }
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable('consent_templates');
  if (hasTable) {
    // Remove the new template
    await knex('consent_templates').where('key', 'drug_alcohol_release').del();

    // Drop added columns
    const hasRequiresSignature = await knex.schema.hasColumn('consent_templates', 'requires_signature');
    if (hasRequiresSignature) {
      await knex.schema.alterTable('consent_templates', (t) => {
        t.dropColumn('requires_signature');
      });
    }

    const hasCaptureFields = await knex.schema.hasColumn('consent_templates', 'capture_fields');
    if (hasCaptureFields) {
      await knex.schema.alterTable('consent_templates', (t) => {
        t.dropColumn('capture_fields');
      });
    }
  }

  const hasReqTable = await knex.schema.hasTable('dqf_requirements');
  if (hasReqTable) {
    await knex('dqf_requirements').where('key', 'drug_alcohol_release_signed').del();
  }
};

// ── HTML template builders ──────────────────────────────────────────────

function buildFcraDisclosureHtml() {
  return `<h2>FAIR CREDIT REPORTING ACT (FCRA) DISCLOSURE</h2>

<p><strong>Company Name:</strong> {{companyName}}<br/>
<strong>Address:</strong> {{companyAddress}}</p>

<p>In connection with your application for employment, contract engagement, or to operate a commercial motor vehicle under our authority, {{companyName}} may obtain one or more consumer reports and/or investigative consumer reports about you for employment purposes.</p>

<p>A consumer report may include information regarding your:</p>
<ul>
  <li>Driving record (Motor Vehicle Record \u2013 MVR)</li>
  <li>Employment history and verification</li>
  <li>Background checks (including criminal history, where permitted by law)</li>
  <li>Drug and alcohol testing history (including FMCSA Drug and Alcohol Clearinghouse records)</li>
  <li>Licensing status and endorsements</li>
</ul>

<p>An investigative consumer report may include information obtained through personal interviews with your previous employers, references, or others regarding your:</p>
<ul>
  <li>Character</li>
  <li>General reputation</li>
  <li>Personal characteristics</li>
  <li>Mode of living</li>
</ul>

<p>These reports may be obtained from consumer reporting agencies or other sources at any time:</p>
<ul>
  <li>Before your employment or engagement</li>
  <li>During your employment (if hired or contracted)</li>
  <li>When making decisions related to retention, promotion, reassignment, or discipline</li>
</ul>

<p>You have the right, upon written request, to:</p>
<ol>
  <li>Request whether an investigative consumer report has been obtained</li>
  <li>Request a written summary of your rights under the Fair Credit Reporting Act</li>
  <li>Request additional information about the nature and scope of any investigative consumer report</li>
</ol>

<p>This disclosure is provided to you in compliance with the Fair Credit Reporting Act (FCRA), 15 U.S.C. \u00A7 1681 et seq.</p>

<p><strong>IMPORTANT:</strong> This document is a disclosure only. It does not require your authorization or signature. A separate authorization form will be provided for your consent.</p>`;
}

function buildFcraAuthorizationHtml() {
  return `<h2>FAIR CREDIT REPORTING ACT (FCRA) AUTHORIZATION</h2>

<p><strong>Company Name:</strong> {{companyName}}<br/>
<strong>Address:</strong> {{companyAddress}}</p>

<p><strong>Applicant Name:</strong> {{driverFullName}}</p>

<p>I, {{driverFullName}}, hereby authorize {{companyName}} and its designated agents and representatives to conduct a comprehensive background investigation on me as part of the application process for employment, contract engagement, or authorization to operate a commercial motor vehicle under their authority.</p>

<p>I authorize the procurement of consumer reports and/or investigative consumer reports prepared by a consumer reporting agency, and I understand that these reports may contain information regarding my:</p>
<ul>
  <li>Motor Vehicle Record (MVR) from any state in which I hold or have held a driver\u2019s license</li>
  <li>Employment history and verification with previous employers</li>
  <li>Criminal background history (where permitted by applicable federal, state, and local law)</li>
  <li>Drug and alcohol testing history, including records from the FMCSA Drug and Alcohol Clearinghouse</li>
  <li>Commercial driver\u2019s license status, endorsements, and restrictions</li>
</ul>

<p>I authorize any and all previous employers, educational institutions, government agencies, law enforcement agencies, courts, consumer reporting agencies, and other persons or entities to furnish the above-referenced information to {{companyName}} or its authorized representatives.</p>

<p>I understand that:</p>
<ul>
  <li>This authorization, in original or copy form, shall be valid for the duration of my employment or engagement with {{companyName}}</li>
  <li>I may revoke this authorization at any time by providing written notice to {{companyName}}</li>
  <li>If adverse action is taken based in whole or in part on information obtained from a consumer report, I will be provided with a copy of the report and a written summary of my rights under the FCRA before or at the time of the adverse action</li>
  <li>I have the right to dispute the accuracy or completeness of any information contained in my consumer report directly with the consumer reporting agency</li>
</ul>

<p>This authorization is provided in compliance with the Fair Credit Reporting Act (FCRA), 15 U.S.C. \u00A7 1681b.</p>`;
}

function buildReleaseOfInformationHtml() {
  return `<h2>RELEASE OF INFORMATION AUTHORIZATION</h2>
<h3>Driver Qualification &amp; Safety Performance History</h3>

<p><strong>Company Name:</strong> {{companyName}}<br/>
<strong>Address:</strong> {{companyAddress}}</p>

<p><strong>Applicant Name:</strong> {{driverFullName}}</p>

<p>I, {{driverFullName}}, hereby authorize {{companyName}} and its designated agents and representatives to contact my previous employers and other relevant parties to obtain and verify information related to my driver qualification file and safety performance history, as required under 49 CFR \u00A7391.23.</p>

<p>I authorize the release of the following information from my previous employers (DOT-regulated and non-DOT-regulated):</p>
<ul>
  <li>General driver qualification information, including dates of employment and position(s) held</li>
  <li>Motor Vehicle Record (MVR) information</li>
  <li>Safety performance history, including any accidents as defined in 49 CFR \u00A7390.5 within the previous three (3) years</li>
  <li>Any information related to my compliance with Federal Motor Carrier Safety Regulations (FMCSRs)</li>
  <li>Commercial driver\u2019s license status, endorsements, restrictions, and any disqualifications</li>
  <li>Drug and alcohol testing records as required under 49 CFR Part 40, including:
    <ul>
      <li>Pre-employment test results</li>
      <li>Random, post-accident, reasonable suspicion, and return-to-duty test results</li>
      <li>Any refusal to test</li>
      <li>Any violation of DOT drug and alcohol regulations</li>
      <li>Documentation of completion of return-to-duty process, if applicable</li>
    </ul>
  </li>
</ul>

<p>I authorize any and all previous employers, state and federal agencies, Consortia/Third-Party Administrators (C/TPAs), Medical Review Officers (MROs), Substance Abuse Professionals (SAPs), and testing laboratories to release the above-referenced information to {{companyName}} or its authorized representatives.</p>

<p>I understand that:</p>
<ul>
  <li>The information obtained will be used solely for the purpose of determining my qualification to operate a commercial motor vehicle</li>
  <li>I have the right to review the information provided by any previous employer</li>
  <li>I have the right to have errors corrected by the previous employer and to have a rebuttal entered into my safety performance history</li>
  <li>I may revoke this authorization at any time by providing written notice to {{companyName}}, but revocation will not affect information already obtained</li>
</ul>

<p>This authorization is provided in compliance with 49 CFR \u00A7391.23 and the Federal Motor Carrier Safety Regulations.</p>`;
}

function buildDrugAlcoholReleaseHtml() {
  return `<h2>RELEASE OF INFORMATION AUTHORIZATION</h2>
<h3>49 CFR Part 40 \u2013 Drug and Alcohol Testing Records</h3>

<p><strong>Company Name:</strong> {{companyName}}<br/>
<strong>Address:</strong> {{companyAddress}}</p>

<p><strong>Applicant Name:</strong> {{driverFullName}}</p>

<p>I, {{driverFullName}}, hereby authorize the release of my drug and alcohol testing records from all previous DOT-regulated employers, Consortia/Third-Party Administrators (C/TPAs), Medical Review Officers (MROs), Substance Abuse Professionals (SAPs), and testing laboratories to {{companyName}} and its designated agents and representatives.</p>

<p>Specifically, I authorize the release of the following information for the previous three (3) years, or as otherwise required by regulation:</p>
<ul>
  <li>Alcohol test results of 0.04 or greater</li>
  <li>Verified positive drug test results</li>
  <li>Refusals to be tested (including adulterated or substituted drug test results)</li>
  <li>Other violations of DOT agency drug and alcohol testing regulations</li>
  <li>Information obtained from previous employers regarding drug and alcohol rule violations</li>
  <li>Documentation of completion of the return-to-duty process and follow-up testing plan, if applicable</li>
</ul>

<p>I authorize the following parties to release this information to {{companyName}}:</p>
<ul>
  <li>Previous DOT-regulated employers</li>
  <li>Consortia/Third-Party Administrators (C/TPAs) who maintained my testing records</li>
  <li>Medical Review Officers (MROs) who verified my test results</li>
  <li>Substance Abuse Professionals (SAPs) who evaluated me, if applicable</li>
  <li>SAMHSA-certified laboratories that conducted testing on my specimens</li>
</ul>

<p>I understand that:</p>
<ul>
  <li>This information is being requested in accordance with 49 CFR Part 40 and 49 CFR Part 382</li>
  <li>The information obtained will be used solely for the purpose of determining my eligibility to perform safety-sensitive functions, including operating a commercial motor vehicle</li>
  <li>I have the right to review the information released and to request corrections if any information is inaccurate</li>
  <li>If drug or alcohol violation information is reported, I may not perform safety-sensitive functions until the return-to-duty process has been completed as specified in 49 CFR Part 40, Subpart O</li>
  <li>I may revoke this authorization at any time by providing written notice to {{companyName}}, but revocation will not affect information already obtained</li>
</ul>

<p>This authorization is provided in compliance with 49 CFR Part 40 and the Federal Motor Carrier Safety Regulations.</p>`;
}
