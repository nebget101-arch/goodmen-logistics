const { PDFDocument, StandardFonts } = require('pdf-lib');

function asText(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function fmtDate(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toISOString().slice(0, 10);
}

function yn(v) {
  if (v === true) return 'YES';
  if (v === false) return 'NO';
  return '';
}

function drawLine(page, font, txt, x, y, size = 9) {
  page.drawText(asText(txt), { x, y, size, font });
}

function drawSectionHeader(page, font, title, y) {
  drawLine(page, font, title, 36, y, 11);
  page.drawLine({ start: { x: 36, y: y - 3 }, end: { x: 576, y: y - 3 }, thickness: 0.7 });
}

function row(obj, keys = ['snake', 'camel']) {
  if (!obj) return '';
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return '';
}

async function generateEmploymentApplicationPdf(fullApp) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const applicant = fullApp.applicant_snapshot || {};
  const residencies = fullApp.residencies || [];
  const licenses = fullApp.licenses || [];
  const driving = fullApp.drivingExperience || [];
  const accidents = fullApp.accidents || [];
  const convictions = fullApp.convictions || [];
  const employers = fullApp.employers || [];
  const education = fullApp.education || [];

  // PAGE 1
  let page = pdfDoc.addPage([612, 792]);
  let y = 760;
  drawLine(page, bold, 'DRIVER EMPLOYMENT APPLICATION', 36, y, 16);
  y -= 16;
  drawLine(page, font, '[COMPANY NAME, ADDRESS, PHONE NUMBER, AND EMAIL]', 36, y, 9);
  y -= 14;
  drawLine(page, font, 'An Equal Opportunity Employer', 36, y, 9);
  y -= 14;
  drawLine(page, bold, 'COMPLETE IN FULL OR IT WILL NOT BE CONSIDERED.', 36, y, 9);
  y -= 20;

  drawSectionHeader(page, bold, 'APPLICANT INFORMATION', y);
  y -= 18;
  drawLine(page, font, `FIRST NAME: ${asText(applicant.firstName)}`, 36, y);
  drawLine(page, font, `MIDDLE NAME: ${asText(applicant.middleName)}`, 220, y);
  drawLine(page, font, `LAST NAME: ${asText(applicant.lastName)}`, 400, y);
  y -= 14;
  drawLine(page, font, `PHONE: ${asText(applicant.phone)}`, 36, y);
  drawLine(page, font, `EMAIL: ${asText(applicant.email)}`, 220, y);
  y -= 14;
  drawLine(page, font, `DATE OF BIRTH: ${fmtDate(applicant.dateOfBirth)}`, 36, y);
  drawLine(page, font, `SOCIAL SECURITY #: ${asText(applicant.ssn)}`, 220, y);
  y -= 14;
  drawLine(page, font, `DATE OF APPLICATION: ${fmtDate(fullApp.application_date || applicant.applicationDate)}`, 36, y);
  drawLine(page, font, `POSITION APPLIED FOR: ${asText(applicant.positionAppliedFor)}`, 260, y);
  y -= 14;
  drawLine(page, font, `DATE AVAILABLE FOR WORK: ${fmtDate(applicant.dateAvailableForWork)}`, 36, y);
  drawLine(page, font, `LEGAL RIGHT TO WORK IN U.S.: ${yn(applicant.legalRightToWorkInUS)}`, 300, y);
  y -= 20;

  drawSectionHeader(page, bold, 'PREVIOUS THREE YEARS RESIDENCY', y);
  y -= 14;
  drawLine(page, font, 'Attach additional sheet if more space is needed', 36, y, 8);
  y -= 14;
  drawLine(page, bold, 'TYPE            STREET                      CITY                STATE   ZIP      YEARS', 36, y, 8);
  y -= 12;
  for (const r of residencies.slice(0, 5)) {
    drawLine(page, font, `${asText(r.residency_type || r.residencyType).padEnd(14)} ${asText(r.street).padEnd(26)} ${asText(r.city).padEnd(18)} ${asText(r.state).padEnd(7)} ${asText(r.zip_code || r.zipCode).padEnd(8)} ${asText(r.years_at_address || r.yearsAtAddress)}`, 36, y, 8);
    y -= 11;
  }
  y -= 8;

  drawSectionHeader(page, bold, 'LICENSE INFORMATION', y);
  y -= 14;
  drawLine(page, font, 'No person shall have more than one driver\'s license (49 CFR 383.21).', 36, y, 8);
  y -= 12;
  drawLine(page, bold, 'STATE     LICENSE #              TYPE/CLASS      ENDORSEMENTS       EXP DATE', 36, y, 8);
  y -= 12;
  for (const l of licenses.slice(0, 5)) {
    drawLine(page, font, `${asText(l.state).padEnd(9)} ${asText(l.license_number || l.licenseNumber).padEnd(22)} ${asText(l.license_class_or_type || l.licenseClassOrType).padEnd(15)} ${asText(l.endorsements).padEnd(18)} ${fmtDate(l.expiration_date || l.expirationDate)}`, 36, y, 8);
    y -= 11;
  }
  y -= 8;

  drawSectionHeader(page, bold, 'DRIVING EXPERIENCE', y);
  y -= 14;
  drawLine(page, bold, 'CLASS OF EQUIPMENT    TYPE OF EQUIPMENT      DATE FROM    DATE TO      APPROX # MILES', 36, y, 8);
  y -= 12;
  for (const d of driving.slice(0, 8)) {
    drawLine(page, font, `${asText(d.class_of_equipment || d.classOfEquipment).padEnd(22)} ${asText(d.type_of_equipment || d.typeOfEquipment).padEnd(22)} ${fmtDate(d.date_from || d.dateFrom).padEnd(12)} ${fmtDate(d.date_to || d.dateTo).padEnd(12)} ${asText(d.approximate_miles_total || d.approximateMilesTotal)}`, 36, y, 8);
    y -= 11;
  }

  // PAGE 2
  page = pdfDoc.addPage([612, 792]);
  y = 760;
  drawLine(page, bold, 'ACCIDENT RECORD FOR THE PAST 3 YEARS', 36, y, 11);
  y -= 14;
  drawLine(page, font, 'Attach additional sheet if more space is needed. Check this box if none: ' + (accidents.length ? 'NO' : 'YES'), 36, y, 8);
  y -= 14;
  drawLine(page, bold, 'DATE          NATURE OF ACCIDENT                 #FATALITIES   #INJURIES   CHEM SPILL', 36, y, 8);
  y -= 12;
  for (const a of accidents.slice(0, 14)) {
    drawLine(page, font, `${fmtDate(a.date).padEnd(13)} ${asText(a.nature_of_accident || a.natureOfAccident).padEnd(34)} ${asText(a.fatalities_count || a.fatalitiesCount).padEnd(12)} ${asText(a.injuries_count || a.injuriesCount).padEnd(10)} ${yn(a.chemical_spill ?? a.chemicalSpills)}`, 36, y, 8);
    y -= 11;
  }
  y -= 16;

  drawLine(page, bold, 'TRAFFIC CONVICTIONS / FORFEITURES PAST 3 YEARS (NOT PARKING)', 36, y, 11);
  y -= 14;
  drawLine(page, font, 'Attach additional sheet if more space is needed. Check this box if none: ' + (convictions.length ? 'NO' : 'YES'), 36, y, 8);
  y -= 14;
  drawLine(page, bold, 'DATE (MM/YYYY)   VIOLATION                     STATE     PENALTY', 36, y, 8);
  y -= 12;
  for (const c of convictions.slice(0, 14)) {
    drawLine(page, font, `${asText(c.date_convicted || c.dateConvictedMonthYear).padEnd(17)} ${asText(c.violation).padEnd(30)} ${asText(c.state_of_violation || c.stateOfViolation).padEnd(10)} ${asText(c.penalty)}`, 36, y, 8);
    y -= 11;
  }
  y -= 16;

  drawLine(page, bold, 'LICENSE DENIAL / SUSPENSION', 36, y, 11);
  y -= 14;
  drawLine(page, font, `Denied license/permit/privilege?: ${yn(applicant.deniedLicensePermitPrivilege)}`, 36, y, 9);
  y -= 12;
  drawLine(page, font, `If yes, explain: ${asText(applicant.deniedLicenseExplanation)}`, 36, y, 9);
  y -= 12;
  drawLine(page, font, `Suspended/revoked license/permit/privilege?: ${yn(applicant.suspendedOrRevokedLicensePermitPrivilege)}`, 36, y, 9);
  y -= 12;
  drawLine(page, font, `If yes, explain: ${asText(applicant.suspendedOrRevokedExplanation)}`, 36, y, 9);

  // PAGE 3
  page = pdfDoc.addPage([612, 792]);
  y = 760;
  drawLine(page, bold, 'EMPLOYMENT HISTORY', 36, y, 12);
  y -= 14;
  drawLine(page, font, 'List all employment for last 3 years (and up to 10 years if commercial driving).', 36, y, 8);
  y -= 16;

  const topThreeEmployers = employers.slice(0, 3);
  const titles = ['CURRENT (MOST RECENT) EMPLOYER', 'SECOND (MOST RECENT) EMPLOYER', 'THIRD (MOST RECENT) EMPLOYER'];
  for (let i = 0; i < 3; i += 1) {
    const e = topThreeEmployers[i] || {};
    drawLine(page, bold, titles[i], 36, y, 9);
    y -= 12;
    drawLine(page, font, `NAME: ${asText(e.company_name || e.companyName)}`, 36, y, 8);
    drawLine(page, font, `PHONE: ${asText(e.phone)}`, 360, y, 8);
    y -= 11;
    drawLine(page, font, `ADDRESS: ${asText(e.address)}`, 36, y, 8);
    y -= 11;
    drawLine(page, font, `POSITION HELD: ${asText(e.position_held || e.positionHeld)}`, 36, y, 8);
    y -= 11;
    drawLine(page, font, `FROM (MO/YR): ${asText(e.from_month_year || e.fromMonthYear)}   TO (MO/YR): ${asText(e.to_month_year || e.toMonthYear)}`, 36, y, 8);
    y -= 11;
    drawLine(page, font, `REASON FOR LEAVING: ${asText(e.reason_for_leaving || e.reasonForLeaving)}`, 36, y, 8);
    y -= 11;
    drawLine(page, font, `SALARY: ${asText(e.salary)}`, 36, y, 8);
    y -= 11;
    drawLine(page, font, `EXPLAIN GAPS: ${asText(e.gaps_explanation || e.gapsExplanation)}`, 36, y, 8);
    y -= 11;
    drawLine(page, font, `Subject to FMCSR?: ${yn(e.subject_to_fmcsr ?? e.subjectToFMCSR)}  |  Safety-sensitive DOT function?: ${yn(e.safety_sensitive_dot_function ?? e.safetySensitiveDOTFunction)}`, 36, y, 8);
    y -= 16;
  }

  drawLine(page, bold, 'EDUCATION', 36, y, 10);
  y -= 12;
  drawLine(page, bold, 'SCHOOL TYPE     NAME & LOCATION            COURSE OF STUDY    YEARS  GRAD  DETAILS', 36, y, 8);
  y -= 12;
  for (const e of education.slice(0, 6)) {
    drawLine(page, font, `${asText(e.school_type || e.schoolType).padEnd(15)} ${asText(e.school_name_and_location || e.schoolNameAndLocation).padEnd(25)} ${asText(e.course_of_study || e.courseOfStudy).padEnd(18)} ${asText(e.years_completed || e.yearsCompleted).padEnd(6)} ${asText(e.graduated).padEnd(5)} ${asText(e.details)}`, 36, y, 8);
    y -= 11;
  }

  // PAGE 4
  page = pdfDoc.addPage([612, 792]);
  y = 760;
  drawLine(page, bold, 'TO BE READ AND SIGNED BY APPLICANT', 36, y, 12);
  y -= 18;
  const paragraphs = [
    'I authorize investigations into my personal, employment, financial and related history as necessary for employment decisions.',
    'I understand that false or misleading information may result in discharge.',
    'I understand prior employers may be contacted for safety performance history as required by 49 CFR 391.23.',
    'I have the right to review, correct, and rebut information provided by previous employers.',
    'I certify this application is true and complete to the best of my knowledge.'
  ];
  for (const p of paragraphs) {
    drawLine(page, font, p, 36, y, 9);
    y -= 14;
  }
  y -= 16;
  drawLine(page, font, `Applicant Signature: ${asText(applicant.applicantSignature) || asText(applicant.applicantPrintedName)}`, 36, y, 10);
  y -= 18;
  drawLine(page, font, `Date: ${fmtDate(applicant.signatureDate || fullApp.signed_at || fullApp.submitted_at)}`, 36, y, 10);
  y -= 18;
  drawLine(page, font, `Applicant Name (printed): ${asText(applicant.applicantPrintedName || [applicant.firstName, applicant.middleName, applicant.lastName].filter(Boolean).join(' '))}`, 36, y, 10);

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

module.exports = {
  generateEmploymentApplicationPdf
};
