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
    ? `Unit ${payload.truck.unit_number}${payload?.truck?.plate_number ? ` | ${payload.truck.plate_number}` : ''}`
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

function getLocationLabel(city, state, fallback = '') {
  const value = [city, state].filter(Boolean).join(', ');
  return safeText(value || fallback, '—');
}

function getLoadDetails(item) {
  const pickup = getLocationLabel(item?.pickup_city, item?.pickup_state, item?.pickup_location || '');
  const delivery = getLocationLabel(item?.delivery_city, item?.delivery_state, item?.delivery_location || '');
  return `${pickup} -> ${delivery}`;
}

function buildLoadRows(payload) {
  const settlementType = payload?.settlement?.settlement_type;
  return (payload?.loadItems || []).map((item) => ([
    safeText(item?.load_number || item?.load_id),
    `${fmtDate(item?.pickup_date)} -> ${fmtDate(item?.delivery_date)}`,
    getLoadDetails(item),
    item?.empty_miles === null || item?.empty_miles === undefined || item?.empty_miles === '' ? '—' : String(item.empty_miles),
    item?.loaded_miles === null || item?.loaded_miles === undefined || item?.loaded_miles === '' ? '—' : String(item.loaded_miles),
    `$${fmtMoney(item?.gross_amount)}`,
    `$${fmtMoney(getLoadPayAmount(item, settlementType))}`
  ]));
}

function buildFuelRows(adjustmentItems) {
  return (adjustmentItems || [])
    .filter((item) => item?.source_type === 'imported_fuel' && item?.fuel_transaction)
    .map((item) => {
      const fuel = item.fuel_transaction || {};
      const location = [
        fuel.location_name || fuel.vendor_name || '',
        [fuel.city, fuel.state].filter(Boolean).join(', ')
      ].filter(Boolean).join(' | ');

      return [
        fmtDate(fuel.transaction_date || item.occurrence_date),
        safeText(location, '—'),
        safeText(fuel.product_type, 'diesel'),
        fuel.gallons === null || fuel.gallons === undefined ? '—' : String(fuel.gallons),
        `$${fmtMoney(item.amount)}`
      ];
    });
}

function buildScheduledRows(adjustmentItems) {
  return (adjustmentItems || [])
    .filter((item) => item?.source_type === 'scheduled_rule')
    .map((item, index) => ([
      String(index + 1),
      safeText(item?.description || 'Scheduled deduction'),
      `$${fmtMoney(item?.amount)}`
    ]));
}

function buildOtherDeductionRows(adjustmentItems) {
  return (adjustmentItems || [])
    .filter((item) => !['scheduled_rule', 'scheduled_rule_removed', 'imported_fuel'].includes(item?.source_type))
    .map((item) => ([
      safeText(item?.description || item?.source_type || item?.item_type),
      safeText(item?.source_type || 'manual'),
      `$${fmtMoney(item?.amount)}`
    ]));
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
  contentWidth: 540,
  contentTop: 657,
  contentBottom: 58
};

function wrapTextToWidth(font, text, size, maxWidth) {
  const raw = safeText(text, '');
  if (!raw) return [''];

  const words = raw.split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
      continue;
    }

    if (current) {
      lines.push(current);
      current = '';
    }

    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      current = word;
      continue;
    }

    let segment = '';
    for (const ch of word) {
      const nextSegment = `${segment}${ch}`;
      if (font.widthOfTextAtSize(nextSegment, size) <= maxWidth || !segment) {
        segment = nextSegment;
      } else {
        lines.push(segment);
        segment = ch;
      }
    }
    current = segment;
  }

  if (current) lines.push(current);
  return lines;
}

function drawWrappedLines(page, font, lines, x, y, options = {}) {
  const size = options.size || 9;
  const lineHeight = options.lineHeight || size + 2;
  const color = options.color || COLORS.text;
  let currentY = y;

  for (const line of lines) {
    page.drawText(line, { x, y: currentY, size, font, color });
    currentY -= lineHeight;
  }

  return currentY;
}

function drawPageBase(page, fonts, payload) {
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
  page.drawText('www.fleetneuron.ai', {
    x: LAYOUT.width - LAYOUT.marginRight - 116,
    y: LAYOUT.height - 48,
    size: 8,
    font: bold,
    color: COLORS.accent
  });

  const companyName = getCompanyName(payload);
  const companyLine = getCompanyLine(payload);
  drawWrappedLines(
    page,
    regular,
    wrapTextToWidth(regular, companyName, 10, 150),
    LAYOUT.marginLeft + 200,
    LAYOUT.height - 63,
    { size: 10, lineHeight: 12, color: COLORS.text }
  );
  drawWrappedLines(
    page,
    regular,
    wrapTextToWidth(regular, companyLine, 8, 190),
    LAYOUT.marginLeft + 200,
    LAYOUT.height - 78,
    { size: 8, lineHeight: 10, color: COLORS.muted }
  );

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
}

function drawPageFooter(page, fonts, pageNumber, totalPages) {
  const { regular, bold } = fonts;
  page.drawLine({
    start: { x: LAYOUT.marginLeft, y: 42 },
    end: { x: LAYOUT.width - LAYOUT.marginRight, y: 42 },
    thickness: 0.7,
    color: COLORS.border
  });
  page.drawText('www.fleetneuron.ai', {
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

function createDocumentState(pdfDoc, fonts, payload) {
  return {
    pdfDoc,
    fonts,
    payload,
    pages: [],
    page: null,
    y: LAYOUT.contentTop
  };
}

function addPage(state) {
  const page = state.pdfDoc.addPage([LAYOUT.width, LAYOUT.height]);
  drawPageBase(page, state.fonts, state.payload);
  state.pages.push(page);
  state.page = page;
  state.y = LAYOUT.contentTop;
  return state;
}

function ensureSpace(state, heightNeeded) {
  if (!state.page) {
    addPage(state);
    return;
  }

  if (state.y - heightNeeded < LAYOUT.contentBottom) {
    addPage(state);
  }
}

function drawSectionTitle(state, title) {
  ensureSpace(state, 26);
  state.page.drawText(title, {
    x: LAYOUT.marginLeft,
    y: state.y,
    size: 12,
    font: state.fonts.bold,
    color: COLORS.accent
  });
  state.page.drawLine({
    start: { x: LAYOUT.marginLeft, y: state.y - 4 },
    end: { x: LAYOUT.width - LAYOUT.marginRight, y: state.y - 4 },
    thickness: 0.7,
    color: COLORS.accentSoft
  });
  state.y -= 20;
}

function drawInfoGrid(state, rows) {
  const leftX = LAYOUT.marginLeft;
  const rightX = LAYOUT.marginLeft + 270;
  const labelSize = 7;
  const valueSize = 9;
  const valueWidth = 220;

  for (let i = 0; i < rows.length; i += 2) {
    const left = rows[i];
    const right = rows[i + 1];
    const leftLines = wrapTextToWidth(state.fonts.regular, safeText(left[1]), valueSize, valueWidth);
    const rightLines = right ? wrapTextToWidth(state.fonts.regular, safeText(right[1]), valueSize, valueWidth) : [''];
    const rowHeight = Math.max(leftLines.length, rightLines.length) * 11 + 22;

    ensureSpace(state, rowHeight);

    state.page.drawText(left[0].toUpperCase(), {
      x: leftX,
      y: state.y,
      size: labelSize,
      font: state.fonts.bold,
      color: COLORS.muted
    });
    drawWrappedLines(state.page, state.fonts.regular, leftLines, leftX, state.y - 12, {
      size: valueSize,
      lineHeight: 11,
      color: COLORS.text
    });

    if (right) {
      state.page.drawText(right[0].toUpperCase(), {
        x: rightX,
        y: state.y,
        size: labelSize,
        font: state.fonts.bold,
        color: COLORS.muted
      });
      drawWrappedLines(state.page, state.fonts.regular, rightLines, rightX, state.y - 12, {
        size: valueSize,
        lineHeight: 11,
        color: COLORS.text
      });
    }

    state.y -= rowHeight;
  }
}

function drawTotalsPanel(state, rows) {
  const titleHeight = 20;
  const rowHeight = 18;
  const panelHeight = 20 + titleHeight + rows.length * rowHeight + 16;
  ensureSpace(state, panelHeight + 12);

  const topY = state.y;
  const panelY = topY - panelHeight;
  state.page.drawRectangle({
    x: LAYOUT.marginLeft,
    y: panelY,
    width: LAYOUT.contentWidth,
    height: panelHeight,
    color: COLORS.panelAlt,
    borderColor: COLORS.border,
    borderWidth: 1
  });
  state.page.drawText('Settlement Summary', {
    x: LAYOUT.marginLeft + 14,
    y: topY - 18,
    size: 12,
    font: state.fonts.bold,
    color: COLORS.white
  });

  let currentY = topY - 42;
  for (const [label, amount] of rows) {
    state.page.drawText(label, {
      x: LAYOUT.marginLeft + 14,
      y: currentY,
      size: 9,
      font: state.fonts.regular,
      color: COLORS.muted
    });
    const formatted = `$${fmtMoney(amount)}`;
    const fontSize = label === 'Net Pay' ? 13 : 10;
    const width = state.fonts.bold.widthOfTextAtSize(formatted, fontSize);
    state.page.drawText(formatted, {
      x: LAYOUT.width - LAYOUT.marginRight - 14 - width,
      y: currentY,
      size: fontSize,
      font: state.fonts.bold,
      color: label === 'Net Pay' ? COLORS.positive : COLORS.white
    });
    currentY -= rowHeight;
  }

  state.y = panelY - 14;
}

function getPreparedRow(fonts, columns, row, options = {}) {
  const size = options.size || 8;
  const lineHeight = options.lineHeight || 10;
  const padding = options.padding || 4;
  const cells = columns.map((column, index) => {
    const lines = wrapTextToWidth(fonts.regular, safeText(row[index], ''), size, column.width - padding * 2);
    return lines;
  });
  const height = Math.max(...cells.map((lines) => Math.max(lines.length, 1))) * lineHeight + padding * 2;
  return { cells, height };
}

function drawTableHeader(state, columns) {
  const topY = state.y;
  const size = 7;
  const padding = 4;
  const lineHeight = 8;
  const headerLines = columns.map((column) => (
    wrapTextToWidth(state.fonts.bold, column.label, size, column.width - padding * 2)
  ));
  const headerHeight = Math.max(...headerLines.map((lines) => lines.length), 1) * lineHeight + padding * 2;
  state.page.drawRectangle({
    x: LAYOUT.marginLeft,
    y: topY - headerHeight - 2,
    width: LAYOUT.contentWidth,
    height: headerHeight,
    color: COLORS.accentSoft
  });

  let cursorX = LAYOUT.marginLeft;
  columns.forEach((column, index) => {
    drawWrappedLines(state.page, state.fonts.bold, headerLines[index], cursorX + padding, topY - 10, {
      size,
      lineHeight,
      color: COLORS.white
    });
    cursorX += column.width;
  });

  state.y = topY - headerHeight - 6;
}

function drawTableRow(state, columns, preparedRow, index, options = {}) {
  const topY = state.y;
  const rowHeight = preparedRow.height;
  const size = options.size || 8;
  const lineHeight = options.lineHeight || 10;
  const padding = options.padding || 4;
  const rowColor = index % 2 === 0 ? COLORS.panel : COLORS.panelAlt;

  state.page.drawRectangle({
    x: LAYOUT.marginLeft,
    y: topY - rowHeight,
    width: LAYOUT.contentWidth,
    height: rowHeight,
    color: rowColor,
    borderColor: COLORS.border,
    borderWidth: 0.3
  });

  let cursorX = LAYOUT.marginLeft;
  columns.forEach((column, columnIndex) => {
    const font = column.bold ? state.fonts.bold : state.fonts.regular;
    const color = column.color || COLORS.text;
    drawWrappedLines(state.page, font, preparedRow.cells[columnIndex], cursorX + padding, topY - 10, {
      size,
      lineHeight,
      color
    });
    cursorX += column.width;
  });

  state.y = topY - rowHeight;
}

function drawTableSection(state, title, columns, rows, options = {}) {
  const emptyMessage = options.emptyMessage || 'No rows available.';
  const tableOptions = {
    size: options.size || 8,
    lineHeight: options.lineHeight || 10,
    padding: options.padding || 4
  };

  let rowIndex = 0;
  let titleSuffix = '';

  while (true) {
    ensureSpace(state, 48);
    drawSectionTitle(state, `${title}${titleSuffix}`);
    drawTableHeader(state, columns);

    if (!rows.length) {
      ensureSpace(state, 22);
      state.page.drawText(emptyMessage, {
        x: LAYOUT.marginLeft + 6,
        y: state.y,
        size: 9,
        font: state.fonts.regular,
        color: COLORS.muted
      });
      state.y -= 18;
      return;
    }

    while (rowIndex < rows.length) {
      const preparedRow = getPreparedRow(state.fonts, columns, rows[rowIndex], tableOptions);
      if (state.y - preparedRow.height < LAYOUT.contentBottom) {
        addPage(state);
        titleSuffix = ' (continued)';
        break;
      }
      drawTableRow(state, columns, preparedRow, rowIndex, tableOptions);
      rowIndex += 1;
    }

    state.y -= 10;
    if (rowIndex >= rows.length) return;
  }
}

function drawPanelSection(state, title, lines, options = {}) {
  const titleSize = options.titleSize || 11;
  const textSize = options.textSize || 8;
  const lineHeight = options.lineHeight || 10;
  const minHeight = options.minHeight || 78;
  const contentHeight = lines.length * lineHeight;
  const panelHeight = Math.max(minHeight, 28 + contentHeight + 18);
  ensureSpace(state, panelHeight + 12);

  const topY = state.y;
  const panelY = topY - panelHeight;
  state.page.drawRectangle({
    x: LAYOUT.marginLeft,
    y: panelY,
    width: LAYOUT.contentWidth,
    height: panelHeight,
    color: COLORS.panel,
    borderColor: COLORS.border,
    borderWidth: 1
  });
  state.page.drawText(title, {
    x: LAYOUT.marginLeft + 14,
    y: topY - 16,
    size: titleSize,
    font: state.fonts.bold,
    color: COLORS.accent
  });
  drawWrappedLines(state.page, state.fonts.regular, lines, LAYOUT.marginLeft + 14, topY - 34, {
    size: textSize,
    lineHeight,
    color: COLORS.text
  });
  state.y = panelY - 14;
}

function buildInsightLines(font, insights) {
  const lines = [];
  const summary = safeText(insights?.summary, 'Settlement insights are currently unavailable.');
  lines.push(...wrapTextToWidth(font, summary, 8, LAYOUT.contentWidth - 28));
  lines.push('');

  const items = Array.isArray(insights?.insights) ? insights.insights.slice(0, 4) : [];
  if (!items.length) {
    lines.push(...wrapTextToWidth(font, '- Placeholder insights are being used for this PDF render.', 8, LAYOUT.contentWidth - 28));
    return lines;
  }

  for (const item of items) {
    const text = `- ${safeText(item?.title, 'Insight')}: ${safeText(item?.message, '')}`;
    lines.push(...wrapTextToWidth(font, text, 8, LAYOUT.contentWidth - 28));
  }
  return lines;
}

async function buildSettlementPdf(payload) {
  const aiInsights = await ensureSettlementAiInsights(payload);
  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fonts = { regular, bold };

  const state = createDocumentState(pdfDoc, fonts, payload);
  addPage(state);

  drawSectionTitle(state, getSettlementTypeLabel(payload?.settlement?.settlement_type));
  drawInfoGrid(state, buildSummaryRows(payload));
  drawTotalsPanel(state, buildTotalRows(payload));

  drawTableSection(
    state,
    'Load Earnings',
    [
      { label: 'Load', width: 42 },
      { label: 'Dates', width: 78 },
      { label: 'Load Details', width: 156 },
      { label: 'Empty Miles', width: 56 },
      { label: 'Loaded Miles', width: 60 },
      { label: 'Gross Pay', width: 56 },
      { label: getHighlightedPayLabel(payload), width: 92, bold: true }
    ],
    buildLoadRows(payload),
    {
      emptyMessage: 'No load earnings were attached to this settlement.',
      size: 7,
      lineHeight: 9,
      padding: 4
    }
  );

  const fuelRows = buildFuelRows(payload?.adjustmentItems || []);
  if (fuelRows.length) {
    drawTableSection(
      state,
      'Fuel Deductions',
      [
        { label: 'Transaction Date', width: 84 },
        { label: 'Location', width: 210 },
        { label: 'Product Type', width: 82 },
        { label: 'Gallons', width: 62 },
        { label: 'Amount', width: 102, bold: true }
      ],
      fuelRows,
      {
        size: 8,
        lineHeight: 10,
        padding: 4
      }
    );
  }

  const scheduledRows = buildScheduledRows(payload?.adjustmentItems || []);
  if (scheduledRows.length) {
    drawTableSection(
      state,
      'Scheduled Deductions',
      [
        { label: 'Deduction #', width: 72 },
        { label: 'Deduction Description', width: 338 },
        { label: 'Deduction Amount', width: 130, bold: true }
      ],
      scheduledRows,
      {
        size: 8,
        lineHeight: 10,
        padding: 4
      }
    );
  }

  const otherRows = buildOtherDeductionRows(payload?.adjustmentItems || []);
  if (otherRows.length) {
    drawTableSection(
      state,
      'Other Deductions and Adjustments',
      [
        { label: 'Description', width: 310 },
        { label: 'Type', width: 120 },
        { label: 'Amount', width: 110, bold: true }
      ],
      otherRows,
      {
        size: 8,
        lineHeight: 10,
        padding: 4
      }
    );
  }

  drawPanelSection(state, 'FleetNeuron AI Insights', buildInsightLines(regular, aiInsights), {
    textSize: 8,
    lineHeight: 10,
    minHeight: 96
  });

  const metadataLines = [
    ...wrapTextToWidth(
      regular,
      `Settlement reference: ${safeText(payload?.settlement?.settlement_number || getSettlementDisplayNumber(payload))}`,
      9,
      LAYOUT.contentWidth - 28
    ),
    ...wrapTextToWidth(
      regular,
      `Generated for ${getPayableTo(payload)} using FleetNeuron AI settlement reporting.`,
      9,
      LAYOUT.contentWidth - 28
    ),
    ...wrapTextToWidth(
      regular,
      `Insights source: ${safeText(aiInsights?.source, 'fallback')} | status: ${safeText(aiInsights?.status, 'placeholder')}`,
      8,
      LAYOUT.contentWidth - 28
    )
  ];
  drawPanelSection(state, 'FleetNeuron Report Metadata', metadataLines, {
    textSize: 8,
    lineHeight: 10,
    minHeight: 78
  });

  state.pages.forEach((page, index) => {
    drawPageFooter(page, fonts, index + 1, state.pages.length);
  });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

module.exports = {
  buildSettlementPdf,
  getSettlementDisplayNumber,
  getSettlementPdfFileName
};
