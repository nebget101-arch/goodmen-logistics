const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');

function safeDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString().slice(0, 10);
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
  await drawText(page, application.ssnLast4 || '', 420, 664);
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

module.exports = {
  buildEmploymentApplicationPdf,
  buildMvrAuthorizationPdf
};

