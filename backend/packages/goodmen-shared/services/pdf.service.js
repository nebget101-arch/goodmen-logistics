const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

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
  if (v === true || v === 'yes') return 'YES';
  if (v === false || v === 'no') return 'NO';
  return '';
}

/**
 * Mask a Social Security Number to show only the last 4 digits.
 * Accepts formats like "123456789", "123-45-6789", or partial values.
 * @param {string|number|null|undefined} ssn
 * @returns {string} e.g. "XXX-XX-6789" or "N/A"
 */
function maskSSN(ssn) {
  if (ssn === null || ssn === undefined || String(ssn).trim() === '') return 'N/A';
  const digits = String(ssn).replace(/\D/g, '');
  if (digits.length < 4) return 'N/A';
  const last4 = digits.slice(-4);
  return `XXX-XX-${last4}`;
}

function drawLine(page, font, txt, x, y, size = 9) {
  page.drawText(asText(txt), { x, y, size, font });
}

function drawSectionHeader(page, font, title, y) {
  drawLine(page, font, title, 36, y, 11);
  page.drawLine({ start: { x: 36, y: y - 3 }, end: { x: 576, y: y - 3 }, thickness: 0.7 });
}

function newPageIfNeeded(pdfDoc, page, y, minY = 80) {
  if (y < minY) {
    page = pdfDoc.addPage([612, 792]);
    y = 760;
  }
  return { page, y };
}

async function generateEmploymentApplicationPdf(fullApp, context = {}) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const applicant = fullApp.applicant_snapshot || {};

  // FN-216: Fallback reads — if structured arrays are empty, try building from snapshot top-level fields
  let residencies = fullApp.residencies || [];
  if (!residencies.length) {
    if (applicant.addressStreet || applicant.addressCity) {
      residencies.push({
        residencyType: 'current',
        street: applicant.addressStreet || '',
        city: applicant.addressCity || '',
        state: applicant.addressState || '',
        zip: applicant.addressZip || '',
        yearsAtAddress: applicant.yearsAtAddress || ''
      });
    }
    if (Array.isArray(applicant.previousAddresses)) {
      for (const pa of applicant.previousAddresses) {
        residencies.push({
          residencyType: 'previous',
          street: pa.street || '',
          city: pa.city || '',
          state: pa.state || '',
          zip: pa.zip || '',
          yearsAtAddress: pa.yearsAtAddress || ''
        });
      }
    }
  }

  let licenses = fullApp.licenses || [];
  if (!licenses.length && Array.isArray(applicant.licenses)) {
    licenses = applicant.licenses;
  }

  const accidents = fullApp.accidents || [];
  const violations = fullApp.violations || [];
  const convictions = fullApp.convictions || [];

  let employers = fullApp.employers || [];
  if (!employers.length) {
    if (applicant.currentEmployer && typeof applicant.currentEmployer === 'object') {
      employers.push({ ...applicant.currentEmployer, is_current: true });
    }
    if (Array.isArray(applicant.previousEmployers)) {
      for (const pe of applicant.previousEmployers) {
        employers.push({ ...pe, is_current: false });
      }
    }
  }

  // FN-216: Work auth fallback from snapshot top-level
  let workAuth = applicant.workAuthorization || {};
  if (!workAuth.legallyAuthorizedToWork && applicant.legallyAuthorizedToWork !== undefined) {
    workAuth = {
      legallyAuthorizedToWork: applicant.legallyAuthorizedToWork,
      convictedOfFelony: applicant.convictedOfFelony,
      felonyDetails: applicant.felonyDetails,
      unableToPerformFunctions: applicant.unableToPerformFunctions,
      adaDetails: applicant.adaDetails
    };
  }

  // FN-216: Drug/alcohol fallback from snapshot top-level
  let drugAlcohol = applicant.drugAlcohol || {};
  if (!drugAlcohol.violatedSubstanceProhibitions && applicant.violatedSubstanceProhibitions !== undefined) {
    drugAlcohol = {
      violatedSubstanceProhibitions: applicant.violatedSubstanceProhibitions,
      failedRehabProgram: applicant.failedRehabProgram,
      alcoholTestResult04OrHigher: applicant.alcoholTestResult04OrHigher,
      positiveControlledSubstancesTest: applicant.positiveControlledSubstancesTest,
      refusedRequiredTest: applicant.refusedRequiredTest,
      otherDOTViolation: applicant.otherDOTViolation
    };
  }

  // FN-216: Driving experience fallback from snapshot top-level
  let drivingExp = applicant.drivingExperience || {};
  if (!drivingExp.straightTruck && applicant.straightTruck !== undefined) {
    drivingExp = {
      straightTruck: applicant.straightTruck,
      tractorSemiTrailer: applicant.tractorSemiTrailer,
      tractorTwoTrailers: applicant.tractorTwoTrailers,
      motorcoachSchoolBus: applicant.motorcoachSchoolBus,
      motorcoachSchoolBusMore15: applicant.motorcoachSchoolBusMore15,
      other: applicant.otherEquipment,
      statesOperatedIn: applicant.statesOperatedIn
    };
  }

  // === PAGE 1: HEADER + APPLICANT INFO ===
  let page = pdfDoc.addPage([612, 792]);
  let y = 760;

  drawLine(page, bold, 'DRIVER EMPLOYMENT APPLICATION', 160, y, 16);
  y -= 18;

  // FN-216: Company info from operating entity context
  const oe = context.operatingEntity || {};
  let companyLine = '[COMPANY NAME, ADDRESS, PHONE NUMBER, AND EMAIL]';
  if (oe.name) {
    const parts = [oe.name];
    if (oe.address) parts.push(oe.address);
    if (oe.phone) parts.push(oe.phone);
    if (oe.email) parts.push(oe.email);
    companyLine = parts.join(' | ');
  }
  drawLine(page, font, companyLine, 36, y, 9);
  y -= 14;
  drawLine(page, font, 'An Equal Opportunity Employer', 36, y, 9);
  y -= 18;

  // 49 CFR Notice
  drawLine(page, bold, 'PLEASE READ COMPLETELY', 36, y, 9);
  y -= 12;
  const notice = [
    'The information requested on this form is required by federal law (49 CFR) to be provided by any driver applying for',
    'a commercial driver position as defined in 49 CFR 390.5. Failure to complete required areas can place both the',
    'applicant and carrier in violation of federal law. Information provided will be verified by carrier as required under',
    'various parts of 49 CFR, including Part 382 and Part 391.',
    '',
    'PLEASE PRINT CLEARLY AND SIGN YOUR FULL LEGAL NAME AT THE END WHERE REQUIRED.',
    'FALSE STATEMENTS MAY RESULT IN REFUSAL TO HIRE OR IMMEDIATE TERMINATION.'
  ];
  for (const line of notice) {
    drawLine(page, line.startsWith('PLEASE') || line.startsWith('FALSE') ? bold : font, line, 36, y, 7.5);
    y -= 10;
  }
  y -= 8;

  // APPLICANT INFORMATION
  drawSectionHeader(page, bold, 'APPLICANT INFORMATION', y);
  y -= 16;
  drawLine(page, font, `FIRST NAME: ${asText(applicant.firstName)}`, 36, y);
  drawLine(page, font, `MIDDLE NAME: ${asText(applicant.middleName)}`, 220, y);
  drawLine(page, font, `LAST NAME: ${asText(applicant.lastName)}`, 400, y);
  y -= 13;
  drawLine(page, font, `PHONE: ${asText(applicant.phone)}`, 36, y);
  drawLine(page, font, `EMAIL: ${asText(applicant.email)}`, 220, y);
  y -= 13;
  drawLine(page, font, `DATE OF BIRTH: ${fmtDate(applicant.dateOfBirth)}`, 36, y);
  drawLine(page, font, `SSN: ${maskSSN(applicant.ssn)}`, 220, y);
  y -= 13;
  drawLine(page, font, `POSITION APPLIED FOR: ${asText(applicant.positionAppliedFor)}`, 36, y);
  drawLine(page, font, `DATE OF APPLICATION: ${fmtDate(applicant.dateOfApplication || fullApp.application_date)}`, 300, y);
  y -= 18;

  // RESIDENCY HISTORY
  drawSectionHeader(page, bold, 'ADDRESS HISTORY (PAST 3 YEARS)', y);
  y -= 14;
  drawLine(page, bold, 'TYPE            STREET                      CITY                STATE   ZIP      YEARS', 36, y, 8);
  y -= 12;
  for (const r of residencies.slice(0, 8)) {
    ({ page, y } = newPageIfNeeded(pdfDoc, page, y));
    drawLine(page, font, `${asText(r.residency_type || r.residencyType).padEnd(14)} ${asText(r.street).padEnd(26)} ${asText(r.city).padEnd(18)} ${asText(r.state).padEnd(7)} ${asText(r.zip_code || r.zipCode || r.zip).padEnd(8)} ${asText(r.years_at_address || r.yearsAtAddress)}`, 36, y, 8);
    y -= 11;
  }
  y -= 8;

  // WORK AUTHORIZATION & CRIMINAL BACKGROUND
  ({ page, y } = newPageIfNeeded(pdfDoc, page, y, 120));
  drawSectionHeader(page, bold, 'WORK AUTHORIZATION & BACKGROUND', y);
  y -= 16;
  drawLine(page, font, `Legally authorized to work in U.S. under 49 CFR?: ${yn(workAuth.legallyAuthorizedToWork)}`, 36, y);
  y -= 13;
  drawLine(page, font, `Convicted of a felony?: ${yn(workAuth.convictedOfFelony)}`, 36, y);
  y -= 13;
  if (workAuth.convictedOfFelony === 'yes' && workAuth.felonyDetails) {
    drawLine(page, font, `  Details: ${asText(workAuth.felonyDetails).slice(0, 90)}`, 36, y, 8);
    y -= 11;
  }
  drawLine(page, font, `Unable to perform job functions / ADA consideration?: ${yn(workAuth.unableToPerformFunctions)}`, 36, y);
  y -= 13;
  if (workAuth.unableToPerformFunctions === 'yes' && workAuth.adaDetails) {
    drawLine(page, font, `  Details: ${asText(workAuth.adaDetails).slice(0, 90)}`, 36, y, 8);
    y -= 11;
  }
  y -= 8;

  // === EMPLOYMENT HISTORY ===
  ({ page, y } = newPageIfNeeded(pdfDoc, page, y, 140));
  drawSectionHeader(page, bold, 'EMPLOYMENT HISTORY', y);
  y -= 14;
  drawLine(page, font, 'All applicants must provide information for any previous employer during the preceding 3 years.', 36, y, 7.5);
  y -= 10;
  drawLine(page, font, 'Applicants shall also provide an additional 7 years for employers for whom they operated a CMV.', 36, y, 7.5);
  y -= 14;

  for (let i = 0; i < employers.length; i += 1) {
    ({ page, y } = newPageIfNeeded(pdfDoc, page, y, 130));
    const e = employers[i] || {};
    const label = e.is_current ? 'CURRENT / MOST RECENT EMPLOYER' : `PREVIOUS EMPLOYER ${i}`;
    drawLine(page, bold, label, 36, y, 9);
    y -= 12;
    drawLine(page, font, `NAME: ${asText(e.company_name || e.employerName)}`, 36, y, 8);
    drawLine(page, font, `PHONE: ${asText(e.phone || e.phoneNumber)}`, 360, y, 8);
    y -= 11;
    drawLine(page, font, `ADDRESS: ${asText(e.street_address || e.streetAddress)} ${asText(e.city)}, ${asText(e.state)} ${asText(e.zip_code || e.zipCode)}`, 36, y, 8);
    y -= 11;
    drawLine(page, font, `POSITION HELD: ${asText(e.position_held || e.positionHeld)}`, 36, y, 8);
    drawLine(page, font, `CONTACT: ${asText(e.contact_person || e.contactPerson)}`, 300, y, 8);
    y -= 11;
    drawLine(page, font, `FROM: ${asText(e.from_month_year || e.fromDate)}   TO: ${asText(e.to_month_year || e.toDate)}   SALARY: ${asText(e.salary || e.salaryWage)}`, 36, y, 8);
    y -= 11;
    drawLine(page, font, `REASON FOR LEAVING: ${asText(e.reason_for_leaving || e.reasonForLeaving)}`, 36, y, 8);
    y -= 14;
  }

  // === ACCIDENT RECORD ===
  ({ page, y } = newPageIfNeeded(pdfDoc, page, y, 100));
  drawSectionHeader(page, bold, 'ACCIDENT RECORD (PAST 5 YEARS)', y);
  y -= 14;
  if (!accidents.length) {
    drawLine(page, font, 'NONE', 36, y);
    y -= 14;
  } else {
    drawLine(page, bold, 'DATE          NATURE OF ACCIDENT                 FATALITIES   INJURIES   HAZ. SPILL', 36, y, 8);
    y -= 12;
    for (const a of accidents.slice(0, 10)) {
      ({ page, y } = newPageIfNeeded(pdfDoc, page, y));
      drawLine(page, font, `${fmtDate(a.date).padEnd(13)} ${asText(a.nature_of_accident || a.natureOfAccident).padEnd(34)} ${asText(a.fatalities_count || a.fatalities).padEnd(12)} ${asText(a.injuries_count || a.injuries).padEnd(10)} ${yn(a.hazardous_material_spill ?? a.hazardousMaterialSpill ?? a.chemical_spill)}`, 36, y, 8);
      y -= 11;
    }
  }
  y -= 8;

  // === TRAFFIC CONVICTIONS ===
  ({ page, y } = newPageIfNeeded(pdfDoc, page, y, 100));
  drawSectionHeader(page, bold, 'TRAFFIC CONVICTIONS (PAST 5 YEARS)', y);
  y -= 14;
  if (!violations.length && !convictions.length) {
    drawLine(page, font, 'NONE', 36, y);
    y -= 14;
  } else {
    drawLine(page, bold, 'LOCATION                    DATE          CHARGE                    PENALTY', 36, y, 8);
    y -= 12;
    const allViolations = [...violations, ...convictions];
    for (const v of allViolations.slice(0, 10)) {
      ({ page, y } = newPageIfNeeded(pdfDoc, page, y));
      drawLine(page, font, `${asText(v.location || v.state_of_violation || v.stateOfViolation).padEnd(27)} ${fmtDate(v.date || v.date_convicted || v.dateConvicted).padEnd(13)} ${asText(v.charge || v.violation).padEnd(25)} ${asText(v.penalty)}`, 36, y, 8);
      y -= 11;
    }
  }
  y -= 8;

  // === LICENSE HISTORY ===
  ({ page, y } = newPageIfNeeded(pdfDoc, page, y, 100));
  drawSectionHeader(page, bold, 'DRIVER LICENSES / PERMITS (PAST 3 YEARS)', y);
  y -= 14;
  drawLine(page, bold, 'STATE     LICENSE NO.              TYPE              EXPIRATION DATE', 36, y, 8);
  y -= 12;
  for (const l of licenses.slice(0, 5)) {
    ({ page, y } = newPageIfNeeded(pdfDoc, page, y));
    drawLine(page, font, `${asText(l.state).padEnd(9)} ${asText(l.license_number || l.licenseNumber).padEnd(24)} ${asText(l.license_class_or_type || l.type).padEnd(17)} ${fmtDate(l.expiration_date || l.expirationDate)}`, 36, y, 8);
    y -= 11;
  }
  y -= 8;

  // === DRIVING EXPERIENCE ===
  ({ page, y } = newPageIfNeeded(pdfDoc, page, y, 120));
  drawSectionHeader(page, bold, 'DRIVING EXPERIENCE', y);
  y -= 14;
  drawLine(page, bold, 'CLASS OF EQUIPMENT                  TYPE              DATES FROM-TO         APPROX MILES', 36, y, 8);
  y -= 12;

  const expTypes = [
    { key: 'straightTruck', label: 'Straight Truck' },
    { key: 'tractorSemiTrailer', label: 'Tractor & Semi-Trailer' },
    { key: 'tractorTwoTrailers', label: 'Tractor Two Trailers' },
    { key: 'motorcoachSchoolBus', label: 'Motorcoach/School Bus (8+)' },
    { key: 'motorcoachSchoolBusMore15', label: 'Motorcoach/School Bus (15+)' },
    { key: 'other', label: 'Other' }
  ];
  for (const et of expTypes) {
    const exp = drivingExp[et.key] || {};
    const has = exp.hasExperience;
    ({ page, y } = newPageIfNeeded(pdfDoc, page, y));
    const checkMark = has ? 'YES' : 'NO';
    const desc = et.key === 'other' && exp.description ? `${et.label}: ${exp.description}` : et.label;
    drawLine(page, font, `${checkMark.padEnd(4)} ${desc.padEnd(30)} ${asText(exp.typeOfEquipment).padEnd(17)} ${asText(exp.dateFrom).padEnd(10)}-${asText(exp.dateTo).padEnd(10)} ${asText(exp.approxMiles)}`, 36, y, 8);
    y -= 11;
  }
  y -= 6;
  drawLine(page, font, `States operated in for last 5 years: ${asText(drivingExp.statesOperatedIn)}`, 36, y, 8);
  y -= 14;

  // === DRUG AND ALCOHOL INFORMATION ===
  ({ page, y } = newPageIfNeeded(pdfDoc, page, y, 130));
  drawSectionHeader(page, bold, 'DRUG & ALCOHOL INFORMATION', y);
  y -= 14;
  drawLine(page, font, 'In the previous three (3) years have you:', 36, y, 8);
  y -= 12;

  const daQuestions = [
    { key: 'violatedSubstanceProhibitions', label: '1. Violated Alcohol/Controlled Substance prohibitions (49CFR Part 382/40)' },
    { key: 'failedRehabProgram', label: '2. Failed to complete a rehabilitation program (SAP per 49CFR 382.605)' },
    { key: 'alcoholTestResult04OrHigher', label: '3. Had an alcohol test result of 0.04 or higher' },
    { key: 'positiveControlledSubstancesTest', label: '4. Tested positive for controlled substances' },
    { key: 'refusedRequiredTest', label: '5. Refused to submit to a required test' },
    { key: 'otherDOTViolation', label: '6. Had any other violation of DOT drug/alcohol testing regulations' }
  ];
  for (const q of daQuestions) {
    ({ page, y } = newPageIfNeeded(pdfDoc, page, y));
    drawLine(page, font, `${q.label}: ${yn(drugAlcohol[q.key])}`, 36, y, 8);
    y -= 11;
  }
  y -= 12;

  // === APPLICANT CERTIFICATION & SIGNATURE (FN-233) ===
  ({ page, y } = newPageIfNeeded(pdfDoc, page, y, 180));
  drawSectionHeader(page, bold, 'APPLICANT CERTIFICATION & SIGNATURE', y);
  y -= 16;
  const certParagraphs = [
    'I authorize investigations into my personal, employment, financial and related history.',
    'I understand that false or misleading information may result in discharge.',
    'I understand prior employers may be contacted for safety performance history (49 CFR 391.23).',
    'I have the right to review, correct, and rebut information provided by previous employers.',
    'I certify this application is true and complete to the best of my knowledge.'
  ];
  for (const p of certParagraphs) {
    ({ page, y } = newPageIfNeeded(pdfDoc, page, y));
    drawLine(page, font, p, 36, y, 9);
    y -= 14;
  }
  y -= 10;

  // FN-233: Captured applicant identity fields
  const certFullName = [applicant.firstName, applicant.middleName, applicant.lastName].filter(Boolean).join(' ');
  drawLine(page, font, `Full Name: ${asText(certFullName)}`, 36, y, 9);
  y -= 13;
  drawLine(page, font, `Date of Birth: ${fmtDate(applicant.dateOfBirth)}`, 36, y, 9);
  y -= 13;
  drawLine(page, font, `SSN: ${maskSSN(applicant.ssn)}`, 36, y, 9);
  y -= 13;
  // License number from snapshot or from licenses array
  const certLicenseNum = applicant.licenseNumber || (licenses.length > 0 ? (licenses[0].license_number || licenses[0].licenseNumber) : '') || '';
  const certLicenseState = applicant.licenseState || (licenses.length > 0 ? licenses[0].state : '') || '';
  drawLine(page, font, `Driver's License Number: ${asText(certLicenseNum)}`, 36, y, 9);
  y -= 13;
  drawLine(page, font, `State of Issue: ${asText(certLicenseState)}`, 36, y, 9);
  y -= 16;

  const cert = applicant.certification || {};
  drawLine(page, font, `Applicant Signature: ${asText(cert.applicantSignature || applicant.applicantSignature || applicant.applicantPrintedName || [applicant.firstName, applicant.lastName].filter(Boolean).join(' '))}`, 36, y, 10);
  y -= 16;
  drawLine(page, font, `Date: ${fmtDate(fullApp.signed_certification_at || cert.signatureDate || applicant.signatureDate || fullApp.signed_at || fullApp.submitted_at)}`, 36, y, 10);
  y -= 16;
  drawLine(page, font, `Applicant Name (printed): ${asText(cert.applicantPrintedName || applicant.applicantPrintedName || certFullName)}`, 36, y, 10);
  y -= 12;
  // FN-233: Electronic signature acknowledgment
  drawLine(page, font, 'This application was signed electronically. The signer consents to the use of electronic', 36, y, 7);
  y -= 10;
  drawLine(page, font, 'signatures in accordance with applicable law.', 36, y, 7);

  // === DOCUMENT AUDIT TRAIL ===
  const audit = context.auditTrail || applicant.auditTrail || {};
  if (audit.ipAddress || audit.submittedAt || audit.userAgent) {
    y -= 8;
    ({ page, y } = newPageIfNeeded(pdfDoc, page, y, 80));
    drawSectionHeader(page, bold, 'DOCUMENT AUDIT TRAIL', y);
    y -= 16;
    if (audit.ipAddress) {
      drawLine(page, font, `IP Address: ${asText(audit.ipAddress)}`, 36, y, 8);
      y -= 11;
    }
    if (audit.submittedAt) {
      drawLine(page, font, `Submitted At: ${asText(audit.submittedAt)}`, 36, y, 8);
      y -= 11;
    }
    if (audit.userAgent) {
      const ua = asText(audit.userAgent).slice(0, 120);
      drawLine(page, font, `User Agent: ${ua}`, 36, y, 7);
      y -= 11;
    }
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

module.exports = {
  generateEmploymentApplicationPdf
};
