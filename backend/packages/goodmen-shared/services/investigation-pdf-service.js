/**
 * Investigation PDF Service
 *
 * Generates PDF documents for the Previous Employer Safety Performance
 * Investigation workflow (49 CFR 391.23(d)(2) and 40.25).
 *
 * Two primary functions:
 *   - buildRequestPdf  : the outbound inquiry letter sent to a past employer
 *   - buildResponsePdf : the completed investigation response record
 */
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
  if (v === true || v === 'yes' || v === 'Yes' || v === 'YES') return 'YES';
  if (v === false || v === 'no' || v === 'No' || v === 'NO') return 'NO';
  return 'N/A';
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ─── Color scheme and layout constants (mirrors pdf.service.js) ──────────────

const COLORS = {
  primary: rgb(0.06, 0.29, 0.42),
  headerBg: rgb(0.93, 0.95, 0.97),
  text: rgb(0.1, 0.1, 0.1),
  label: rgb(0.4, 0.4, 0.4),
  border: rgb(0.78, 0.82, 0.86),
  white: rgb(1, 1, 1),
  altRow: rgb(0.97, 0.97, 0.98),
};

const LAYOUT = {
  pageWidth: 612,
  pageHeight: 792,
  marginLeft: 45,
  marginRight: 45,
  marginTop: 50,
  marginBottom: 60,
  contentWidth: 522,   // 612 - 45 - 45
  contentStartY: 720,
};

// ─── Drawing helpers ─────────────────────────────────────────────────────────

function drawPageHeader(page, font, boldFont, companyName, title) {
  const { pageWidth, marginLeft, marginRight } = LAYOUT;
  page.drawText(companyName || '', { x: marginLeft, y: 755, size: 13, font: boldFont, color: COLORS.primary });
  const titleWidth = boldFont.widthOfTextAtSize(title, 8);
  page.drawText(title, { x: pageWidth - marginRight - titleWidth, y: 755, size: 8, font: boldFont, color: COLORS.primary });
  page.drawLine({
    start: { x: marginLeft, y: 740 },
    end: { x: pageWidth - marginRight, y: 740 },
    thickness: 1,
    color: COLORS.border,
  });
}

function drawPageFooter(page, font, pageNum, totalPages, genDate) {
  const { pageWidth, marginLeft, marginRight } = LAYOUT;
  page.drawLine({
    start: { x: marginLeft, y: 45 },
    end: { x: pageWidth - marginRight, y: 45 },
    thickness: 0.5,
    color: COLORS.border,
  });
  if (genDate) {
    const dateText = `Generated: ${genDate}`;
    const w = font.widthOfTextAtSize(dateText, 7);
    page.drawText(dateText, { x: (pageWidth - w) / 2, y: 32, size: 7, font, color: COLORS.label });
  }
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
    borderWidth: 0.5,
  });
  page.drawText(title, { x: marginLeft + 8, y, size: 10, font: boldFont, color: COLORS.primary });
  return y - 24;
}

function drawFieldPair(page, font, boldFont, label1, value1, label2, value2, y) {
  const { marginLeft, contentWidth } = LAYOUT;
  const halfWidth = contentWidth / 2 - 5;
  page.drawText(label1, { x: marginLeft, y: y + 10, size: 7, font, color: COLORS.label });
  page.drawText(asText(value1), { x: marginLeft, y: y - 2, size: 9, font: boldFont, color: COLORS.text });
  page.drawLine({
    start: { x: marginLeft, y: y - 6 },
    end: { x: marginLeft + halfWidth, y: y - 6 },
    thickness: 0.5,
    color: COLORS.border,
  });
  if (label2) {
    const x2 = marginLeft + halfWidth + 10;
    page.drawText(label2, { x: x2, y: y + 10, size: 7, font, color: COLORS.label });
    page.drawText(asText(value2), { x: x2, y: y - 2, size: 9, font: boldFont, color: COLORS.text });
    page.drawLine({
      start: { x: x2, y: y - 6 },
      end: { x: x2 + halfWidth, y: y - 6 },
      thickness: 0.5,
      color: COLORS.border,
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
    color: COLORS.border,
  });
  return y - 28;
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
    color: COLORS.border,
  });
  return y - 16;
}

/**
 * Draw a wrapped paragraph of text.  Returns updated y position.
 */
function drawWrappedText(page, font, text, y, { size = 9, color, maxWidth, lineHeight = 14, x }) {
  const drawColor = color || COLORS.text;
  const drawX = x || LAYOUT.marginLeft;
  const drawMaxWidth = maxWidth || LAYOUT.contentWidth;
  const words = asText(text).split(/\s+/);
  let line = '';

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    const testWidth = font.widthOfTextAtSize(testLine, size);
    if (testWidth > drawMaxWidth && line) {
      page.drawText(line, { x: drawX, y, size, font, color: drawColor });
      y -= lineHeight;
      line = word;
    } else {
      line = testLine;
    }
  }
  if (line) {
    page.drawText(line, { x: drawX, y, size, font, color: drawColor });
    y -= lineHeight;
  }
  return y;
}

function newPageWithHeader(pdfDoc, font, boldFont, companyName, title) {
  const page = pdfDoc.addPage([LAYOUT.pageWidth, LAYOUT.pageHeight]);
  drawPageHeader(page, font, boldFont, companyName, title);
  return { page, y: LAYOUT.contentStartY };
}

function checkPage(pdfDoc, page, y, minY, font, boldFont, companyName, title) {
  if (y < minY) {
    return newPageWithHeader(pdfDoc, font, boldFont, companyName, title);
  }
  return { page, y };
}

// ─── Helper: format OE address as single line ────────────────────────────────

function formatAddress(obj) {
  if (!obj) return '';
  const parts = [
    obj.address_line1 || obj.addressLine1 || '',
    obj.address_line2 || obj.addressLine2 || '',
    obj.city || '',
    obj.state || '',
    obj.zip_code || obj.zipCode || obj.zip || '',
  ].filter(Boolean);
  return parts.join(', ');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Function 1: buildRequestPdf
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a Previous Employer Safety Performance Investigation Request PDF.
 *
 * @param {Object} driverData - Driver info (first_name, last_name, cdl_number, cdl_state, etc.)
 * @param {Object} employerData - Past employer info (company_name, contact_name, address, phone, email, usdot_number)
 * @param {Object} oeData - Operating entity branding (name, legal_name, address fields, phone, email, dot_number)
 * @param {string} publicLink - URL where the employer can complete the investigation online
 * @returns {Promise<Buffer>} PDF file buffer
 */
async function buildRequestPdf(driverData, employerData, oeData, publicLink) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const companyName = asText(oeData.name || oeData.legal_name);
  const docTitle = 'INVESTIGATION REQUEST';
  const genDate = todayStr();

  // ── Page 1 ──────────────────────────────────────────────────────────────
  let { page, y } = newPageWithHeader(pdfDoc, font, bold, companyName, docTitle);

  // Main title
  const mainTitle = 'PREVIOUS EMPLOYER SAFETY PERFORMANCE HISTORY INVESTIGATION';
  const titleW = bold.widthOfTextAtSize(mainTitle, 11);
  page.drawText(mainTitle, {
    x: (LAYOUT.pageWidth - titleW) / 2,
    y,
    size: 11,
    font: bold,
    color: COLORS.primary,
  });
  y -= 16;

  // Subtitle / regulation reference
  const subtitle = '49 CFR \u00A7391.23(d)(2) and \u00A740.25';
  const subW = font.widthOfTextAtSize(subtitle, 9);
  page.drawText(subtitle, {
    x: (LAYOUT.pageWidth - subW) / 2,
    y,
    size: 9,
    font,
    color: COLORS.label,
  });
  y -= 28;

  // ── FROM block ────────────────────────────────────────────────────────
  y = drawSectionBanner(page, bold, 'FROM (Requesting Company)', y);
  y = drawFieldPair(page, font, bold, 'Company Name', companyName, 'USDOT #', asText(oeData.dot_number || oeData.usdot_number), y);
  y = drawSingleField(page, font, bold, 'Address', formatAddress(oeData), y, true);
  y = drawFieldPair(page, font, bold, 'Phone', asText(oeData.phone), 'Email', asText(oeData.email), y);
  y -= 8;

  // ── TO block ──────────────────────────────────────────────────────────
  y = drawSectionBanner(page, bold, 'TO (Previous Employer)', y);
  y = drawFieldPair(page, font, bold, 'Company Name', asText(employerData.company_name), 'USDOT #', asText(employerData.usdot_number), y);
  y = drawFieldPair(page, font, bold, 'Contact Name', asText(employerData.contact_name), 'Phone', asText(employerData.phone || employerData.contact_phone), y);
  y = drawSingleField(page, font, bold, 'Address', formatAddress(employerData), y, true);
  y = drawFieldPair(page, font, bold, 'Email', asText(employerData.email || employerData.contact_email), 'Fax', asText(employerData.fax || employerData.contact_fax || ''), y);
  y -= 8;

  // ── Driver info ───────────────────────────────────────────────────────
  y = drawSectionBanner(page, bold, 'DRIVER INFORMATION', y);
  const driverName = [driverData.first_name, driverData.middle_name, driverData.last_name].filter(Boolean).join(' ');
  y = drawFieldPair(page, font, bold, 'Driver Name', driverName, 'CDL Number', asText(driverData.cdl_number), y);
  y = drawFieldPair(page, font, bold, 'CDL State', asText(driverData.cdl_state), 'Date of Birth', fmtDate(driverData.date_of_birth || driverData.dob), y);
  y = drawFieldPair(
    page, font, bold,
    'Employment Start Date', fmtDate(employerData.start_date || employerData.from_date),
    'Employment End Date', fmtDate(employerData.end_date || employerData.to_date),
    y
  );
  y -= 8;

  // ── Request text ──────────────────────────────────────────────────────
  y = drawSectionBanner(page, bold, 'REQUEST', y);

  const requestText =
    'Pursuant to 49 CFR \u00A7391.23(d)(2) and \u00A740.25, we are required to investigate the safety ' +
    'performance history of all prospective drivers during the preceding three years. We respectfully ' +
    'request that you provide the following information regarding the above-named individual who has ' +
    'applied for a driver position with our company:\n\n' +
    '1. Whether the driver was subject to the DOT drug and alcohol testing requirements.\n' +
    '2. Any alcohol or controlled substance test results of 0.04 or greater.\n' +
    '3. Any refusal to be tested (including verified adulterated or substituted drug test results).\n' +
    '4. Any other violations of DOT drug and alcohol testing regulations.\n' +
    '5. If the driver violated a DOT drug and alcohol regulation, documentation of the driver\'s ' +
    'successful completion of the return-to-duty process.\n' +
    '6. Any accidents involving the driver, including date, city/state, number of injuries, number ' +
    'of fatalities, and whether hazmat was released.';

  // Split by \n for explicit line breaks
  for (const paragraph of requestText.split('\n')) {
    if (paragraph.trim() === '') {
      y -= 6;
      continue;
    }
    ({ page, y } = checkPage(pdfDoc, page, y, LAYOUT.marginBottom + 30, font, bold, companyName, docTitle));
    y = drawWrappedText(page, font, paragraph, y, { size: 8.5, lineHeight: 12 });
    y -= 2;
  }
  y -= 10;

  // ── Public link section ───────────────────────────────────────────────
  ({ page, y } = checkPage(pdfDoc, page, y, LAYOUT.marginBottom + 60, font, bold, companyName, docTitle));

  y = drawSectionBanner(page, bold, 'ONLINE RESPONSE', y);

  const linkIntro = 'You may complete this investigation online at the following link:';
  y = drawWrappedText(page, font, linkIntro, y, { size: 9, lineHeight: 13 });
  y -= 4;

  // Draw the link in primary color
  page.drawText(asText(publicLink), {
    x: LAYOUT.marginLeft + 8,
    y,
    size: 9,
    font: bold,
    color: COLORS.primary,
  });
  y -= 20;

  const linkNote = 'If you are unable to respond online, please complete and return this form via fax or mail to the address above.';
  y = drawWrappedText(page, font, linkNote, y, { size: 8, color: COLORS.label, lineHeight: 12 });
  y -= 16;

  // ── Compliance note ───────────────────────────────────────────────────
  ({ page, y } = checkPage(pdfDoc, page, y, LAYOUT.marginBottom + 40, font, bold, companyName, docTitle));

  const complianceNote =
    'Federal regulations require previous employers to respond to these inquiries within 30 days ' +
    'of receipt. Your cooperation is appreciated and is required by federal law.';
  y = drawWrappedText(page, font, complianceNote, y, { size: 8, color: COLORS.label, lineHeight: 12 });

  // ── Footers ───────────────────────────────────────────────────────────
  const pages = pdfDoc.getPages();
  const totalPages = pages.length;
  for (let i = 0; i < totalPages; i++) {
    drawPageFooter(pages[i], font, i + 1, totalPages, genDate);
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Function 2: buildResponsePdf
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a Previous Employer Safety Performance History Response PDF.
 *
 * @param {Object} responseData - The response_data JSONB from employer_investigation_responses
 * @param {Object} driverData - Driver info (first_name, last_name, cdl_number, cdl_state, etc.)
 * @param {Object} employerData - Past employer info (company_name, contact_name, dates, etc.)
 * @param {Object} oeData - Operating entity branding (name, address fields, phone, etc.)
 * @returns {Promise<Buffer>} PDF file buffer
 */
async function buildResponsePdf(responseData, driverData, employerData, oeData) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const companyName = asText(oeData.name || oeData.legal_name);
  const docTitle = 'INVESTIGATION RESPONSE';
  const genDate = todayStr();
  const data = responseData || {};

  // ── Page 1 ──────────────────────────────────────────────────────────────
  let { page, y } = newPageWithHeader(pdfDoc, font, bold, companyName, docTitle);

  // Main title
  const mainTitle = 'PREVIOUS EMPLOYER SAFETY PERFORMANCE HISTORY \u2014 RESPONSE';
  const titleW = bold.widthOfTextAtSize(mainTitle, 11);
  page.drawText(mainTitle, {
    x: (LAYOUT.pageWidth - titleW) / 2,
    y,
    size: 11,
    font: bold,
    color: COLORS.primary,
  });
  y -= 16;

  const subtitle = '49 CFR \u00A7391.23(d)(2) and \u00A740.25';
  const subW = font.widthOfTextAtSize(subtitle, 9);
  page.drawText(subtitle, {
    x: (LAYOUT.pageWidth - subW) / 2,
    y,
    size: 9,
    font,
    color: COLORS.label,
  });
  y -= 28;

  // ── Driver info ───────────────────────────────────────────────────────
  y = drawSectionBanner(page, bold, 'DRIVER INFORMATION', y);
  const driverName = [driverData.first_name, driverData.middle_name, driverData.last_name].filter(Boolean).join(' ');
  y = drawFieldPair(page, font, bold, 'Driver Name', driverName, 'CDL Number', asText(driverData.cdl_number), y);
  y = drawFieldPair(page, font, bold, 'CDL State', asText(driverData.cdl_state), 'Date of Birth', fmtDate(driverData.date_of_birth || driverData.dob), y);
  y = drawFieldPair(
    page, font, bold,
    'Employment Start Date', fmtDate(employerData.start_date || employerData.from_date),
    'Employment End Date', fmtDate(employerData.end_date || employerData.to_date),
    y
  );
  y -= 8;

  // ── Employer respondent ───────────────────────────────────────────────
  y = drawSectionBanner(page, bold, 'EMPLOYER RESPONDENT', y);
  y = drawFieldPair(page, font, bold, 'Company Name', asText(employerData.company_name), 'USDOT #', asText(employerData.usdot_number), y);
  y = drawFieldPair(
    page, font, bold,
    'Respondent Name', asText(data.responder_name || employerData.contact_name),
    'Title', asText(data.responder_title),
    y
  );
  y = drawFieldPair(page, font, bold, 'Response Date', fmtDate(data.response_date), 'Received Via', asText(data.received_via), y);
  y -= 8;

  // ── General / DOT testing ─────────────────────────────────────────────
  ({ page, y } = checkPage(pdfDoc, page, y, LAYOUT.marginBottom + 80, font, bold, companyName, docTitle));
  y = drawSectionBanner(page, bold, 'GENERAL', y);
  y = drawQuestionRow(page, font, bold, 'Was the driver subject to DOT drug and alcohol testing requirements?', yn(data.subject_to_dot_testing), y);
  y = drawQuestionRow(page, font, bold, 'Was the driver employed in a safety-sensitive function?', yn(data.safety_sensitive_function), y);
  y -= 8;

  // ── Accidents ─────────────────────────────────────────────────────────
  ({ page, y } = checkPage(pdfDoc, page, y, LAYOUT.marginBottom + 60, font, bold, companyName, docTitle));
  y = drawSectionBanner(page, bold, 'ACCIDENTS (Past 3 Years)', y);

  const accidents = Array.isArray(data.accidents) ? data.accidents : [];
  if (accidents.length === 0) {
    y = drawQuestionRow(page, font, bold, 'Any DOT-recordable accidents on file?', yn(data.has_accidents), y);
  } else {
    y = drawQuestionRow(page, font, bold, 'Any DOT-recordable accidents on file?', 'YES', y);
    y -= 4;
    for (let i = 0; i < accidents.length; i++) {
      ({ page, y } = checkPage(pdfDoc, page, y, LAYOUT.marginBottom + 50, font, bold, companyName, docTitle));
      const acc = accidents[i];
      page.drawText(`Accident ${i + 1}:`, { x: LAYOUT.marginLeft + 8, y, size: 8, font: bold, color: COLORS.text });
      y -= 14;
      y = drawFieldPair(page, font, bold, 'Date', fmtDate(acc.date), 'Location', asText(acc.location || acc.city_state), y);
      y = drawFieldPair(page, font, bold, 'Injuries', asText(acc.injuries), 'Fatalities', asText(acc.fatalities), y);
      y = drawFieldPair(page, font, bold, 'Hazmat Released', yn(acc.hazmat_released), 'Description', asText(acc.description), y);
    }
  }
  y -= 8;

  // ── Drug & Alcohol ────────────────────────────────────────────────────
  ({ page, y } = checkPage(pdfDoc, page, y, LAYOUT.marginBottom + 80, font, bold, companyName, docTitle));
  y = drawSectionBanner(page, bold, 'DRUG & ALCOHOL TESTING', y);
  y = drawQuestionRow(page, font, bold, 'Pre-employment drug test conducted?', yn(data.pre_employment_test_conducted), y);
  y = drawQuestionRow(page, font, bold, 'Pre-employment drug test result', asText(data.pre_employment_test_result || 'N/A'), y);
  y = drawQuestionRow(page, font, bold, 'Any alcohol test result of 0.04 or greater?', yn(data.alcohol_test_violation), y);
  y = drawQuestionRow(page, font, bold, 'Any verified positive drug test?', yn(data.positive_drug_test), y);
  y = drawQuestionRow(page, font, bold, 'Any refusal to be tested?', yn(data.refusal_to_test), y);
  y = drawQuestionRow(page, font, bold, 'Any other DOT drug/alcohol regulation violation?', yn(data.other_dot_violation), y);

  if (data.dot_violation_details) {
    ({ page, y } = checkPage(pdfDoc, page, y, LAYOUT.marginBottom + 30, font, bold, companyName, docTitle));
    y -= 4;
    y = drawWrappedText(page, font, `Details: ${data.dot_violation_details}`, y, { size: 8, lineHeight: 11, x: LAYOUT.marginLeft + 16 });
  }

  if (yn(data.completed_return_to_duty) !== 'N/A') {
    y = drawQuestionRow(page, font, bold, 'Completed return-to-duty process?', yn(data.completed_return_to_duty), y);
  }
  y -= 8;

  // ── Termination / separation ──────────────────────────────────────────
  ({ page, y } = checkPage(pdfDoc, page, y, LAYOUT.marginBottom + 60, font, bold, companyName, docTitle));
  y = drawSectionBanner(page, bold, 'EMPLOYMENT SEPARATION', y);
  y = drawQuestionRow(page, font, bold, 'Reason for leaving / termination', asText(data.reason_for_leaving || 'N/A'), y);
  y = drawQuestionRow(page, font, bold, 'Eligible for rehire?', yn(data.eligible_for_rehire), y);

  if (data.separation_details) {
    ({ page, y } = checkPage(pdfDoc, page, y, LAYOUT.marginBottom + 30, font, bold, companyName, docTitle));
    y -= 4;
    y = drawWrappedText(page, font, `Details: ${data.separation_details}`, y, { size: 8, lineHeight: 11, x: LAYOUT.marginLeft + 16 });
  }
  y -= 8;

  // ── Certification ─────────────────────────────────────────────────────
  ({ page, y } = checkPage(pdfDoc, page, y, LAYOUT.marginBottom + 80, font, bold, companyName, docTitle));
  y = drawSectionBanner(page, bold, 'CERTIFICATION', y);

  const certText =
    'I certify that the information provided above is true, accurate, and complete to the best of my ' +
    'knowledge. I understand that this information is being provided in compliance with 49 CFR ' +
    '\u00A7391.23(d)(2) and \u00A740.25, and that making false statements may subject me to penalties ' +
    'under federal law.';
  y = drawWrappedText(page, font, certText, y, { size: 8.5, lineHeight: 12 });
  y -= 16;

  y = drawFieldPair(
    page, font, bold,
    'Respondent Name', asText(data.responder_name || employerData.contact_name),
    'Title', asText(data.responder_title),
    y
  );
  y = drawFieldPair(
    page, font, bold,
    'Signature Date', fmtDate(data.signature_date || data.response_date),
    'Phone', asText(data.responder_phone || employerData.phone || employerData.contact_phone),
    y
  );
  y = drawSingleField(page, font, bold, 'Email', asText(data.responder_email || employerData.email || employerData.contact_email), y, true);

  // ── Additional notes ──────────────────────────────────────────────────
  if (data.additional_notes) {
    ({ page, y } = checkPage(pdfDoc, page, y, LAYOUT.marginBottom + 40, font, bold, companyName, docTitle));
    y -= 8;
    y = drawSectionBanner(page, bold, 'ADDITIONAL NOTES', y);
    y = drawWrappedText(page, font, data.additional_notes, y, { size: 8.5, lineHeight: 12 });
  }

  // ── Footers ───────────────────────────────────────────────────────────
  const pages = pdfDoc.getPages();
  const totalPages = pages.length;
  for (let i = 0; i < totalPages; i++) {
    drawPageFooter(pages[i], font, i + 1, totalPages, genDate);
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  buildRequestPdf,
  buildResponsePdf,
};
