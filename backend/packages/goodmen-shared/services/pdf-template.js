'use strict';

/**
 * FN-1167: branded PDF template for V2 reports.
 *
 * Renders 7 sections in this order (any empty section is omitted gracefully):
 *   1. Header (FleetNeuron wordmark + report title)
 *   2. Filters used
 *   3. AI narrative paragraph
 *   4. KPI cards
 *   5. Data table (truncated past MAX_TABLE_ROWS)
 *   6. Anomaly list
 *   7. Footer (generated timestamp)
 *
 * The renderer is sync and pipes to a writable stream supplied by the caller
 * (typically the Express response). It uses `pdfkit`, which is already a
 * goodmen-shared dependency.
 */

const PDFDocument = require('pdfkit');

const PAGE_MARGIN = 40;
const MAX_TABLE_ROWS = 200;
const COLORS = {
  brand: '#1F4ED8',
  text: '#1F2937',
  mute: '#6B7280',
  hairline: '#E5E7EB',
  cardBg: '#F3F4F6',
  warning: '#B45309',
  critical: '#B91C1C'
};

function humanizeKey(key) {
  return String(key || '')
    .replace(/[_-]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Math.abs(value) >= 1000) {
      return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
    }
    return String(Math.round(value * 100) / 100);
  }
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch (_err) { return String(value); }
  }
  return String(value);
}

function formatFilters(filters) {
  if (!filters || typeof filters !== 'object') return [];
  const skipKeys = new Set(['limit', 'offset']);
  return Object.entries(filters)
    .filter(([k, v]) => !skipKeys.has(k) && v !== null && v !== undefined && v !== '')
    .map(([k, v]) => ({ label: humanizeKey(k), value: formatValue(v) }));
}

function pickTableColumns(rows, max = 6) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const first = rows[0] && typeof rows[0] === 'object' ? rows[0] : {};
  return Object.keys(first).slice(0, max);
}

function drawDivider(doc) {
  const y = doc.y + 4;
  doc.save()
    .strokeColor(COLORS.hairline)
    .lineWidth(0.5)
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .stroke()
    .restore();
  doc.moveDown(0.6);
}

function sectionTitle(doc, label) {
  doc.fillColor(COLORS.brand).fontSize(11).font('Helvetica-Bold').text(label.toUpperCase());
  doc.moveDown(0.2);
  doc.fillColor(COLORS.text).font('Helvetica');
}

function renderHeader(doc, { reportKey, title, generatedAt }) {
  const top = doc.y;
  doc.save();
  doc.fillColor(COLORS.brand).fontSize(20).font('Helvetica-Bold').text('FleetNeuron', { continued: false });
  doc.fillColor(COLORS.mute).fontSize(9).font('Helvetica').text('Logistics Reporting', { continued: false });
  doc.restore();

  // Title block right-aligned would conflict with continued text, so place below:
  doc.moveDown(0.4);
  doc.fillColor(COLORS.text).fontSize(16).font('Helvetica-Bold').text(title);
  doc.fillColor(COLORS.mute).fontSize(9).font('Helvetica').text(`Report: ${reportKey} · Generated ${generatedAt}`);
  drawDivider(doc);
  doc.y = Math.max(doc.y, top); // ensure cursor advanced
}

function renderFilters(doc, filters) {
  const list = formatFilters(filters);
  if (!list.length) return;
  sectionTitle(doc, 'Filters');
  doc.fontSize(10);
  list.forEach(({ label, value }) => {
    doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
    doc.font('Helvetica').text(value);
  });
  doc.moveDown(0.5);
}

function renderNarrative(doc, narrative) {
  if (!narrative || !String(narrative).trim()) return;
  sectionTitle(doc, 'Summary');
  doc.fontSize(10).font('Helvetica').fillColor(COLORS.text).text(String(narrative).trim(), {
    align: 'left',
    paragraphGap: 4
  });
  doc.moveDown(0.5);
}

function renderKpiCards(doc, cards) {
  if (!Array.isArray(cards) || !cards.length) return;
  sectionTitle(doc, 'KPIs');

  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const perRow = Math.min(3, cards.length);
  const gap = 8;
  const cardW = (usableWidth - gap * (perRow - 1)) / perRow;
  const cardH = 56;
  let i = 0;
  while (i < cards.length) {
    const startY = doc.y;
    let rowMaxBottom = startY;
    for (let col = 0; col < perRow && i < cards.length; col++, i++) {
      const card = cards[i] || {};
      const x = doc.page.margins.left + col * (cardW + gap);
      doc.save()
        .roundedRect(x, startY, cardW, cardH, 6)
        .fillColor(COLORS.cardBg)
        .fill()
        .restore();
      doc.fillColor(COLORS.mute).fontSize(8).font('Helvetica')
        .text((card.label || card.key || '').toString().toUpperCase(), x + 8, startY + 8, { width: cardW - 16 });
      doc.fillColor(COLORS.text).fontSize(14).font('Helvetica-Bold')
        .text(formatValue(card.value), x + 8, startY + 22, { width: cardW - 16 });
      if (card.delta !== undefined && card.delta !== null) {
        doc.fillColor(COLORS.mute).fontSize(8).font('Helvetica')
          .text(`Δ ${formatValue(card.delta)}`, x + 8, startY + 42, { width: cardW - 16 });
      }
      rowMaxBottom = Math.max(rowMaxBottom, startY + cardH);
    }
    doc.x = doc.page.margins.left;
    doc.y = rowMaxBottom + 8;
  }
  doc.moveDown(0.2);
}

function renderTable(doc, rows) {
  if (!Array.isArray(rows) || !rows.length) {
    sectionTitle(doc, 'Data');
    doc.fontSize(10).fillColor(COLORS.mute).font('Helvetica').text('No data for the selected filters.');
    doc.moveDown(0.5);
    return;
  }
  sectionTitle(doc, 'Data');

  const columns = pickTableColumns(rows, 6);
  if (!columns.length) {
    doc.fontSize(10).fillColor(COLORS.mute).text('Data has no displayable columns.');
    return;
  }
  const sliced = rows.slice(0, MAX_TABLE_ROWS);

  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colW = usableWidth / columns.length;
  const rowH = 14;

  // Header row
  const headerY = doc.y;
  doc.save()
    .rect(doc.page.margins.left, headerY, usableWidth, rowH)
    .fillColor(COLORS.cardBg)
    .fill()
    .restore();
  doc.fillColor(COLORS.text).fontSize(8).font('Helvetica-Bold');
  columns.forEach((c, idx) => {
    doc.text(humanizeKey(c), doc.page.margins.left + idx * colW + 4, headerY + 3, {
      width: colW - 8,
      ellipsis: true,
      lineBreak: false
    });
  });
  doc.y = headerY + rowH;

  // Body rows
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.text);
  for (const row of sliced) {
    if (doc.y + rowH > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
    const y = doc.y;
    columns.forEach((c, idx) => {
      doc.text(formatValue(row?.[c]), doc.page.margins.left + idx * colW + 4, y + 2, {
        width: colW - 8,
        ellipsis: true,
        lineBreak: false
      });
    });
    doc.y = y + rowH;
    doc.save()
      .strokeColor(COLORS.hairline)
      .lineWidth(0.25)
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .stroke()
      .restore();
  }
  doc.x = doc.page.margins.left;

  if (rows.length > MAX_TABLE_ROWS) {
    doc.moveDown(0.4);
    doc.fontSize(8).fillColor(COLORS.mute)
      .text(`Showing first ${MAX_TABLE_ROWS} of ${rows.length} rows. Export CSV for the full dataset.`);
  }
  doc.moveDown(0.5);
}

function renderAnomalies(doc, anomalies) {
  if (!Array.isArray(anomalies) || !anomalies.length) return;
  sectionTitle(doc, 'Anomalies');
  doc.fontSize(10).font('Helvetica');
  anomalies.forEach((a) => {
    const sev = (a?.severity || 'info').toString().toLowerCase();
    const sevColor = sev === 'critical' ? COLORS.critical : sev === 'warning' ? COLORS.warning : COLORS.mute;
    doc.fillColor(sevColor).font('Helvetica-Bold').text(`[${sev.toUpperCase()}] `, { continued: true });
    doc.fillColor(COLORS.text).font('Helvetica');
    const metric = a?.metric ? `${a.metric}: ` : '';
    const value = a?.value !== undefined && a?.value !== null ? formatValue(a.value) : '';
    const delta = a?.deltaPct !== undefined && a?.deltaPct !== null ? ` (Δ ${formatValue(a.deltaPct)}%)` : '';
    const ctx = a?.context ? ` — ${a.context}` : '';
    doc.text(`${metric}${value}${delta}${ctx}`);
  });
  doc.moveDown(0.5);
}

function renderFooter(doc, { generatedAt }) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - doc.page.margins.bottom + 6;
    doc.fillColor(COLORS.mute).fontSize(8).font('Helvetica')
      .text(
        `FleetNeuron Logistics · ${generatedAt} · Page ${i - range.start + 1} of ${range.count}`,
        doc.page.margins.left,
        y,
        { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'center', lineBreak: false }
      );
  }
}

/**
 * Render a branded PDF and pipe it to `stream`.
 *
 * @param {object}   args
 * @param {string}   args.reportKey
 * @param {object}   args.payload    V2 builder payload: { data, cards?, summary?, meta? }.
 * @param {object}   args.filters    Active filter set used for the export.
 * @param {string|null} args.narrative
 * @param {Array}    args.anomalies
 * @param {NodeJS.WritableStream} args.stream
 * @returns {Promise<void>} Resolves when the PDF stream finishes.
 */
function renderBrandedPdf({ reportKey, payload, filters, narrative, anomalies, stream }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: PAGE_MARGIN,
      size: 'A4',
      bufferPages: true,
      info: {
        Title: `FleetNeuron Report — ${reportKey}`,
        Author: 'FleetNeuron Logistics',
        Creator: 'fleetneuron-reporting-service'
      }
    });

    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.on('error', reject);
    doc.pipe(stream);

    const generatedAt = new Date().toISOString();
    const title = `${humanizeKey(reportKey)} Report`;

    renderHeader(doc, { reportKey, title, generatedAt });
    renderFilters(doc, filters);
    renderNarrative(doc, narrative);
    renderKpiCards(doc, payload?.cards);
    renderTable(doc, payload?.data || []);
    renderAnomalies(doc, anomalies);
    renderFooter(doc, { generatedAt });

    doc.end();
  });
}

module.exports = {
  renderBrandedPdf,
  _internals: { humanizeKey, formatValue, formatFilters, pickTableColumns, MAX_TABLE_ROWS }
};
