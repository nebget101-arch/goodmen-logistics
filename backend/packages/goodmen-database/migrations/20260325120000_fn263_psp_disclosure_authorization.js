/**
 * FN-263: Update PSP consent template with full FMCSA-mandated
 * PSP Disclosure and Authorization legal text.
 *
 * - Inserts a new version (2) of the psp_consent template
 * - Sets requires_signature = true (was false/acknowledge-only)
 * - Adds capture_fields for driver identity verification
 * - Full legal text uses {{companyName}} placeholder for operating entity
 */

const PSP_BODY_TEXT = `
<h2>IMPORTANT DISCLOSURE</h2>
<h3>REGARDING BACKGROUND REPORTS FROM THE PSP ONLINE SERVICE</h3>

<p>In connection with your application for employment with <strong>{{companyName}}</strong> ("Prospective Employer"), Prospective Employer, its employees, agents or contractors may obtain one or more reports regarding your driving, and safety inspection history from the Federal Motor Carrier Safety Administration (FMCSA).</p>

<p>When the application for employment is submitted in person, if the Prospective Employer uses any information it obtains from FMCSA in a decision to not hire you or to make any other adverse employment decision regarding you, the Prospective Employer will provide you with a copy of the report upon which its decision was based and a written summary of your rights under the Fair Credit Reporting Act before taking any final adverse action. If any final adverse action is taken against you based upon your driving history or safety report, the Prospective Employer will notify you that the action has been taken and that the action was based in part or in whole on this report.</p>

<p>When the application for employment is submitted by mail, telephone, computer, or other similar means, if the Prospective Employer uses any information it obtains from FMCSA in a decision to not hire you or to make any other adverse employment decision regarding you, the Prospective Employer must provide you within three business days of taking adverse action oral, written or electronic notification:</p>
<ul>
  <li>That adverse action has been taken based in whole or in part on information obtained from FMCSA</li>
  <li>The name, address, and the toll free telephone number of FMCSA</li>
  <li>That the FMCSA did not make the decision to take the adverse action and is unable to provide you the specific reasons why the adverse action was taken</li>
  <li>That you may, upon providing proper identification, request a free copy of the report and may dispute with the FMCSA the accuracy or completeness of any information or report</li>
</ul>

<p>If you request a copy of a driver record from the Prospective Employer who procured the report, then, within 3 business days of receiving your request, together with proper identification, the Prospective Employer must send or provide to you a copy of your report and a summary of your rights under the Fair Credit Reporting Act.</p>

<p>Neither the Prospective Employer nor the FMCSA contractor supplying the crash and safety information has the capability to correct any safety data that appears to be incorrect. You may challenge the accuracy of the data by submitting a request to <strong>https://dataqs.fmcsa.dot.gov</strong>. If you challenge crash or inspection information reported by a State, FMCSA cannot change or correct this data. Your request will be forwarded by the DataQs system to the appropriate State for adjudication.</p>

<p>Any crash or inspection in which you were involved will display on your PSP report. Since the PSP report does not report, or assign, or imply fault, it will include all Commercial Motor Vehicle (CMV) crashes where you were a driver or co-driver and where those crashes were reported to FMCSA, regardless of fault. Similarly, all inspections, with or without violations, appear on the PSP report. State citations associated with Federal Motor Carrier Safety Regulations (FMCSR) violations that have been adjudicated by a court of law will also appear, and remain, on a PSP report.</p>

<p><strong>The Prospective Employer cannot obtain background reports from FMCSA without your authorization.</strong></p>

<hr/>

<h2>AUTHORIZATION</h2>

<p>If you agree that the Prospective Employer may obtain such background reports, please read the following and sign below:</p>

<p>I authorize <strong>{{companyName}}</strong> ("Prospective Employer") to access the FMCSA Pre-Employment Screening Program (PSP) system to seek information regarding my commercial driving safety record and information regarding my safety inspection history. I understand that I am authorizing the release of safety performance information including crash data from the previous five (5) years and inspection history from the previous three (3) years. I understand and acknowledge that this release of information may assist the Prospective Employer to make a determination regarding my suitability as an employee.</p>

<p>I further understand that neither the Prospective Employer nor the FMCSA contractor supplying the crash and safety information has the capability to correct any safety data that appears to be incorrect. I understand I may challenge the accuracy of the data by submitting a request to <strong>https://dataqs.fmcsa.dot.gov</strong>. If I challenge crash or inspection information reported by a State, FMCSA cannot change or correct this data. I understand my request will be forwarded by the DataQs system to the appropriate State for adjudication.</p>

<p>I understand that any crash or inspection in which I was involved will display on my PSP report. Since the PSP report does not report, or assign, or imply fault, I acknowledge it will include all CMV crashes where I was a driver or co-driver and where those crashes were reported to FMCSA, regardless of fault. Similarly, I understand all inspections, with or without violations, will appear on my PSP report, and State citations associated with FMCSR violations that have been adjudicated by a court of law will also appear, and remain, on my PSP report.</p>

<p>I have read the above Disclosure Regarding Background Reports provided to me by Prospective Employer and I understand that if I sign this Disclosure and Authorization, Prospective Employer may obtain a report of my crash and inspection history. I hereby authorize Prospective Employer and its employees, authorized agents, and/or affiliates to obtain the information authorized above.</p>

<p><em>NOTICE: This form is made available to monthly account holders by NIC on behalf of the U.S. Department of Transportation, Federal Motor Carrier Safety Administration (FMCSA). Account holders are required by federal law to obtain an Applicant's written or electronic consent prior to accessing the Applicant's PSP report. Further, account holders are required by FMCSA to use the language contained in this Disclosure and Authorization form to obtain an Applicant's consent. The language must be used in whole, exactly as provided. Further, the language on this form must exist as one stand-alone document. The language may NOT be included with other consent forms or any other language.</em></p>

<p><em>NOTICE: The prospective employment concept referenced in this form contemplates the definition of "employee" contained at 49 C.F.R. 383.5.</em></p>
`.trim();

exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('consent_templates');
  if (!hasTable) return;

  // Deactivate the old version
  await knex('consent_templates')
    .where({ key: 'psp_consent' })
    .update({ is_active: false });

  // Insert new version with full legal text, signature requirement, and capture fields
  await knex('consent_templates').insert({
    key: 'psp_consent',
    title: 'PSP Disclosure and Authorization',
    body_text: PSP_BODY_TEXT,
    version: 2,
    effective_date: knex.fn.now(),
    is_active: true,
    cfr_reference: '49 C.F.R. §383.5 / FMCSA PSP',
    requires_signature: true,
    capture_fields: JSON.stringify([
      'fullName',
      'dateOfBirth',
      'driversLicenseNumber',
      'stateOfIssue'
    ])
  });
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable('consent_templates');
  if (!hasTable) return;

  // Remove v2 and reactivate v1
  await knex('consent_templates')
    .where({ key: 'psp_consent', version: 2 })
    .del();

  await knex('consent_templates')
    .where({ key: 'psp_consent', version: 1 })
    .update({ is_active: true });
};
