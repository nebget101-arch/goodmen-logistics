const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

// ─── Utility functions ───────────────────────────────────────────────────────

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

// ─── Professional PDF color scheme and layout constants ──────────────────────

const COLORS = {
  primary: rgb(0.06, 0.29, 0.42),
  headerBg: rgb(0.93, 0.95, 0.97),
  text: rgb(0.1, 0.1, 0.1),
  label: rgb(0.4, 0.4, 0.4),
  border: rgb(0.78, 0.82, 0.86),
  white: rgb(1, 1, 1),
  altRow: rgb(0.97, 0.97, 0.98),
  auditBg: rgb(0.96, 0.96, 0.97),
};

const LAYOUT = {
  pageWidth: 612,
  pageHeight: 792,
  marginLeft: 45,
  marginRight: 45,
  marginTop: 50,
  marginBottom: 60,
  contentWidth: 522,   // 612 - 45 - 45
  headerHeight: 45,
  footerHeight: 30,
  contentStartY: 720,  // Below page header
};

// ─── Professional PDF drawing helpers ────────────────────────────────────────

function drawPageHeader(page, font, boldFont, companyName, companyAddress) {
  const { pageWidth, marginLeft, marginRight } = LAYOUT;
  // Company name bold 13pt
  page.drawText(companyName || '', { x: marginLeft, y: 755, size: 13, font: boldFont, color: COLORS.primary });
  // Address 8pt
  if (companyAddress) {
    page.drawText(companyAddress, { x: marginLeft, y: 742, size: 8, font, color: COLORS.label });
  }
  // Title right-aligned
  const title = 'DRIVER EMPLOYMENT APPLICATION';
  const titleWidth = boldFont.widthOfTextAtSize(title, 10);
  page.drawText(title, { x: pageWidth - marginRight - titleWidth, y: 755, size: 10, font: boldFont, color: COLORS.primary });
  // Horizontal line
  page.drawLine({
    start: { x: marginLeft, y: 735 },
    end: { x: pageWidth - marginRight, y: 735 },
    thickness: 1,
    color: COLORS.border
  });
}

function drawPageFooter(page, font, pageNum, totalPages, docId, genDate) {
  const { pageWidth, marginLeft, marginRight } = LAYOUT;
  // Line above footer
  page.drawLine({
    start: { x: marginLeft, y: 45 },
    end: { x: pageWidth - marginRight, y: 45 },
    thickness: 0.5,
    color: COLORS.border
  });
  // Left: doc ID
  if (docId) {
    page.drawText(`Doc: ${docId}`, { x: marginLeft, y: 32, size: 7, font, color: COLORS.label });
  }
  // Center: date
  if (genDate) {
    const dateText = `Generated: ${genDate}`;
    const w = font.widthOfTextAtSize(dateText, 7);
    page.drawText(dateText, { x: (pageWidth - w) / 2, y: 32, size: 7, font, color: COLORS.label });
  }
  // Right: page number
  const pageText = `Page ${pageNum} of ${totalPages}`;
  const pw = font.widthOfTextAtSize(pageText, 7);
  page.drawText(pageText, { x: pageWidth - marginRight - pw, y: 32, size: 7, font, color: COLORS.label });
}

function drawSectionBanner(page, boldFont, title, y) {
  const { marginLeft, contentWidth } = LAYOUT;
  page.drawRectangle({
    x: marginLeft,
    y: y - 4,
    width: contentWidth,
    height: 18,
    color: COLORS.headerBg,
    borderColor: COLORS.border,
    borderWidth: 0.5
  });
  page.drawText(title, { x: marginLeft + 8, y: y, size: 10, font: boldFont, color: COLORS.primary });
  return y - 24;
}

function drawFieldPair(page, font, boldFont, label1, value1, label2, value2, y) {
  const { marginLeft, contentWidth } = LAYOUT;
  const halfWidth = contentWidth / 2 - 5;
  // Field 1
  page.drawText(label1, { x: marginLeft, y: y + 10, size: 7, font, color: COLORS.label });
  page.drawText(asText(value1), { x: marginLeft, y: y - 2, size: 9, font: boldFont, color: COLORS.text });
  page.drawLine({
    start: { x: marginLeft, y: y - 6 },
    end: { x: marginLeft + halfWidth, y: y - 6 },
    thickness: 0.5,
    color: COLORS.border
  });
  // Field 2
  if (label2) {
    const x2 = marginLeft + halfWidth + 10;
    page.drawText(label2, { x: x2, y: y + 10, size: 7, font, color: COLORS.label });
    page.drawText(asText(value2), { x: x2, y: y - 2, size: 9, font: boldFont, color: COLORS.text });
    page.drawLine({
      start: { x: x2, y: y - 6 },
      end: { x: x2 + halfWidth, y: y - 6 },
      thickness: 0.5,
      color: COLORS.border
    });
  }
  return y - 28;
}

function drawSingleField(page, font, boldFont, label, value, y, fullWidth) {
  const { marginLeft, contentWidth } = LAYOUT;
  const w = fullWidth ? contentWidth : contentWidth / 2 - 5;
  page.drawText(label, { x: marginLeft, y: y + 10, size: 7, font, color: COLORS.label });
  page.drawText(asText(value), { x: marginLeft, y: y - 2, size: 9, font: boldFont, color: COLORS.text });
  page.drawLine({
    start: { x: marginLeft, y: y - 6 },
    end: { x: marginLeft + w, y: y - 6 },
    thickness: 0.5,
    color: COLORS.border
  });
  return y - 28;
}

function drawTableHeader(page, boldFont, columns, y) {
  const { marginLeft, contentWidth } = LAYOUT;
  page.drawRectangle({
    x: marginLeft,
    y: y - 2,
    width: contentWidth,
    height: 16,
    color: COLORS.primary
  });
  for (const col of columns) {
    page.drawText(col.label, { x: col.x, y: y + 2, size: 7.5, font: boldFont, color: COLORS.white });
  }
  return y - 18;
}

function drawTableRow(page, font, columns, values, y, isAlt) {
  const { marginLeft, contentWidth } = LAYOUT;
  if (isAlt) {
    page.drawRectangle({
      x: marginLeft,
      y: y - 2,
      width: contentWidth,
      height: 14,
      color: COLORS.altRow
    });
  }
  for (let i = 0; i < columns.length; i++) {
    const maxChars = columns[i].maxChars || 40;
    const val = asText(values[i]).substring(0, maxChars);
    page.drawText(val, { x: columns[i].x, y: y + 1, size: 8, font, color: COLORS.text });
  }
  return y - 14;
}

function drawQuestionRow(page, font, boldFont, question, answer, y) {
  const { marginLeft, contentWidth } = LAYOUT;
  page.drawText(question, { x: marginLeft + 8, y, size: 8, font, color: COLORS.text });
  const ansColor = answer === 'YES' ? rgb(0.7, 0.15, 0.15) : COLORS.primary;
  const ansWidth = boldFont.widthOfTextAtSize(answer, 9);
  page.drawText(answer, { x: marginLeft + contentWidth - ansWidth - 8, y, size: 9, font: boldFont, color: ansColor });
  page.drawLine({
    start: { x: marginLeft + 8, y: y - 4 },
    end: { x: marginLeft + contentWidth - 8, y: y - 4 },
    thickness: 0.3,
    color: COLORS.border
  });
  return y - 16;
}

function newPageWithHeader(pdfDoc, font, boldFont, companyName, companyAddress) {
  const page = pdfDoc.addPage([LAYOUT.pageWidth, LAYOUT.pageHeight]);
  drawPageHeader(page, font, boldFont, companyName, companyAddress);
  return { page, y: LAYOUT.contentStartY };
}

function checkPage(pdfDoc, page, y, minY, font, boldFont, companyName, companyAddress) {
  if (y < minY) {
    return newPageWithHeader(pdfDoc, font, boldFont, companyName, companyAddress);
  }
  return { page, y };
}

// ─── Main PDF generator ─────────────────────────────────────────────────────

async function generateEmploymentApplicationPdf(fullApp, context = {}) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const applicant = fullApp.applicant_snapshot || {};

  // FN-216: Fallback reads -- if structured arrays are empty, try building from snapshot top-level fields
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

  // FN-216: Company info from operating entity context
  const oe = context.operatingEntity || {};
  const companyName = oe.name || '';
  let companyAddress = '';
  if (oe.address) {
    const parts = [oe.address];
    if (oe.phone) parts.push(oe.phone);
    if (oe.email) parts.push(oe.email);
    companyAddress = parts.join('  |  ');
  }

  // Document metadata for footers
  const docId = fullApp.id || fullApp.application_id || '';
  const genDate = new Date().toISOString().slice(0, 10);

  // === PAGE 1: HEADER + NOTICE + APPLICANT INFO ===
  let page = pdfDoc.addPage([LAYOUT.pageWidth, LAYOUT.pageHeight]);
  drawPageHeader(page, font, bold, companyName || '[COMPANY NAME]', companyAddress || '[ADDRESS, PHONE, EMAIL]');
  let y = LAYOUT.contentStartY;

  // Equal opportunity line
  page.drawText('An Equal Opportunity Employer', {
    x: LAYOUT.marginLeft,
    y,
    size: 8,
    font,
    color: COLORS.label
  });
  y -= 18;

  // 49 CFR Notice box
  const noticeBoxHeight = 72;
  page.drawRectangle({
    x: LAYOUT.marginLeft,
    y: y - noticeBoxHeight + 14,
    width: LAYOUT.contentWidth,
    height: noticeBoxHeight,
    color: rgb(0.99, 0.97, 0.93),
    borderColor: rgb(0.85, 0.75, 0.55),
    borderWidth: 0.5
  });

  page.drawText('PLEASE READ COMPLETELY', { x: LAYOUT.marginLeft + 8, y, size: 8, font: bold, color: COLORS.primary });
  y -= 11;
  const notice = [
    'The information requested on this form is required by federal law (49 CFR) to be provided by any driver applying for',
    'a commercial driver position as defined in 49 CFR 390.5. Failure to complete required areas can place both the',
    'applicant and carrier in violation of federal law. Information provided will be verified by carrier as required under',
    'various parts of 49 CFR, including Part 382 and Part 391.'
  ];
  for (const line of notice) {
    page.drawText(line, { x: LAYOUT.marginLeft + 8, y, size: 7, font, color: COLORS.text });
    y -= 9;
  }
  y -= 2;
  page.drawText('PLEASE PRINT CLEARLY AND SIGN YOUR FULL LEGAL NAME AT THE END WHERE REQUIRED.', { x: LAYOUT.marginLeft + 8, y, size: 7, font: bold, color: rgb(0.6, 0.15, 0.15) });
  y -= 9;
  page.drawText('FALSE STATEMENTS MAY RESULT IN REFUSAL TO HIRE OR IMMEDIATE TERMINATION.', { x: LAYOUT.marginLeft + 8, y, size: 7, font: bold, color: rgb(0.6, 0.15, 0.15) });
  y -= 16;

  // === APPLICANT INFORMATION ===
  y = drawSectionBanner(page, bold, 'APPLICANT INFORMATION', y);
  y -= 4;
  y = drawFieldPair(page, font, bold, 'FIRST NAME', applicant.firstName, 'MIDDLE NAME', applicant.middleName, y);
  y = drawFieldPair(page, font, bold, 'LAST NAME', applicant.lastName, 'PHONE', applicant.phone, y);
  y = drawFieldPair(page, font, bold, 'EMAIL', applicant.email, 'DATE OF BIRTH', fmtDate(applicant.dateOfBirth), y);
  y = drawFieldPair(page, font, bold, 'SSN (MASKED)', maskSSN(applicant.ssn), 'POSITION APPLIED FOR', applicant.positionAppliedFor, y);
  y = drawSingleField(page, font, bold, 'DATE OF APPLICATION', fmtDate(applicant.dateOfApplication || fullApp.application_date), y, false);
  y -= 4;

  // === ADDRESS HISTORY ===
  ({ page, y } = checkPage(pdfDoc, page, y, 120, font, bold, companyName, companyAddress));
  y = drawSectionBanner(page, bold, 'ADDRESS HISTORY (PAST 3 YEARS)', y);
  y -= 2;

  const addrColumns = [
    { label: 'TYPE', x: LAYOUT.marginLeft + 4 },
    { label: 'STREET', x: LAYOUT.marginLeft + 70 },
    { label: 'CITY', x: LAYOUT.marginLeft + 230 },
    { label: 'STATE', x: LAYOUT.marginLeft + 340 },
    { label: 'ZIP', x: LAYOUT.marginLeft + 395 },
    { label: 'YEARS', x: LAYOUT.marginLeft + 460 }
  ];
  y = drawTableHeader(page, bold, addrColumns, y);

  for (let i = 0; i < residencies.slice(0, 8).length; i++) {
    ({ page, y } = checkPage(pdfDoc, page, y, 70, font, bold, companyName, companyAddress));
    const r = residencies[i];
    y = drawTableRow(page, font, addrColumns, [
      asText(r.residency_type || r.residencyType),
      asText(r.street),
      asText(r.city),
      asText(r.state),
      asText(r.zip_code || r.zipCode || r.zip),
      asText(r.years_at_address || r.yearsAtAddress)
    ], y, i % 2 === 1);
  }
  y -= 10;

  // === WORK AUTHORIZATION & BACKGROUND ===
  ({ page, y } = checkPage(pdfDoc, page, y, 140, font, bold, companyName, companyAddress));
  y = drawSectionBanner(page, bold, 'WORK AUTHORIZATION & BACKGROUND', y);
  y -= 2;

  y = drawQuestionRow(page, font, bold, 'Legally authorized to work in U.S. under 49 CFR?', yn(workAuth.legallyAuthorizedToWork), y);
  y = drawQuestionRow(page, font, bold, 'Convicted of a felony?', yn(workAuth.convictedOfFelony), y);
  if (workAuth.convictedOfFelony === 'yes' && workAuth.felonyDetails) {
    page.drawText(`Details: ${asText(workAuth.felonyDetails).slice(0, 90)}`, { x: LAYOUT.marginLeft + 16, y, size: 7.5, font, color: COLORS.text });
    y -= 14;
  }
  y = drawQuestionRow(page, font, bold, 'Unable to perform job functions / ADA consideration?', yn(workAuth.unableToPerformFunctions), y);
  if (workAuth.unableToPerformFunctions === 'yes' && workAuth.adaDetails) {
    page.drawText(`Details: ${asText(workAuth.adaDetails).slice(0, 90)}`, { x: LAYOUT.marginLeft + 16, y, size: 7.5, font, color: COLORS.text });
    y -= 14;
  }
  y -= 6;

  // === EMPLOYMENT HISTORY ===
  ({ page, y } = checkPage(pdfDoc, page, y, 160, font, bold, companyName, companyAddress));
  y = drawSectionBanner(page, bold, 'EMPLOYMENT HISTORY', y);
  page.drawText('All applicants must provide information for any previous employer during the preceding 3 years.', { x: LAYOUT.marginLeft + 4, y, size: 7.5, font, color: COLORS.label });
  y -= 10;
  page.drawText('Applicants shall also provide an additional 7 years for employers for whom they operated a CMV.', { x: LAYOUT.marginLeft + 4, y, size: 7.5, font, color: COLORS.label });
  y -= 16;

  for (let i = 0; i < employers.length; i++) {
    ({ page, y } = checkPage(pdfDoc, page, y, 140, font, bold, companyName, companyAddress));
    const e = employers[i] || {};
    const empLabel = e.is_current ? 'CURRENT / MOST RECENT EMPLOYER' : `PREVIOUS EMPLOYER ${i}`;

    // Employer sub-header with colored left border
    page.drawRectangle({
      x: LAYOUT.marginLeft,
      y: y - 3,
      width: 3,
      height: 14,
      color: COLORS.primary
    });
    page.drawText(empLabel, { x: LAYOUT.marginLeft + 10, y, size: 9, font: bold, color: COLORS.primary });
    y -= 18;

    y = drawFieldPair(page, font, bold, 'EMPLOYER NAME', e.company_name || e.employerName, 'PHONE', e.phone || e.phoneNumber, y);
    y = drawSingleField(page, font, bold, 'ADDRESS', `${asText(e.street_address || e.streetAddress)} ${asText(e.city)}, ${asText(e.state)} ${asText(e.zip_code || e.zipCode)}`, y, true);
    y = drawFieldPair(page, font, bold, 'POSITION HELD', e.position_held || e.positionHeld, 'CONTACT PERSON', e.contact_person || e.contactPerson, y);
    y = drawFieldPair(page, font, bold, 'FROM', e.from_month_year || e.fromDate, 'TO', e.to_month_year || e.toDate, y);
    y = drawFieldPair(page, font, bold, 'SALARY / WAGE', e.salary || e.salaryWage, 'REASON FOR LEAVING', e.reason_for_leaving || e.reasonForLeaving, y);
    y -= 4;
  }

  // === ACCIDENT RECORD ===
  ({ page, y } = checkPage(pdfDoc, page, y, 100, font, bold, companyName, companyAddress));
  y = drawSectionBanner(page, bold, 'ACCIDENT RECORD (PAST 5 YEARS)', y);
  y -= 2;

  if (!accidents.length) {
    page.drawText('None reported.', { x: LAYOUT.marginLeft + 8, y, size: 9, font, color: COLORS.label });
    y -= 18;
  } else {
    const accColumns = [
      { label: 'DATE', x: LAYOUT.marginLeft + 4 },
      { label: 'NATURE OF ACCIDENT', x: LAYOUT.marginLeft + 80 },
      { label: 'FATALITIES', x: LAYOUT.marginLeft + 290 },
      { label: 'INJURIES', x: LAYOUT.marginLeft + 365 },
      { label: 'HAZ. SPILL', x: LAYOUT.marginLeft + 440 }
    ];
    y = drawTableHeader(page, bold, accColumns, y);
    for (let i = 0; i < accidents.slice(0, 10).length; i++) {
      ({ page, y } = checkPage(pdfDoc, page, y, 70, font, bold, companyName, companyAddress));
      const a = accidents[i];
      y = drawTableRow(page, font, accColumns, [
        fmtDate(a.date),
        asText(a.nature_of_accident || a.natureOfAccident),
        asText(a.fatalities_count || a.fatalities),
        asText(a.injuries_count || a.injuries),
        yn(a.hazardous_material_spill ?? a.hazardousMaterialSpill ?? a.chemical_spill)
      ], y, i % 2 === 1);
    }
  }
  y -= 8;

  // === TRAFFIC CONVICTIONS ===
  ({ page, y } = checkPage(pdfDoc, page, y, 100, font, bold, companyName, companyAddress));
  y = drawSectionBanner(page, bold, 'TRAFFIC CONVICTIONS (PAST 5 YEARS)', y);
  y -= 2;

  if (!violations.length && !convictions.length) {
    page.drawText('None reported.', { x: LAYOUT.marginLeft + 8, y, size: 9, font, color: COLORS.label });
    y -= 18;
  } else {
    const violColumns = [
      { label: 'LOCATION', x: LAYOUT.marginLeft + 4 },
      { label: 'DATE', x: LAYOUT.marginLeft + 140 },
      { label: 'CHARGE', x: LAYOUT.marginLeft + 230 },
      { label: 'PENALTY', x: LAYOUT.marginLeft + 410 }
    ];
    y = drawTableHeader(page, bold, violColumns, y);
    const allViolations = [...violations, ...convictions];
    for (let i = 0; i < allViolations.slice(0, 10).length; i++) {
      ({ page, y } = checkPage(pdfDoc, page, y, 70, font, bold, companyName, companyAddress));
      const v = allViolations[i];
      y = drawTableRow(page, font, violColumns, [
        asText(v.location || v.state_of_violation || v.stateOfViolation),
        fmtDate(v.date || v.date_convicted || v.dateConvicted),
        asText(v.charge || v.violation),
        asText(v.penalty)
      ], y, i % 2 === 1);
    }
  }
  y -= 8;

  // === LICENSE HISTORY ===
  ({ page, y } = checkPage(pdfDoc, page, y, 100, font, bold, companyName, companyAddress));
  y = drawSectionBanner(page, bold, 'DRIVER LICENSES / PERMITS (PAST 3 YEARS)', y);
  y -= 2;

  const licColumns = [
    { label: 'STATE', x: LAYOUT.marginLeft + 4 },
    { label: 'LICENSE NO.', x: LAYOUT.marginLeft + 70 },
    { label: 'TYPE / CLASS', x: LAYOUT.marginLeft + 230 },
    { label: 'EXPIRATION DATE', x: LAYOUT.marginLeft + 400 }
  ];
  y = drawTableHeader(page, bold, licColumns, y);
  for (let i = 0; i < licenses.slice(0, 5).length; i++) {
    ({ page, y } = checkPage(pdfDoc, page, y, 70, font, bold, companyName, companyAddress));
    const l = licenses[i];
    y = drawTableRow(page, font, licColumns, [
      asText(l.state),
      asText(l.license_number || l.licenseNumber),
      asText(l.license_class_or_type || l.type),
      fmtDate(l.expiration_date || l.expirationDate)
    ], y, i % 2 === 1);
  }
  y -= 8;

  // === DRIVING EXPERIENCE ===
  ({ page, y } = checkPage(pdfDoc, page, y, 140, font, bold, companyName, companyAddress));
  y = drawSectionBanner(page, bold, 'DRIVING EXPERIENCE', y);
  y -= 2;

  const expColumns = [
    { label: 'EXP?', x: LAYOUT.marginLeft + 4, maxChars: 4 },
    { label: 'CLASS OF EQUIPMENT', x: LAYOUT.marginLeft + 38 },
    { label: 'TYPE', x: LAYOUT.marginLeft + 210 },
    { label: 'DATES FROM-TO', x: LAYOUT.marginLeft + 310 },
    { label: 'APPROX MILES', x: LAYOUT.marginLeft + 440 }
  ];
  y = drawTableHeader(page, bold, expColumns, y);

  const expTypes = [
    { key: 'straightTruck', label: 'Straight Truck' },
    { key: 'tractorSemiTrailer', label: 'Tractor & Semi-Trailer' },
    { key: 'tractorTwoTrailers', label: 'Tractor Two Trailers' },
    { key: 'motorcoachSchoolBus', label: 'Motorcoach/School Bus (8+)' },
    { key: 'motorcoachSchoolBusMore15', label: 'Motorcoach/School Bus (15+)' },
    { key: 'other', label: 'Other' }
  ];
  for (let i = 0; i < expTypes.length; i++) {
    ({ page, y } = checkPage(pdfDoc, page, y, 70, font, bold, companyName, companyAddress));
    const et = expTypes[i];
    const exp = drivingExp[et.key] || {};
    const has = exp.hasExperience;
    const desc = et.key === 'other' && exp.description ? `${et.label}: ${exp.description}` : et.label;
    y = drawTableRow(page, font, expColumns, [
      has ? 'YES' : 'NO',
      desc,
      asText(exp.typeOfEquipment),
      `${asText(exp.dateFrom)} - ${asText(exp.dateTo)}`,
      asText(exp.approxMiles)
    ], y, i % 2 === 1);
  }
  y -= 4;
  page.drawText(`States operated in for last 5 years: ${asText(drivingExp.statesOperatedIn)}`, {
    x: LAYOUT.marginLeft + 4, y, size: 8, font, color: COLORS.text
  });
  y -= 16;

  // === DRUG & ALCOHOL INFORMATION ===
  ({ page, y } = checkPage(pdfDoc, page, y, 160, font, bold, companyName, companyAddress));
  y = drawSectionBanner(page, bold, 'DRUG & ALCOHOL INFORMATION', y);
  page.drawText('In the previous three (3) years have you:', { x: LAYOUT.marginLeft + 4, y, size: 8, font, color: COLORS.label });
  y -= 14;

  const daQuestions = [
    { key: 'violatedSubstanceProhibitions', label: '1. Violated Alcohol/Controlled Substance prohibitions (49CFR Part 382/40)' },
    { key: 'failedRehabProgram', label: '2. Failed to complete a rehabilitation program (SAP per 49CFR 382.605)' },
    { key: 'alcoholTestResult04OrHigher', label: '3. Had an alcohol test result of 0.04 or higher' },
    { key: 'positiveControlledSubstancesTest', label: '4. Tested positive for controlled substances' },
    { key: 'refusedRequiredTest', label: '5. Refused to submit to a required test' },
    { key: 'otherDOTViolation', label: '6. Had any other violation of DOT drug/alcohol testing regulations' }
  ];
  for (const q of daQuestions) {
    ({ page, y } = checkPage(pdfDoc, page, y, 70, font, bold, companyName, companyAddress));
    y = drawQuestionRow(page, font, bold, q.label, yn(drugAlcohol[q.key]), y);
  }
  y -= 10;

  // === APPLICANT CERTIFICATION & SIGNATURE (FN-233) ===
  ({ page, y } = checkPage(pdfDoc, page, y, 240, font, bold, companyName, companyAddress));
  y = drawSectionBanner(page, bold, 'APPLICANT CERTIFICATION & SIGNATURE', y);
  y -= 2;

  const certParagraphs = [
    'I authorize investigations into my personal, employment, financial and related history.',
    'I understand that false or misleading information may result in discharge.',
    'I understand prior employers may be contacted for safety performance history (49 CFR 391.23).',
    'I have the right to review, correct, and rebut information provided by previous employers.',
    'I certify this application is true and complete to the best of my knowledge.'
  ];
  for (const p of certParagraphs) {
    page.drawText(p, { x: LAYOUT.marginLeft + 4, y, size: 8.5, font, color: COLORS.text });
    y -= 12;
  }
  y -= 8;

  // FN-233: Captured applicant identity fields
  const certFullName = [applicant.firstName, applicant.middleName, applicant.lastName].filter(Boolean).join(' ');
  y = drawFieldPair(page, font, bold, 'FULL NAME', certFullName, 'DATE OF BIRTH', fmtDate(applicant.dateOfBirth), y);
  y = drawFieldPair(page, font, bold, 'SSN (MASKED)', maskSSN(applicant.ssn), 'POSITION APPLIED FOR', applicant.positionAppliedFor, y);

  const certLicenseNum = applicant.licenseNumber || (licenses.length > 0 ? (licenses[0].license_number || licenses[0].licenseNumber) : '') || '';
  const certLicenseState = applicant.licenseState || (licenses.length > 0 ? licenses[0].state : '') || '';
  y = drawFieldPair(page, font, bold, "DRIVER'S LICENSE NUMBER", certLicenseNum, 'STATE OF ISSUE', certLicenseState, y);
  y -= 4;

  // Signature box
  const sigBoxHeight = 72;
  ({ page, y } = checkPage(pdfDoc, page, y, sigBoxHeight + 20, font, bold, companyName, companyAddress));
  page.drawRectangle({
    x: LAYOUT.marginLeft,
    y: y - sigBoxHeight + 10,
    width: LAYOUT.contentWidth,
    height: sigBoxHeight,
    borderColor: COLORS.primary,
    borderWidth: 1,
    color: COLORS.white
  });
  page.drawText('APPLICANT SIGNATURE', { x: LAYOUT.marginLeft + 8, y, size: 8, font: bold, color: COLORS.primary });
  y -= 16;

  const cert = applicant.certification || {};
  const sigName = asText(cert.applicantSignature || applicant.applicantSignature || applicant.applicantPrintedName || [applicant.firstName, applicant.lastName].filter(Boolean).join(' '));
  page.drawText(`Signature: ${sigName}`, { x: LAYOUT.marginLeft + 8, y, size: 10, font: bold, color: COLORS.text });

  const sigDateStr = fmtDate(fullApp.signed_certification_at || cert.signatureDate || applicant.signatureDate || fullApp.signed_at || fullApp.submitted_at);
  const sigDateText = `Date: ${sigDateStr}`;
  const sdw = bold.widthOfTextAtSize(sigDateText, 10);
  page.drawText(sigDateText, { x: LAYOUT.marginLeft + LAYOUT.contentWidth - sdw - 8, y, size: 10, font: bold, color: COLORS.text });
  y -= 16;

  const printedName = asText(cert.applicantPrintedName || applicant.applicantPrintedName || certFullName);
  page.drawText(`Printed Name: ${printedName}`, { x: LAYOUT.marginLeft + 8, y, size: 9, font, color: COLORS.text });
  y -= 14;

  page.drawText('This application was signed electronically. The signer consents to the use of electronic signatures in accordance with applicable law.', {
    x: LAYOUT.marginLeft + 8, y, size: 6.5, font, color: COLORS.label
  });
  y -= sigBoxHeight - 42; // move past box bottom

  // === DOCUMENT AUDIT TRAIL ===
  const audit = context.auditTrail || applicant.auditTrail || {};
  if (audit.ipAddress || audit.submittedAt || audit.userAgent) {
    y -= 8;
    ({ page, y } = checkPage(pdfDoc, page, y, 80, font, bold, companyName, companyAddress));

    const auditBoxHeight = 56;
    page.drawRectangle({
      x: LAYOUT.marginLeft,
      y: y - auditBoxHeight + 12,
      width: LAYOUT.contentWidth,
      height: auditBoxHeight,
      color: COLORS.auditBg,
      borderColor: COLORS.border,
      borderWidth: 0.5
    });
    page.drawText('DOCUMENT AUDIT TRAIL', { x: LAYOUT.marginLeft + 8, y, size: 8, font: bold, color: COLORS.label });
    y -= 12;
    if (audit.ipAddress) {
      page.drawText(`IP Address: ${asText(audit.ipAddress)}`, { x: LAYOUT.marginLeft + 8, y, size: 7, font, color: COLORS.label });
      y -= 10;
    }
    if (audit.submittedAt) {
      page.drawText(`Submitted At: ${asText(audit.submittedAt)}`, { x: LAYOUT.marginLeft + 8, y, size: 7, font, color: COLORS.label });
      y -= 10;
    }
    if (audit.userAgent) {
      const ua = asText(audit.userAgent).slice(0, 120);
      page.drawText(`User Agent: ${ua}`, { x: LAYOUT.marginLeft + 8, y, size: 6.5, font, color: COLORS.label });
      y -= 10;
    }
  }

  // === Add page footers to all pages ===
  const allPages = pdfDoc.getPages();
  for (let i = 0; i < allPages.length; i++) {
    drawPageFooter(allPages[i], font, i + 1, allPages.length, asText(docId), genDate);
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

module.exports = {
  generateEmploymentApplicationPdf
};
