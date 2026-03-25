/**
 * FN-239: Update consent_templates with full FMCSA-compliant legal text
 * containing dynamic placeholders.
 *
 * Updates all 4 consent templates:
 *   - fcra_disclosure        (requires_signature changed to true, capture_fields added)
 *   - fcra_authorization
 *   - release_of_information
 *   - drug_alcohol_release
 *
 * All templates bumped to version 2 with revised HTML body text.
 */

exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('consent_templates');
  if (!hasTable) return;

  // 1. fcra_disclosure — requires_signature changed to true, capture_fields added
  await knex('consent_templates')
    .where('key', 'fcra_disclosure')
    .update({
      title: 'Fair Credit Reporting Act (FCRA) Disclosure',
      version: 2,
      requires_signature: true,
      capture_fields: JSON.stringify(['fullName']),
      cfr_reference: '15 U.S.C. \u00A7 1681 et seq.',
      body_text: buildFcraDisclosureHtml(),
      updated_at: knex.fn.now()
    });

  // 2. fcra_authorization
  await knex('consent_templates')
    .where('key', 'fcra_authorization')
    .update({
      title: 'Fair Credit Reporting Act (FCRA) Authorization',
      version: 2,
      requires_signature: true,
      capture_fields: JSON.stringify(['fullName', 'dateOfBirth', 'ssnLast4', 'driversLicenseNumber', 'stateOfIssue']),
      cfr_reference: '15 U.S.C. \u00A7 1681 et seq.',
      body_text: buildFcraAuthorizationHtml(),
      updated_at: knex.fn.now()
    });

  // 3. release_of_information
  await knex('consent_templates')
    .where('key', 'release_of_information')
    .update({
      title: 'Release of Information Authorization (Driver Qualification & Safety Performance History)',
      version: 2,
      requires_signature: true,
      capture_fields: JSON.stringify(['fullName', 'dateOfBirth', 'driversLicenseNumber', 'stateOfIssue']),
      cfr_reference: '49 CFR 391.23',
      body_text: buildReleaseOfInformationHtml(),
      updated_at: knex.fn.now()
    });

  // 4. drug_alcohol_release
  await knex('consent_templates')
    .where('key', 'drug_alcohol_release')
    .update({
      title: 'Release of Information Authorization (49 CFR Part 40 \u2013 Drug and Alcohol Testing Records)',
      version: 2,
      requires_signature: true,
      capture_fields: JSON.stringify(['fullName', 'dateOfBirth', 'driversLicenseNumber', 'stateOfIssue']),
      cfr_reference: '49 CFR Part 40',
      body_text: buildDrugAlcoholReleaseHtml(),
      updated_at: knex.fn.now()
    });
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable('consent_templates');
  if (!hasTable) return;

  // Revert all templates back to version 1 (restore previous state from FN-228 migration)
  await knex('consent_templates')
    .where('key', 'fcra_disclosure')
    .update({
      version: 1,
      requires_signature: false,
      capture_fields: JSON.stringify([]),
      updated_at: knex.fn.now()
    });

  await knex('consent_templates')
    .where('key', 'fcra_authorization')
    .update({ version: 1, updated_at: knex.fn.now() });

  await knex('consent_templates')
    .where('key', 'release_of_information')
    .update({ version: 1, updated_at: knex.fn.now() });

  await knex('consent_templates')
    .where('key', 'drug_alcohol_release')
    .update({ version: 1, updated_at: knex.fn.now() });
};

// ── HTML template builders ──────────────────────────────────────────────────

function buildFcraDisclosureHtml() {
  return `<h2>FAIR CREDIT REPORTING ACT (FCRA) DISCLOSURE</h2>
<p><strong>Company Name:</strong> {{companyName}}</p>
<p><strong>Address:</strong> {{companyAddress}}</p>

<p>In connection with your application for employment, contract engagement, or to operate a commercial motor vehicle under our authority, <strong>{{companyName}}</strong> may obtain one or more consumer reports and/or investigative consumer reports about you for employment purposes.</p>

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

<p><strong>IMPORTANT:</strong><br/>This document is a disclosure only. It does not require your authorization. A separate authorization form will be provided for your consent.</p>`;
}

function buildFcraAuthorizationHtml() {
  return `<h2>FAIR CREDIT REPORTING ACT (FCRA) AUTHORIZATION</h2>
<p><strong>Company Name:</strong> {{companyName}}</p>
<p><strong>Address:</strong> {{companyAddress}}</p>

<p>I, <strong>{{driverFullName}}</strong>, the undersigned individual ("Applicant/Driver"), hereby authorize <strong>{{companyName}}</strong> and its designated agents and representatives to obtain consumer reports and/or investigative consumer reports about me for employment purposes.</p>

<p>I understand that these reports may include, but are not limited to, information regarding my:</p>
<ul>
<li>Motor Vehicle Records (MVR) and driving history</li>
<li>Employment history and verification</li>
<li>Criminal background (where permitted by law)</li>
<li>Drug and alcohol testing history, including records from the FMCSA Drug and Alcohol Clearinghouse</li>
<li>Licensing status, endorsements, and qualifications</li>
</ul>

<p>I authorize all federal, state, and local agencies, prior employers, educational institutions, licensing authorities, and other persons or organizations to provide any and all information requested by <strong>{{companyName}}</strong> or its consumer reporting agency.</p>

<p>I understand that this authorization shall remain valid:</p>
<ul>
<li>Throughout the application process</li>
<li>During my employment or contractual engagement, if hired</li>
<li>For periodic background checks where permitted by law</li>
</ul>

<p>I understand that I have rights under the Fair Credit Reporting Act, including the right to request additional disclosures and a summary of my rights.</p>

<p>I acknowledge that I have received and reviewed the separate FCRA Disclosure provided to me.</p>

<p><strong>For Electronic Signature:</strong><br/>I consent to the use of electronic records and signatures in connection with this authorization. I understand that my electronic signature is legally binding.</p>`;
}

function buildReleaseOfInformationHtml() {
  return `<h2>RELEASE OF INFORMATION AUTHORIZATION</h2>
<h3>Driver Qualification & Safety Performance History</h3>
<p><strong>Company Name:</strong> {{companyName}}</p>
<p><strong>Address:</strong> {{companyAddress}}</p>

<p>I, <strong>{{driverFullName}}</strong>, the undersigned ("Applicant/Driver"), hereby authorize and grant permission to <strong>{{companyName}}</strong>, its agents, and representatives to obtain, review, and verify information regarding my background for employment and compliance purposes as a commercial motor vehicle operator.</p>

<p>This authorization includes permission to contact and obtain information from:</p>
<ul>
<li>Previous employers (including DOT-regulated employers within the past three (3) years)</li>
<li>Federal, state, and local agencies</li>
<li>Consumer reporting agencies</li>
<li>Educational institutions and licensing authorities</li>
<li>Drug and alcohol testing programs and consortiums</li>
<li>The FMCSA Drug and Alcohol Clearinghouse</li>
</ul>

<p>I specifically authorize the release of the following information, where applicable:</p>
<ul>
<li>Employment history and verification</li>
<li>Safety performance history (including accident and incident records)</li>
<li>Drug and alcohol testing records, including any violations or return-to-duty status</li>
<li>Motor Vehicle Records (MVR) and driving history</li>
<li>Licensing status, endorsements, and qualifications</li>
<li>Any other records required to comply with applicable federal regulations</li>
</ul>

<p>I understand that this authorization is required to comply with federal regulations governing commercial motor vehicle operators, including applicable provisions of the Federal Motor Carrier Safety Regulations (FMCSR).</p>

<p>I further authorize any individual, organization, or entity in possession of such information to release it to <strong>{{companyName}}</strong>, and I release such parties from any and all liability for providing such information in good faith.</p>

<p>This authorization shall remain valid:</p>
<ul>
<li>During the application process</li>
<li>During my employment or contractual engagement, if hired</li>
<li>As required for ongoing compliance with federal regulations</li>
</ul>

<p>A copy or electronic version of this authorization shall be considered as valid as the original.</p>

<p><strong>For Electronic Signature:</strong><br/>I consent to the use of electronic records and signatures in connection with this authorization. I understand that my electronic signature is legally binding.</p>`;
}

function buildDrugAlcoholReleaseHtml() {
  return `<h2>RELEASE OF INFORMATION AUTHORIZATION</h2>
<h3>49 CFR Part 40 \u2013 Drug and Alcohol Testing Records</h3>
<p><strong>Company Name:</strong> {{companyName}}</p>
<p><strong>Address:</strong> {{companyAddress}}</p>

<p>I, <strong>{{driverFullName}}</strong>, the undersigned ("Applicant/Driver"), hereby authorize and grant permission to <strong>{{companyName}}</strong>, its agents, and representatives to obtain and review my drug and alcohol testing records as required by federal regulations.</p>

<p>This authorization is provided in accordance with the U.S. Department of Transportation regulations, including 49 CFR Part 40 and applicable Federal Motor Carrier Safety Regulations.</p>

<p>I authorize all of my previous DOT-regulated employers, consortiums/third-party administrators (C/TPAs), Medical Review Officers (MROs), Substance Abuse Professionals (SAPs), and testing laboratories to release the following information to <strong>{{companyName}}</strong>:</p>
<ul>
<li>Results of alcohol tests with a concentration of 0.04 or greater</li>
<li>Verified positive drug test results</li>
<li>Refusals to be tested (including adulterated or substituted test results)</li>
<li>Other violations of DOT drug and alcohol testing regulations</li>
<li>Documentation of completion of the return-to-duty (RTD) process</li>
<li>Follow-up testing plans and records</li>
</ul>

<p>This information is requested for the purpose of evaluating my qualifications for safety-sensitive functions, including operating a commercial motor vehicle.</p>

<p>I understand that:</p>
<ul>
<li>This information is required under federal regulations before I may perform safety-sensitive duties</li>
<li>My prior employers are required to provide this information within applicable regulatory timelines</li>
<li>Failure to provide accurate and complete information may affect my eligibility for employment</li>
</ul>

<p>This authorization covers all DOT-regulated employers I have worked for within the past three (3) years.</p>

<p>I release all persons and organizations providing such information from any and all liability for providing such information in good faith in accordance with applicable laws and regulations.</p>

<p>This authorization shall remain valid:</p>
<ul>
<li>During the application process</li>
<li>During my employment or contractual engagement, if hired</li>
<li>As required for ongoing compliance with federal regulations</li>
</ul>

<p>A copy or electronic version of this authorization shall be considered as valid as the original.</p>

<p><strong>For Electronic Signature:</strong><br/>I consent to the use of electronic records and signatures in connection with this authorization. I understand that my electronic signature is legally binding.</p>`;
}
