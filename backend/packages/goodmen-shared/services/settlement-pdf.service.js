const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { ensureSettlementAiInsights } = require('./settlement-ai-insights.service');

function asNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function fmtMoney(value) {
  return asNumber(value).toFixed(2);
}

function fmtDate(value) {
  if (!value) return '—';
  const text = String(value);
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return text;
  return d.toISOString().slice(0, 10);
}

function safeText(value, fallback = '—') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function safeToken(value, fallback = 'UNKNOWN') {
  const raw = (value || '').toString().trim();
  if (!raw) return fallback;
  return raw
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase() || fallback;
}

function getDriverName(driver) {
  return [driver?.first_name, driver?.last_name].filter(Boolean).join(' ').trim() || 'Driver';
}

function getSettlementTypeLabel(settlementType) {
  return settlementType === 'equipment_owner' ? 'Equipment Owner Settlement' : 'Driver Settlement';
}

function getSettlementTypeBadge(settlementType) {
  return settlementType === 'equipment_owner' ? 'EQUIPMENT OWNER' : 'DRIVER';
}

function getPeriodLabel(period, settlement) {
  return `${fmtDate(period?.period_start || settlement?.period_start)} -> ${fmtDate(period?.period_end || settlement?.period_end || settlement?.date)}`;
}

function getSettlementDisplayNumber(payload) {
  const driverName = getDriverName(payload?.driver);
  const start = fmtDate(payload?.period?.period_start || payload?.settlement?.period_start);
  const end = fmtDate(payload?.period?.period_end || payload?.settlement?.period_end || payload?.settlement?.date);
  return `STL-${safeToken(driverName, 'DRIVER')}-${safeToken(`${start}_TO_${end}`, 'NO_PERIOD')}`;
}

function getSettlementPdfFileName(payload) {
  const base = payload?.settlement?.settlement_number || getSettlementDisplayNumber(payload);
  return `${safeToken(base, 'SETTLEMENT')}.pdf`;
}

function getCompanyName(payload) {
  return safeText(
    payload?.operatingEntity?.name ||
      payload?.operatingEntity?.legal_name ||
      payload?.tenant?.legal_name ||
      payload?.tenant?.name ||
      'FleetNeuron'
  );
}

function getCompanyLine(payload) {
  const entity = payload?.operatingEntity || {};
  const parts = [
    entity.address_line1,
    entity.address_line2,
    [entity.city, entity.state].filter(Boolean).join(', '),
    entity.zip_code || entity.postal_code,
    entity.phone,
    entity.email
  ]
    .map((value) => (value || '').toString().trim())
    .filter(Boolean);
  if (parts.length) return parts.join('  |  ');
  const dot = entity.dot_number ? `DOT ${entity.dot_number}` : null;
  const mc = entity.mc_number ? `MC ${entity.mc_number}` : null;
  return [dot, mc].filter(Boolean).join('  | ') || 'AI Fleet Intelligence';
}

function getPayableTo(payload) {
  if (payload?.settlement?.settlement_type === 'equipment_owner') {
    return safeText(payload?.equipmentOwner?.name || payload?.primaryPayee?.name);
  }
  return safeText(payload?.primaryPayee?.name || getDriverName(payload?.driver));
}

function getHighlightedPayLabel(payload) {
  return payload?.settlement?.settlement_type === 'equipment_owner' ? 'Equipment Owner Pay' : 'Driver Pay';
}

function getHighlightedPayAmount(payload) {
  return payload?.settlement?.settlement_type === 'equipment_owner'
    ? asNumber(payload?.settlement?.subtotal_additional_payee)
    : asNumber(payload?.settlement?.subtotal_driver_pay);
}

function getNetPayAmount(payload) {
  return payload?.settlement?.settlement_type === 'equipment_owner'
    ? asNumber(payload?.settlement?.net_pay_additional_payee)
    : asNumber(payload?.settlement?.net_pay_driver);
}

function buildSummaryRows(payload) {
  const settlement = payload?.settlement || {};
  const truckLabel = payload?.truck?.unit_number
    ? `Unit ${payload.truck.unit_number}${payload?.truck?.plate_number ? ` • ${payload.truck.plate_number}` : ''}`
    : safeText(payload?.truck?.plate_number, '—');

  return [
    ['Settlement Type', getSettlementTypeLabel(settlement.settlement_type)],
    ['Settlement #', safeText(settlement.settlement_number || getSettlementDisplayNumber(payload))],
    ['Settlement Date', fmtDate(settlement.date)],
    ['Payroll Period', getPeriodLabel(payload?.period, settlement)],
    ['Payable To', getPayableTo(payload)],
    ['Driver', getDriverName(payload?.driver)],
    ['Equipment Owner', safeText(payload?.equipmentOwner?.name)],
    ['Truck', truckLabel],
    ['Status', safeText(settlement.settlement_status)],
    ['Operating Entity', safeText(payload?.operatingEntity?.name || payload?.operatingEntity?.legal_name)]
  ];
}

function buildTotalRows(payload) {
  const settlement = payload?.settlement || {};
  return [
    ['Gross Revenue Reference', asNumber(settlement.subtotal_gross)],
    [getHighlightedPayLabel(payload), getHighlightedPayAmount(payload)],
    ['Total Deductions', asNumber(settlement.total_deductions)],
    ['Total Advances', asNumber(settlement.total_advances)],
    ['Carried Balance', asNumber(settlement.carried_balance)],
    ['Net Pay', getNetPayAmount(payload)]
  ];
}

function getLoadPayAmount(item, settlementType) {
  return settlementType === 'equipment_owner'
    ? asNumber(item?.additional_payee_amount)
    : asNumber(item?.driver_pay_amount);
}

function classifyAdjustment(item) {
  const sourceType = (item?.source_type || 'manual').toString();
  if (sourceType === 'scheduled_rule') return 'Scheduled Deductions';
  if (sourceType === 'manual') return 'Manual Adjustments';
  if (sourceType === 'imported_fuel') return 'Fuel Variable Deductions';
  if (sourceType === 'imported_toll') return 'Toll Variable Deductions';
  if (sourceType === 'carried_balance') return 'Carried Balance';
  return 'Other Deductions';
}

function buildAdjustmentGroups(adjustmentItems) {
  const groups = new Map();
  for (const item of adjustmentItems || []) {
    if (item?.source_type === 'scheduled_rule_removed') continue;
    const groupName = classifyAdjustment(item);
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName).push(item);
  }
  return Array.from(groups.entries()).map(([title, items]) => ({
    title,
    total: items.reduce((sum, item) => sum + asNumber(item?.amount), 0),
    items
  }));
}

const COLORS = {
  bg: rgb(10 / 255, 16 / 255, 30 / 255),
  panel: rgb(17 / 255, 24 / 255, 39 / 255),
  panelAlt: rgb(15 / 255, 23 / 255, 42 / 255),
  border: rgb(51 / 255, 65 / 255, 85 / 255),
  accent: rgb(45 / 255, 212 / 255, 191 / 255),
  accentSoft: rgb(22 / 255, 78 / 255, 99 / 255),
  text: rgb(241 / 255, 245 / 255, 249 / 255),
  muted: rgb(148 / 255, 163 / 255, 184 / 255),
  white: rgb(1, 1, 1),
  badgeDriver: rgb(30 / 255, 64 / 255, 175 / 255),
  badgeOwner: rgb(5 / 255, 150 / 255, 105 / 255),
  positive: rgb(34 / 255, 197 / 255, 94 / 255),
  warning: rgb(251 / 255, 191 / 255, 36 / 255)
};

const LAYOUT = {
  width: 612,
  height: 792,
  marginLeft: 36,
  marginRight: 36,
  marginTop: 34,
  marginBottom: 34,
  contentWidth: 540
};

function wrapText(text, maxChars = 80) {
  const raw = safeText(text, '');
  if (!raw) return [''];
  const words = raw.split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawTextBlock(page, font, text, x, y, options = {}) {
  const size = options.size || 10;
  const color = options.color || COLORS.text;
  const lineHeight = options.lineHeight || size + 2;
  const maxChars = options.maxChars || 80;
  const lines = wrapText(text, maxChars);
  let currentY = y;
  for (const line of lines) {
    page.drawText(line, { x, y: currentY, size, font, color });
    currentY -= lineHeight;
  }
  return currentY;
}

function drawPageChrome(page, fonts, payload, pageNumber, totalPages) {
  const { regular, bold } = fonts;
  page.drawRectangle({ x: 0, y: 0, width: LAYOUT.width, height: LAYOUT.height, color: COLORS.bg });
  page.drawRectangle({
    x: LAYOUT.marginLeft,
    y: LAYOUT.height - 112,
    width: LAYOUT.contentWidth,
    height: 78,
    color: COLORS.panel,
    borderColor: COLORS.border,
    borderWidth: 1
  });
  page.drawRectangle({
    x: LAYOUT.marginLeft,
    y: LAYOUT.height - 117,
    width: LAYOUT.contentWidth,
    height: 3,
    color: COLORS.accent
  });

  page.drawText('FleetNeuron', {
    x: LAYOUT.marginLeft + 16,
    y: LAYOUT.height - 65,
    size: 24,
    font: bold,
    color: COLORS.white
  });
  page.drawText('AI FLEET INTELLIGENCE', {
    x: LAYOUT.marginLeft + 16,
    y: LAYOUT.height - 83,
    size: 8,
    font: bold,
    color: COLORS.accent
  });

  const companyName = getCompanyName(payload);
  const companyLine = getCompanyLine(payload);
  drawTextBlock(page, regular, companyName, LAYOUT.marginLeft + 200, LAYOUT.height - 63, {
    size: 10,
    maxChars: 40,
    color: COLORS.text,
    lineHeight: 12
  });
  drawTextBlock(page, regular, companyLine, LAYOUT.marginLeft + 200, LAYOUT.height - 78, {
    size: 8,
    maxChars: 55,
    color: COLORS.muted,
    lineHeight: 10
  });

  const badgeColor = payload?.settlement?.settlement_type === 'equipment_owner' ? COLORS.badgeOwner : COLORS.badgeDriver;
  const badgeText = getSettlementTypeBadge(payload?.settlement?.settlement_type);
  const badgeWidth = Math.max(96, badgeText.length * 6.4 + 24);
  const badgeX = LAYOUT.width - LAYOUT.marginRight - badgeWidth - 16;
  const badgeY = LAYOUT.height - 79;
  page.drawRectangle({
    x: badgeX,
    y: badgeY,
    width: badgeWidth,
    height: 22,
    color: badgeColor
  });
  page.drawText(badgeText, {
    x: badgeX + 12,
    y: badgeY + 7,
    size: 8,
    font: bold,
    color: COLORS.white
  });

  page.drawLine({
    start: { x: LAYOUT.marginLeft, y: 42 },
    end: { x: LAYOUT.width - LAYOUT.marginRight, y: 42 },
    thickness: 0.7,
    color: COLORS.border
  });
  page.drawText('PROTECTED BY FLEETNEURON AI ANOMALY DETECTION', {
    x: LAYOUT.marginLeft,
    y: 28,
    size: 7,
    font: bold,
    color: COLORS.accent
  });
  page.drawText(`Generated ${new Date().toISOString().slice(0, 19).replace('T', ' UTC ')}`, {
    x: LAYOUT.marginLeft,
    y: 16,
    size: 7,
    font: regular,
    color: COLORS.muted
  });
  const pageLabel = `Page ${pageNumber} of ${totalPages}`;
  const pageLabelWidth = regular.widthOfTextAtSize(pageLabel, 7);
  page.drawText(pageLabel, {
    x: LAYOUT.width - LAYOUT.marginRight - pageLabelWidth,
    y: 16,
    size: 7,
    font: regular,
    color: COLORS.muted
  });
}

function drawSectionTitle(page, fonts, title, y) {
  page.drawText(title, {
    x: LAYOUT.marginLeft,
    y,
    size: 12,
    font: fonts.bold,
    color: COLORS.accent
  });
  page.drawLine({
    start: { x: LAYOUT.marginLeft, y: y - 4 },
    end: { x: LAYOUT.width - LAYOUT.marginRight, y: y - 4 },
    thickness: 0.7,
    color: COLORS.accentSoft
  });
  return y - 18;
}

function drawInfoGrid(page, fonts, rows, y, options = {}) {
  const leftX = LAYOUT.marginLeft;
  const rightX = LAYOUT.marginLeft + 270;
  const labelColor = options.labelColor || COLORS.muted;
  const valueColor = options.valueColor || COLORS.text;
  let currentY = y;
  for (let i = 0; i < rows.length; i += 2) {
    const left = rows[i];
    const right = rows[i + 1];
    page.drawText(left[0].toUpperCase(), { x: leftX, y: currentY, size: 7, font: fonts.bold, color: labelColor });
    page.drawText(safeText(left[1]), { x: leftX, y: currentY - 12, size: 10, font: fonts.regular, color: valueColor });
    if (right) {
      page.drawText(right[0].toUpperCase(), { x: rightX, y: currentY, size: 7, font: fonts.bold, color: labelColor });
      page.drawText(safeText(right[1]), { x: rightX, y: currentY - 12, size: 10, font: fonts.regular, color: valueColor });
    }
    currentY -= 30;
  }
  return currentY;
}

function drawTotalsPanel(page, fonts, rows, y) {
  const panelY = y - 118;
  page.drawRectangle({
    x: LAYOUT.marginLeft,
    y: panelY,
    width: LAYOUT.contentWidth,
    height: 128,
    color: COLORS.panelAlt,
    borderColor: COLORS.border,
    borderWidth: 1
  });
  page.drawText('Settlement Summary', {
    x: LAYOUT.marginLeft + 14,
    y: y - 16,
    size: 12,
    font: fonts.bold,
    color: COLORS.white
  });

  let currentY = y - 40;
  for (const [label, amount] of rows) {
    page.drawText(label, {
      x: LAYOUT.marginLeft + 14,
      y: currentY,
      size: 9,
      font: fonts.regular,
      color: COLORS.muted
    });
    const formatted = `$${fmtMoney(amount)}`;
    const width = fonts.bold.widthOfTextAtSize(formatted, label === 'Net Pay' ? 13 : 10);
    page.drawText(formatted, {
      x: LAYOUT.width - LAYOUT.marginRight - 14 - width,
      y: currentY,
      size: label === 'Net Pay' ? 13 : 10,
      font: fonts.bold,
      color: label === 'Net Pay' ? COLORS.positive : COLORS.white
    });
    currentY -= 16;
  }
  return panelY - 18;
}

function drawLoadTable(page, fonts, payload, y) {
  const settlementType = payload?.settlement?.settlement_type;
  const items = payload?.loadItems || [];
  page.drawRectangle({
    x: LAYOUT.marginLeft,
    y: y - 20,
    width: LAYOUT.contentWidth,
    height: 18,
    color: COLORS.accentSoft
  });
  const columns = [
    { label: 'Load', x: LAYOUT.marginLeft + 10 },
    { label: 'Dates', x: LAYOUT.marginLeft + 92 },
    { label: 'Gross', x: LAYOUT.marginLeft + 255 },
    { label: 'Highlighted Pay', x: LAYOUT.marginLeft + 334 },
    { label: 'Basis', x: LAYOUT.marginLeft + 456 }
  ];
  for (const column of columns) {
    page.drawText(column.label, { x: column.x, y: y - 14, size: 8, font: fonts.bold, color: COLORS.white });
  }
  let currentY = y - 38;
  if (!items.length) {
    page.drawText('No load earnings were attached to this settlement.', {
      x: LAYOUT.marginLeft + 10,
      y: currentY,
      size: 10,
      font: fonts.regular,
      color: COLORS.muted
    });
    return currentY - 18;
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (index % 2 === 0) {
      page.drawRectangle({
        x: LAYOUT.marginLeft,
        y: currentY - 4,
        width: LAYOUT.contentWidth,
        height: 16,
        color: COLORS.panel
      });
    }
    page.drawText(safeText(item?.load_number || item?.load_id), {
      x: LAYOUT.marginLeft + 10,
      y: currentY,
      size: 8,
      font: fonts.regular,
      color: COLORS.text
    });
    page.drawText(`${fmtDate(item?.pickup_date)} -> ${fmtDate(item?.delivery_date)}`, {
      x: LAYOUT.marginLeft + 92,
      y: currentY,
      size: 8,
      font: fonts.regular,
      color: COLORS.text
    });
    page.drawText(`$${fmtMoney(item?.gross_amount)}`, {
      x: LAYOUT.marginLeft + 255,
      y: currentY,
      size: 8,
      font: fonts.regular,
      color: COLORS.text
    });
    page.drawText(`$${fmtMoney(getLoadPayAmount(item, settlementType))}`, {
      x: LAYOUT.marginLeft + 334,
      y: currentY,
      size: 8,
      font: fonts.bold,
      color: COLORS.white
    });
    page.drawText(safeText(item?.pay_basis_snapshot, 'gross'), {
      x: LAYOUT.marginLeft + 456,
      y: currentY,
      size: 8,
      font: fonts.regular,
      color: COLORS.text
    });
    currentY -= 16;
  }
  return currentY - 8;
}

function drawAdjustmentSection(page, fonts, title, group, y) {
  page.drawText(`${title}  •  Total $${fmtMoney(group.total)}`, {
    x: LAYOUT.marginLeft,
    y,
    size: 10,
    font: fonts.bold,
    color: COLORS.white
  });
  let currentY = y - 16;
  if (!group.items.length) {
    page.drawText('No items.', {
      x: LAYOUT.marginLeft + 8,
      y: currentY,
      size: 9,
      font: fonts.regular,
      color: COLORS.muted
    });
    return currentY - 14;
  }
  for (const item of group.items) {
    page.drawText(`• ${safeText(item.description || item.source_type || item.item_type)}`, {
      x: LAYOUT.marginLeft + 8,
      y: currentY,
      size: 9,
      font: fonts.regular,
      color: COLORS.text
    });
    const amount = `$${fmtMoney(item.amount)}`;
    const width = fonts.bold.widthOfTextAtSize(amount, 9);
    page.drawText(amount, {
      x: LAYOUT.width - LAYOUT.marginRight - width,
      y: currentY,
      size: 9,
      font: fonts.bold,
      color: COLORS.warning
    });
    currentY -= 14;
  }
  return currentY - 4;
}

function drawInsightsSection(page, fonts, insights, y) {
  page.drawRectangle({
    x: LAYOUT.marginLeft,
    y: y - 124,
    width: LAYOUT.contentWidth,
    height: 132,
    color: COLORS.panel,
    borderColor: COLORS.border,
    borderWidth: 1
  });
  page.drawText('FleetNeuron AI Insights', {
    x: LAYOUT.marginLeft + 14,
    y: y - 16,
    size: 11,
    font: fonts.bold,
    color: COLORS.accent
  });
  const summary = safeText(insights?.summary, 'Settlement insights are currently unavailable.');
  drawTextBlock(page, fonts.regular, summary, LAYOUT.marginLeft + 14, y - 32, {
    size: 8,
    maxChars: 104,
    lineHeight: 10,
    color: COLORS.text
  });

  let currentY = y - 66;
  const items = Array.isArray(insights?.insights) ? insights.insights.slice(0, 3) : [];
  if (!items.length) {
    page.drawText('• Placeholder insights are being used for this PDF render.', {
      x: LAYOUT.marginLeft + 14,
      y: currentY,
      size: 8,
      font: fonts.regular,
      color: COLORS.muted
    });
    return y - 140;
  }

  for (const item of items) {
    page.drawText(`• ${safeText(item?.title, 'Insight')}: ${safeText(item?.message, '')}`, {
      x: LAYOUT.marginLeft + 14,
      y: currentY,
      size: 8,
      font: fonts.regular,
      color: item?.category === 'risk' ? COLORS.warning : COLORS.text
    });
    currentY -= 16;
  }
  return y - 140;
}

async function buildSettlementPdf(payload) {
  const aiInsights = await ensureSettlementAiInsights(payload);
  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fonts = { regular, bold };

  const page1 = pdfDoc.addPage([LAYOUT.width, LAYOUT.height]);
  const page2 = pdfDoc.addPage([LAYOUT.width, LAYOUT.height]);
  drawPageChrome(page1, fonts, payload, 1, 2);
  drawPageChrome(page2, fonts, payload, 2, 2);

  let y = LAYOUT.height - 135;
  y = drawSectionTitle(page1, fonts, getSettlementTypeLabel(payload?.settlement?.settlement_type), y);
  y = drawInfoGrid(page1, fonts, buildSummaryRows(payload), y);
  y = drawTotalsPanel(page1, fonts, buildTotalRows(payload), y - 4);
  y = drawSectionTitle(page1, fonts, 'Load Earnings', y);
  drawLoadTable(page1, fonts, payload, y);

  let y2 = LAYOUT.height - 135;
  y2 = drawSectionTitle(page2, fonts, 'Deductions Breakdown', y2);
  const groups = buildAdjustmentGroups(payload?.adjustmentItems || []);
  if (!groups.length) {
    page2.drawText('No deductions or adjustments were applied to this settlement.', {
      x: LAYOUT.marginLeft,
      y: y2,
      size: 10,
      font: regular,
      color: COLORS.muted
    });
  } else {
    for (const group of groups) {
      y2 = drawAdjustmentSection(page2, fonts, group.title, group, y2);
    }
  }

  y2 = drawInsightsSection(page2, fonts, aiInsights, y2 - 8);

  page2.drawRectangle({
    x: LAYOUT.marginLeft,
    y: 40,
    width: LAYOUT.contentWidth,
    height: 92,
    color: COLORS.panel,
    borderColor: COLORS.border,
    borderWidth: 1
  });
  page2.drawText('FleetNeuron Report Metadata', {
    x: LAYOUT.marginLeft + 14,
    y: 114,
    size: 11,
    font: bold,
    color: COLORS.accent
  });
  page2.drawText(`Settlement reference: ${safeText(payload?.settlement?.settlement_number || getSettlementDisplayNumber(payload))}`, {
    x: LAYOUT.marginLeft + 14,
    y: 96,
    size: 9,
    font: regular,
    color: COLORS.text
  });
  page2.drawText(`Generated for ${getPayableTo(payload)} using FleetNeuron AI settlement reporting.`, {
    x: LAYOUT.marginLeft + 14,
    y: 80,
    size: 9,
    font: regular,
    color: COLORS.text
  });
  page2.drawText(`Insights source: ${safeText(aiInsights?.source, 'fallback')} • status: ${safeText(aiInsights?.status, 'placeholder')}`, {
    x: LAYOUT.marginLeft + 14,
    y: 64,
    size: 8,
    font: regular,
    color: COLORS.muted
  });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

module.exports = {
  buildSettlementPdf,
  getSettlementDisplayNumber,
  getSettlementPdfFileName
};
