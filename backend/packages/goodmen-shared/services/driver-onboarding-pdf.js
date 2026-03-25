const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

function safeDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString().slice(0, 10);
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

const employmentTemplatePath =
  process.env.EMPLOYMENT_APPLICATION_TEMPLATE_PATH ||
  path.join(__dirname, '../assets/templates/Drivers_Employment_Application_508.pdf');

const mvrTemplatePath =
  process.env.MVR_AUTHORIZATION_TEMPLATE_PATH ||
  path.join(__dirname, '../assets/templates/MVR_-_Employee_Authorization_Form.pdf');

async function loadTemplate(templatePath) {
  const bytes = await fs.promises.readFile(templatePath);
  return PDFDocument.load(bytes);
}

async function drawText(page, font, text, x, y, options = {}) {
  if (!text) return;
  page.drawText(String(text), {
    x,
    y,
    size: options.size || 9,
    font,
    color: options.color || undefined,
    maxWidth: options.maxWidth
  });
}

async function buildEmploymentApplicationPdf({ driver, application, signature }) {
  const pdfDoc = await loadTemplate(employmentTemplatePath);
  const pages = pdfDoc.getPages();
  const page = pages[0];
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const fullName = [
    application.firstName || driver?.first_name || '',
    application.middleName || '',
    application.lastName || driver?.last_name || ''
  ]
    .filter(Boolean)
    .join(' ');

  // NOTE: The (x, y) coordinates below assume a standard US Letter page.
  // You can fine‑tune these numbers to align exactly with the blanks on the template.

  // Top section – applicant info
  await drawText(page, font, fullName, 110, 680);
  await drawText(page, application.phone || driver?.phone || '', 110, 664);
  await drawText(page, application.email || driver?.email || '', 110, 648);
  await drawText(page, safeDate(application.dateOfBirth), 420, 648);
  await drawText(page, maskSSN(application.ssnLast4 || application.ssn), 420, 664);
  await drawText(page, application.positionAppliedFor || '', 180, 632);
  await drawText(page, safeDate(application.dateAvailable), 430, 632);

  const cityStateZip = [
    application.addressCity || '',
    application.addressState || '',
    application.addressZip || ''
  ]
    .filter(Boolean)
    .join(', ');

  // Address
  await drawText(page, application.addressStreet || '', 140, 604);
  await drawText(page, cityStateZip, 140, 588);
  await drawText(page, application.yearsAtAddress || '', 500, 588);

  // CDL / license
  const licenseLine = `${application.licenseState || driver?.cdl_state || ''} ${application.licenseNumber ||
    driver?.cdl_number ||
    ''}`;
  await drawText(page, licenseLine, 160, 558);
  await drawText(page, application.licenseClass || '', 430, 558);
  await drawText(page, application.licenseEndorsements || '', 160, 542);
  await drawText(page, safeDate(application.licenseExpiry), 430, 542);

  // Current employer
  await drawText(page, application.currentEmployerName || '', 140, 500);
  await drawText(page, application.currentEmployerPhone || '', 420, 500);
  await drawText(page, application.currentEmployerFrom || '', 140, 484);
  await drawText(page, application.currentEmployerTo || '', 320, 484);
  await drawText(page, application.currentEmployerReasonForLeaving || '', 140, 468, {
    maxWidth: 400
  });

  // Previous employer
  await drawText(page, application.previousEmployerName || '', 140, 438);
  await drawText(page, application.previousEmployerPhone || '', 420, 438);
  await drawText(page, application.previousEmployerFrom || '', 140, 422);
  await drawText(page, application.previousEmployerTo || '', 320, 422);
  await drawText(page, application.previousEmployerReasonForLeaving || '', 140, 406, {
    maxWidth: 400
  });

  // Education / other
  await drawText(page, application.educationSummary || '', 60, 360, {
    maxWidth: 480
  });
  await drawText(page, application.otherQualifications || '', 60, 320, {
    maxWidth: 480
  });

  // Signature
  const sigName =
    signature?.signerName || application.applicationSignatureName || '';
  const sigDate = safeDate(
    signature?.signedAt || application.applicationSignatureDate
  );
  await drawText(page, sigName, 140, 210);
  await drawText(page, sigDate, 430, 210);

  // ------------------------------------------------------------------
  // FN-215: Additional pages for 10-year history, disqualifications,
  //         and signed certification block.
  // ------------------------------------------------------------------
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const margin = 50;
  const lineHeight = 14;
  const pageWidth = 612;
  const pageHeight = 792;
  const textWidth = pageWidth - 2 * margin;
  const bottomMargin = 60;

  // Helper: get current page or add a new one if near the bottom
  let extraPage = null;
  let yPos = 0;

  function ensurePage() {
    if (!extraPage || yPos < bottomMargin) {
      extraPage = pdfDoc.addPage([pageWidth, pageHeight]);
      yPos = pageHeight - margin;
    }
    return extraPage;
  }

  function writeText(text, opts = {}) {
    const p = ensurePage();
    p.drawText(String(text || ''), {
      x: opts.x || margin,
      y: yPos,
      size: opts.size || 9,
      font: opts.bold ? boldFont : font,
      color: opts.color || rgb(0, 0, 0),
      maxWidth: opts.maxWidth || textWidth
    });
    yPos -= opts.lineSpacing || lineHeight;
  }

  function writeHeading(text) {
    ensurePage();
    yPos -= lineHeight * 0.5;
    writeText(text, { size: 12, bold: true, lineSpacing: lineHeight * 1.5 });
  }

  function writeSectionSeparator() {
    yPos -= lineHeight;
  }

  // --- Tiered Employer History ---
  const employers = application.employers || [];
  const detailedEmployers = employers.filter((e) => !e.tier || e.tier === 'detailed');
  const summaryEmployers = employers.filter((e) => e.tier === 'summary');

  if (detailedEmployers.length > 0) {
    writeHeading('Detailed Employment History (3 Years)');
    detailedEmployers.forEach((emp, idx) => {
      writeText(`${idx + 1}. ${emp.employer_name || 'N/A'}`, { bold: true, size: 10 });
      if (emp.address || emp.city || emp.state) {
        writeText(`   Address: ${[emp.address, emp.city, emp.state, emp.zip].filter(Boolean).join(', ')}`, { x: margin + 15 });
      }
      if (emp.contact_name || emp.contact_phone) {
        writeText(`   Contact: ${[emp.contact_name, emp.contact_phone].filter(Boolean).join(' | ')}`, { x: margin + 15 });
      }
      if (emp.start_date || emp.end_date) {
        writeText(`   Period: ${safeDate(emp.start_date)} to ${safeDate(emp.end_date)}`, { x: margin + 15 });
      }
      if (emp.position_held) {
        writeText(`   Position: ${emp.position_held}`, { x: margin + 15 });
      }
      if (emp.reason_for_leaving) {
        writeText(`   Reason for Leaving: ${emp.reason_for_leaving}`, { x: margin + 15 });
      }
      if (emp.was_subject_to_fmcsr != null) {
        writeText(`   Subject to FMCSRs: ${emp.was_subject_to_fmcsr ? 'Yes' : 'No'}`, { x: margin + 15 });
      }
      if (emp.was_safety_sensitive_function != null) {
        writeText(`   Safety-Sensitive Function: ${emp.was_safety_sensitive_function ? 'Yes' : 'No'}`, { x: margin + 15 });
      }
      yPos -= lineHeight * 0.5;
    });
  }

  if (summaryEmployers.length > 0) {
    writeSectionSeparator();
    writeHeading('CMV Employment History (Additional 7 Years)');
    summaryEmployers.forEach((emp, idx) => {
      writeText(`${idx + 1}. ${emp.employer_name || 'N/A'}`, { bold: true, size: 10 });
      if (emp.city || emp.state) {
        writeText(`   Location: ${[emp.city, emp.state].filter(Boolean).join(', ')}`, { x: margin + 15 });
      }
      if (emp.start_date || emp.end_date) {
        writeText(`   Period: ${safeDate(emp.start_date)} to ${safeDate(emp.end_date)}`, { x: margin + 15 });
      }
      if (emp.position_held) {
        writeText(`   Position: ${emp.position_held}`, { x: margin + 15 });
      }
      yPos -= lineHeight * 0.5;
    });
  }

  // --- Disqualification History ---
  const disqualifications = application.disqualifications || [];
  writeSectionSeparator();
  writeHeading('Disqualification History');
  writeText(
    'Have you ever been denied a license, had one suspended/revoked, or been disqualified?',
    { size: 10 }
  );
  const disqAnswer = application.has_been_disqualified != null
    ? (application.has_been_disqualified ? 'Yes' : 'No')
    : 'Not answered';
  writeText(`Answer: ${disqAnswer}`, { bold: true, size: 10 });
  yPos -= lineHeight * 0.5;

  if (application.has_been_disqualified && disqualifications.length > 0) {
    // Table header
    writeText('Type                State    Date          Reason', { bold: true, size: 8 });
    writeText('--------------------------------------------------------------------', { size: 8 });
    disqualifications.forEach((d) => {
      const line = [
        (d.type || '').padEnd(20),
        (d.state || '').padEnd(9),
        safeDate(d.date).padEnd(14),
        d.reason || ''
      ].join('');
      writeText(line, { size: 8 });
      if (d.reinstated) {
        writeText(`   Reinstated: ${safeDate(d.reinstatement_date) || 'Yes'}`, { size: 8, x: margin + 15 });
      }
    });
  }

  // --- Applicant Certification & Signature (FN-233) ---
  writeSectionSeparator();
  writeHeading('Applicant Certification & Signature');
  if (application.certification_text_version) {
    writeText(`Certification Text Version: ${application.certification_text_version}`, { size: 9 });
  }
  writeText(
    'I certify that the information provided in this application is true and complete to the best',
    { size: 9 }
  );
  writeText(
    'of my knowledge. I understand that any misrepresentation or omission may be cause for denial',
    { size: 9 }
  );
  writeText(
    'of employment or dismissal if employed.',
    { size: 9 }
  );
  yPos -= lineHeight;

  // FN-233: Captured applicant identity fields
  const certFullName = [
    application.firstName || driver?.first_name || '',
    application.middleName || '',
    application.lastName || driver?.last_name || ''
  ].filter(Boolean).join(' ');
  writeText(`Full Name: ${certFullName}`, { size: 9 });
  writeText(`Date of Birth: ${safeDate(application.dateOfBirth)}`, { size: 9 });
  writeText(`SSN: ${maskSSN(application.ssn || application.ssnLast4)}`, { size: 9 });
  writeText(`Driver's License Number: ${application.licenseNumber || driver?.cdl_number || 'N/A'}`, { size: 9 });
  writeText(`State of Issue: ${application.licenseState || driver?.cdl_state || 'N/A'}`, { size: 9 });
  yPos -= lineHeight * 0.5;

  // Signature image placeholder — if a base64 signature is provided, embed it
  if (application.applicantSignature && application.applicantSignature.startsWith('data:image/png')) {
    try {
      const base64Data = application.applicantSignature.split(',')[1];
      const sigBytes = Buffer.from(base64Data, 'base64');
      const sigImage = await pdfDoc.embedPng(sigBytes);
      const sigDims = sigImage.scale(0.5);
      const p = ensurePage();
      p.drawImage(sigImage, {
        x: margin,
        y: yPos - sigDims.height,
        width: Math.min(sigDims.width, 200),
        height: Math.min(sigDims.height, 50)
      });
      yPos -= Math.min(sigDims.height, 50) + lineHeight;
    } catch (_sigErr) {
      // Fall back to text signature if image embedding fails
      writeText(`Signature: ${sigName}`, { bold: true, size: 10 });
    }
  } else {
    writeText(`Signature: ${sigName}`, { bold: true, size: 10 });
  }

  const certDate = safeDate(application.signed_certification_at || signature?.signedAt || application.applicationSignatureDate);
  writeText(`Date Signed: ${certDate}`, { size: 10 });
  writeText('This application was signed electronically. The signer consents to the use', { size: 7, color: rgb(0.4, 0.4, 0.4) });
  writeText('of electronic signatures in accordance with applicable law.', { size: 7, color: rgb(0.4, 0.4, 0.4) });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

async function buildMvrAuthorizationPdf({ driver, mvr, signature }) {
  const pdfDoc = await loadTemplate(mvrTemplatePath);
  const pages = pdfDoc.getPages();
  const page = pages[0];
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const fullName = [
    mvr.firstName || driver?.first_name || '',
    mvr.middleName || '',
    mvr.lastName || driver?.last_name || ''
  ]
    .filter(Boolean)
    .join(' ');

  // Applicant block
  await drawText(page, fullName, 140, 640);
  await drawText(page, mvr.akaNames || '', 140, 624);
  await drawText(page, safeDate(mvr.dateOfBirth), 430, 624);

  // License info
  const licenseLine = `${mvr.driverLicenseState || driver?.cdl_state || ''} ${mvr.driverLicenseNumber ||
    driver?.cdl_number ||
    ''}`;
  await drawText(page, licenseLine, 180, 596);
  await drawText(page, mvr.emailForReportCopy || '', 180, 580);

  // Disclosure checkbox / text
  const consentText = mvr.acknowledgesRights ? 'YES' : 'NO';
  await drawText(page, consentText, 90, 540);

  // Signature
  const sigName = signature?.signerName || mvr.mvrSignatureName || '';
  const sigDate = safeDate(signature?.signedAt || mvr.mvrSignatureDate);
  await drawText(page, sigName, 160, 220);
  await drawText(page, sigDate, 430, 220);

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

async function buildReleaseOfInformationPdf({ driver, employers }) {
  // Create a new PDF document
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // Letter size
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const fullName = [
    driver?.first_name || '',
    driver?.last_name || ''
  ]
    .filter(Boolean)
    .join(' ');

  let yPos = 750;
  const margin = 50;
  const lineHeight = 14;
  const pageWidth = 612;
  const textWidth = pageWidth - 2 * margin;

  // Title
  page.drawText('AUTHORIZATION FOR RELEASE OF INFORMATION', {
    x: margin,
    y: yPos,
    size: 14,
    font: boldFont,
    color: rgb(0, 0, 0)
  });
  yPos -= lineHeight * 2;

  // Driver info section
  page.drawText('SECTION I – EMPLOYEE INFORMATION', {
    x: margin,
    y: yPos,
    size: 11,
    font: boldFont,
    color: rgb(0, 0, 0)
  });
  yPos -= lineHeight * 1.5;

  page.drawText(`Full Name: ${fullName}`, {
    x: margin,
    y: yPos,
    size: 10,
    font
  });
  yPos -= lineHeight;

  if (driver?.email) {
    page.drawText(`Email: ${driver.email}`, {
      x: margin,
      y: yPos,
      size: 10,
      font
    });
    yPos -= lineHeight;
  }

  if (driver?.phone) {
    page.drawText(`Phone: ${driver.phone}`, {
      x: margin,
      y: yPos,
      size: 10,
      font
    });
    yPos -= lineHeight;
  }

  page.drawText(`Date of Signature: ${new Date().toISOString().slice(0, 10)}`, {
    x: margin,
    y: yPos,
    size: 10,
    font
  });
  yPos -= lineHeight * 2;

  // Employers section
  if (employers && Array.isArray(employers) && employers.length > 0) {
    page.drawText('SECTION II – PREVIOUS EMPLOYERS', {
      x: margin,
      y: yPos,
      size: 11,
      font: boldFont,
      color: rgb(0, 0, 0)
    });
    yPos -= lineHeight * 1.5;

    employers.forEach((emp, idx) => {
      const empNum = idx + 1;
      page.drawText(`Employer ${empNum}:`, {
        x: margin,
        y: yPos,
        size: 10,
        font: boldFont
      });
      yPos -= lineHeight;

      if (emp.employer_name) {
        page.drawText(`Name: ${emp.employer_name}`, {
          x: margin + 20,
          y: yPos,
          size: 9,
          font
        });
        yPos -= lineHeight;
      }

      if (emp.contact_name || emp.contact_phone) {
        const contactLine = [emp.contact_name, emp.contact_phone].filter(Boolean).join(' | ');
        page.drawText(`Contact: ${contactLine}`, {
          x: margin + 20,
          y: yPos,
          size: 9,
          font
        });
        yPos -= lineHeight;
      }

      if (emp.start_date || emp.end_date) {
        const dateRange = [safeDate(emp.start_date), safeDate(emp.end_date)].filter(Boolean).join(' to ');
        page.drawText(`Period: ${dateRange}`, {
          x: margin + 20,
          y: yPos,
          size: 9,
          font
        });
        yPos -= lineHeight;
      }

      if (emp.reason_for_leaving) {
        page.drawText(`Reason for Leaving: ${emp.reason_for_leaving}`, {
          x: margin + 20,
          y: yPos,
          size: 9,
          font
        });
        yPos -= lineHeight;
      }

      yPos -= lineHeight * 0.5; // spacing between employers
    });

    yPos -= lineHeight;
  }

  // Authorization text
  const authText = [
    'I authorize the above-named employer(s) to release information about my',
    'employment, including dates of employment, position, salary, and reason for',
    'termination, to the requesting company or its authorized representatives.'
  ];

  authText.forEach((line) => {
    page.drawText(line, {
      x: margin,
      y: yPos,
      size: 9,
      font,
      maxWidth: textWidth
    });
    yPos -= lineHeight;
  });

  yPos -= lineHeight * 1.5;

  // Signature line
  page.drawText('Employee Signature: _________________________________', {
    x: margin,
    y: yPos,
    size: 10,
    font
  });
  yPos -= lineHeight * 1.5;

  page.drawText('Date: _________________________________', {
    x: margin,
    y: yPos,
    size: 10,
    font
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Strip HTML tags and convert to plain-text lines suitable for PDF rendering.
 * Handles <li> as bullet points, <br/> as newlines, and collapses whitespace.
 */
function htmlToPlainLines(html) {
  if (!html) return [];
  let text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li>/gi, '  \u2022 ')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<h[1-6][^>]*>/gi, '')
    .replace(/<ol>/gi, '')
    .replace(/<\/ol>/gi, '\n')
    .replace(/<ul>/gi, '')
    .replace(/<\/ul>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\u00A7/g, '\u00A7'); // keep section symbol

  // Collapse multiple blank lines
  const lines = text.split('\n');
  const result = [];
  let prevBlank = false;
  for (const line of lines) {
    const trimmed = line.replace(/\s+/g, ' ').trim();
    if (trimmed === '') {
      if (!prevBlank) result.push('');
      prevBlank = true;
    } else {
      result.push(trimmed);
      prevBlank = false;
    }
  }
  return result;
}

/**
 * Word-wrap a single line of text to fit within maxWidth pixels.
 * Returns an array of lines.
 */
function wrapText(text, font, fontSize, maxWidth) {
  if (!text) return [''];
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const width = font.widthOfTextAtSize(testLine, fontSize);
    if (width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

/**
 * Generate a PDF for a signed consent form.
 *
 * @param {object} params
 * @param {object} params.template - consent template (title, body_text, cfr_reference)
 * @param {object} params.consent  - signed consent record (id, signer_name, signed_at, ip_address, capture_data)
 * @param {object} params.company  - { name, address }
 * @param {object} params.driver   - { first_name, last_name }
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generateConsentPdf({ template, consent, company, driver }) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 50;
  const textWidth = pageWidth - 2 * margin;
  const lineHeight = 13;
  const bottomMargin = 60;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let yPos = pageHeight - margin;

  function ensureSpace(needed) {
    if (yPos - needed < bottomMargin) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      yPos = pageHeight - margin;
    }
  }

  function drawTextLine(text, opts = {}) {
    const size = opts.size || 9;
    const f = opts.bold ? boldFont : font;
    const x = opts.x || margin;

    const wrapped = wrapText(text || '', f, size, opts.maxWidth || textWidth);
    for (const line of wrapped) {
      ensureSpace(lineHeight);
      page.drawText(line, {
        x,
        y: yPos,
        size,
        font: f,
        color: opts.color || rgb(0, 0, 0)
      });
      yPos -= lineHeight;
    }
  }

  // ── Header: Company info ──────────────────────────────────────────────
  const companyName = company?.name || 'Company Name';
  const companyAddress = company?.address || '';

  drawTextLine(companyName, { size: 12, bold: true });
  if (companyAddress) {
    drawTextLine(companyAddress, { size: 9 });
  }
  yPos -= lineHeight;

  // ── Title ─────────────────────────────────────────────────────────────
  drawTextLine(template.title || 'Consent Form', { size: 14, bold: true });
  yPos -= lineHeight * 0.5;

  if (template.cfr_reference) {
    drawTextLine(`Reference: ${template.cfr_reference}`, { size: 8, color: rgb(0.4, 0.4, 0.4) });
  }
  yPos -= lineHeight;

  // ── Body text ─────────────────────────────────────────────────────────
  const driverFullName = driver
    ? `${driver.first_name || ''} ${driver.last_name || ''}`.trim()
    : '';

  let bodyText = template.body_text || '';
  bodyText = bodyText.replace(/\{\{companyName\}\}/g, companyName);
  bodyText = bodyText.replace(/\{\{companyAddress\}\}/g, companyAddress);
  bodyText = bodyText.replace(/\{\{driverFullName\}\}/g, driverFullName);

  const plainLines = htmlToPlainLines(bodyText);
  for (const line of plainLines) {
    if (line === '') {
      yPos -= lineHeight * 0.5;
    } else {
      drawTextLine(line, { size: 9 });
    }
  }

  yPos -= lineHeight;

  // ── Captured fields section ───────────────────────────────────────────
  const captureData = consent.capture_data || {};
  const captureKeys = Object.keys(captureData);
  if (captureKeys.length > 0) {
    ensureSpace(lineHeight * (captureKeys.length + 3));
    drawTextLine('CAPTURED INFORMATION', { size: 10, bold: true });
    yPos -= lineHeight * 0.3;

    const fieldLabels = {
      fullName: 'Full Name',
      dateOfBirth: 'Date of Birth',
      ssnLast4: 'SSN (Last 4)',
      driversLicenseNumber: "Driver's License Number",
      stateOfIssue: 'State of Issue'
    };

    for (const key of captureKeys) {
      const label = fieldLabels[key] || key;
      drawTextLine(`${label}: ${captureData[key] || ''}`, { size: 9 });
    }
    yPos -= lineHeight;
  }

  // ── Signature section ─────────────────────────────────────────────────
  ensureSpace(lineHeight * 6);
  page.drawLine({
    start: { x: margin, y: yPos },
    end: { x: pageWidth - margin, y: yPos },
    thickness: 0.5
  });
  yPos -= lineHeight;

  drawTextLine('SIGNATURE', { size: 10, bold: true });
  yPos -= lineHeight * 0.3;

  drawTextLine(`Signed by: ${consent.signer_name || ''}`, { size: 9 });
  const signedDate = consent.signed_at
    ? new Date(consent.signed_at).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
    : new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  drawTextLine(`Date: ${signedDate}`, { size: 9 });
  drawTextLine('Electronic signature acknowledged', { size: 9 });
  yPos -= lineHeight;

  // ── FN-234: Audit Trail Footer ──────────────────────────────────────
  ensureSpace(lineHeight * 7);
  page.drawLine({
    start: { x: margin, y: yPos },
    end: { x: pageWidth - margin, y: yPos },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7)
  });
  yPos -= lineHeight;

  drawTextLine('AUDIT TRAIL', { size: 9, bold: true, color: rgb(0.3, 0.3, 0.3) });
  drawTextLine('Document signed electronically', { size: 7, color: rgb(0.5, 0.5, 0.5) });
  const auditSignedAt = consent.signed_at
    ? new Date(consent.signed_at).toISOString()
    : new Date().toISOString();
  drawTextLine(`Date/Time: ${auditSignedAt}`, { size: 7, color: rgb(0.5, 0.5, 0.5) });
  drawTextLine(`IP Address: ${consent.ip_address || 'N/A'}`, { size: 7, color: rgb(0.5, 0.5, 0.5) });
  const auditUa = (consent.user_agent || 'N/A').slice(0, 80);
  drawTextLine(`User Agent: ${auditUa}`, { size: 7, color: rgb(0.5, 0.5, 0.5) });
  drawTextLine(`Document ID: ${consent.id || 'N/A'}`, { size: 7, color: rgb(0.5, 0.5, 0.5) });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

module.exports = {
  buildEmploymentApplicationPdf,
  buildMvrAuthorizationPdf,
  buildReleaseOfInformationPdf,
  generateConsentPdf
};

