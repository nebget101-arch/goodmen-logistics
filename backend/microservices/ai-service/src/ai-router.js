const express = require('express');

const { handleChat } = require('./handlers/chat-handler');
const { handleWorkOrderTriage } = require('./handlers/work-order-triage-handler');
const { handleInventoryRecommendations } = require('./handlers/inventory-recommendations-handler');
const { handlePartsAnalysis } = require('./handlers/parts-analysis-handler');
const { handleCustomersAnalysis } = require('./handlers/customers-analysis-handler');
const { handleFuelPreprocess } = require('./handlers/fuel-preprocess-handler');
const { handleTollCsvNormalize } = require('./handlers/toll-csv-normalize-handler');
const { handleTollInvoiceVision } = require('./handlers/toll-invoice-vision-handler');
const { handleMvrVision } = require('./handlers/mvr-vision-handler');
const { handleFmcsaDriverMatch } = require('./handlers/fmcsa-driver-match-handler');
const { handlePspReportVision } = require('./handlers/psp-report-vision-handler');
const { handleSettlementInsights } = require('./handlers/settlement-insights-handler');
const { handleLoadsNlq } = require('./handlers/loads-nlq-handler');
const { handleBriefingGenerate } = require('./handlers/briefing-handler');
const { handleAsk } = require('./handlers/ask-handler');
const { handleScoreAlert } = require('./handlers/score-alert-handler');
const { handleExplain } = require('./handlers/explain-handler');
const { handleReportsAnomalies } = require('./handlers/reports-anomalies-handler');
const { handleReportsNarrative } = require('./handlers/reports-narrative-handler');
const { loadAuthContext } = require('./services/auth-context');

function buildAiRouter(deps) {
  const router = express.Router();

  /**
   * @openapi
   * /api/ai/chat:
   *   post:
   *     summary: AI chat assistant
   *     description: Conversational AI assistant for fleet management queries. Uses OpenAI gpt-4.1-mini with knowledge retrieval and contextual suggestions.
   *     tags:
   *       - AI
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - message
   *             properties:
   *               message:
   *                 type: string
   *                 description: User chat message
   *               conversationId:
   *                 type: string
   *                 description: Conversation context ID for multi-turn chat
   *               context:
   *                 type: object
   *                 description: Additional context information
   *               clientMeta:
   *                 type: object
   *                 description: Client metadata
   *     responses:
   *       200:
   *         description: AI response with suggestions
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 conversationId:
   *                   type: string
   *                 messages:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: string
   *                       role:
   *                         type: string
   *                         enum: [user, assistant]
   *                       content:
   *                         type: string
   *                       createdAt:
   *                         type: string
   *                         format: date-time
   *                 suggestions:
   *                   type: array
   *                   items:
   *                     type: string
   *                 meta:
   *                   type: object
   *                   properties:
   *                     model:
   *                       type: string
   *                     processingTimeMs:
   *                       type: number
   *       400:
   *         description: Missing message
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.post('/chat', (req, res) => handleChat(req, res, deps));

  /**
   * @openapi
   * /api/ai/work-order/triage:
   *   post:
   *     summary: AI work order triage
   *     description: Analyzes a problem description and suggests tasks, required parts, and priority level. Uses OpenAI gpt-4.1-mini with structured JSON output.
   *     tags:
   *       - AI
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - description
   *             properties:
   *               description:
   *                 type: string
   *                 description: Problem description for triage
   *               vehicleId:
   *                 type: string
   *               customerId:
   *                 type: string
   *               locationId:
   *                 type: string
   *     responses:
   *       200:
   *         description: Triage suggestions
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 tasks:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       description:
   *                         type: string
   *                       estimatedHours:
   *                         type: number
   *                 parts:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       query:
   *                         type: string
   *                       qty:
   *                         type: number
   *                 priority:
   *                   type: string
   *                   enum: [LOW, MEDIUM, HIGH]
   *                 notes:
   *                   type: string
   *       400:
   *         description: Missing description
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.post('/work-order/triage', (req, res) =>
    handleWorkOrderTriage(req, res, deps)
  );

  /**
   * @openapi
   * /api/ai/inventory/recommendations:
   *   post:
   *     summary: AI inventory recommendations
   *     description: Analyzes current inventory levels and transaction history to suggest reorder quantities and flag anomalies. Uses OpenAI gpt-4.1-mini. Processes up to 200 items.
   *     tags:
   *       - AI
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - onHand
   *             properties:
   *               locationName:
   *                 type: string
   *                 description: Warehouse or location name
   *               onHand:
   *                 type: array
   *                 description: Inventory items (max 200)
   *                 items:
   *                   type: object
   *                   properties:
   *                     sku:
   *                       type: string
   *                     name:
   *                       type: string
   *                     on_hand_qty:
   *                       type: number
   *                     reserved_qty:
   *                       type: number
   *                     available_qty:
   *                       type: number
   *                     status:
   *                       type: string
   *                     min_stock_level:
   *                       type: number
   *                     reorder_qty:
   *                       type: number
   *               recentTransactions:
   *                 type: array
   *                 description: Recent transaction history
   *                 items:
   *                   type: object
   *     responses:
   *       200:
   *         description: Reorder suggestions and anomalies
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 reorderSuggestions:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       sku:
   *                         type: string
   *                       name:
   *                         type: string
   *                       currentQty:
   *                         type: number
   *                       suggestedReorderQty:
   *                         type: number
   *                       reason:
   *                         type: string
   *                 anomalies:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       type:
   *                         type: string
   *                       partSku:
   *                         type: string
   *                         nullable: true
   *                       message:
   *                         type: string
   *                 notes:
   *                   type: string
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.post('/inventory/recommendations', (req, res) =>
    handleInventoryRecommendations(req, res, deps)
  );

  /**
   * @openapi
   * /api/ai/parts/analysis:
   *   post:
   *     summary: AI parts catalog analysis
   *     description: Analyzes parts catalog for stock levels, cost concentration, and category distribution. Uses OpenAI gpt-4.1-mini. Processes up to 300 parts.
   *     tags:
   *       - AI
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - parts
   *             properties:
   *               parts:
   *                 type: array
   *                 description: Parts catalog (max 300)
   *                 items:
   *                   type: object
   *                   properties:
   *                     sku:
   *                       type: string
   *                     name:
   *                       type: string
   *                     category:
   *                       type: string
   *                     manufacturer:
   *                       type: string
   *                     unit_cost:
   *                       type: number
   *                     unit_price:
   *                       type: number
   *                     quantity_on_hand:
   *                       type: number
   *                     reorder_level:
   *                       type: number
   *                     status:
   *                       type: string
   *               categories:
   *                 type: array
   *                 items:
   *                   type: string
   *               manufacturers:
   *                 type: array
   *                 items:
   *                   type: string
   *     responses:
   *       200:
   *         description: Parts analysis with insights and recommendations
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 summary:
   *                   type: string
   *                 insights:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       type:
   *                         type: string
   *                       title:
   *                         type: string
   *                       message:
   *                         type: string
   *                       partSkus:
   *                         type: array
   *                         items:
   *                           type: string
   *                 recommendations:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       action:
   *                         type: string
   *                       detail:
   *                         type: string
   *                       partSkus:
   *                         type: array
   *                         items:
   *                           type: string
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.post('/parts/analysis', (req, res) =>
    handlePartsAnalysis(req, res, deps)
  );

  /**
   * @openapi
   * /api/ai/shop-clients/analysis:
   *   post:
   *     summary: AI shop client analysis
   *     description: Analyzes customer records for activity patterns, missing contact info, service recency, and payment terms. Uses OpenAI gpt-4.1-mini. Processes up to 200 customers.
   *     tags:
   *       - AI
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - customers
   *             properties:
   *               customers:
   *                 type: array
   *                 description: Customer records (max 200)
   *                 items:
   *                   type: object
   *                   properties:
   *                     company_name:
   *                       type: string
   *                     customer_type:
   *                       type: string
   *                     status:
   *                       type: string
   *                     phone:
   *                       type: string
   *                     email:
   *                       type: string
   *                     last_service_date:
   *                       type: string
   *                       format: date
   *                     payment_terms:
   *                       type: string
   *                     credit_limit:
   *                       type: number
   *     responses:
   *       200:
   *         description: Customer analysis with insights and recommendations
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 summary:
   *                   type: string
   *                 insights:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       type:
   *                         type: string
   *                       title:
   *                         type: string
   *                       message:
   *                         type: string
   *                       customerIds:
   *                         type: array
   *                         items:
   *                           type: string
   *                 recommendations:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       action:
   *                         type: string
   *                       detail:
   *                         type: string
   *                       customerIds:
   *                         type: array
   *                         items:
   *                           type: string
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.post('/shop-clients/analysis', (req, res) =>
    handleCustomersAnalysis(req, res, deps)
  );

  /**
   * @openapi
   * /api/ai/fuel/preprocess:
   *   post:
   *     summary: AI fuel CSV preprocessing
   *     description: Analyzes fuel CSV headers and sample rows to detect column mappings, product type splitting strategies, and flagged rows. Uses OpenAI gpt-4.1-mini with JSON mode (temperature 0.1). Maps to 16 normalized fields.
   *     tags:
   *       - AI
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - headers
   *               - sampleRows
   *             properties:
   *               headers:
   *                 type: array
   *                 items:
   *                   type: string
   *                 description: CSV column headers
   *               sampleRows:
   *                 type: array
   *                 items:
   *                   type: array
   *                   items:
   *                     type: string
   *                 description: Sample data rows (up to 20 analyzed)
   *               totalRows:
   *                 type: number
   *               providerName:
   *                 type: string
   *                 description: Fuel vendor name
   *     responses:
   *       200:
   *         description: Column mapping and preprocessing analysis
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   properties:
   *                     columnMapping:
   *                       type: object
   *                     splitStrategy:
   *                       type: object
   *                       properties:
   *                         type:
   *                           type: string
   *                           enum: [multi_column, description_parse, none]
   *                     overallConfidence:
   *                       type: number
   *                     totalRows:
   *                       type: number
   *                 meta:
   *                   type: object
   *                   properties:
   *                     model:
   *                       type: string
   *                     processingTimeMs:
   *                       type: number
   *       400:
   *         description: Missing headers or sampleRows
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.post('/fuel/preprocess', (req, res) =>
    handleFuelPreprocess(req, res, deps)
  );

  /**
   * @openapi
   * /api/ai/tolls/csv-normalize:
   *   post:
   *     summary: AI toll CSV normalization
   *     description: Analyzes toll CSV headers and sample rows to detect provider, column mappings, date/amount formats, and location strategy. Uses OpenAI gpt-4.1-mini with JSON mode (temperature 0.1). Maps to 14 normalized fields.
   *     tags:
   *       - AI
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - headers
   *               - sampleRows
   *             properties:
   *               headers:
   *                 type: array
   *                 items:
   *                   type: string
   *                 description: CSV column headers
   *               sampleRows:
   *                 type: array
   *                 items:
   *                   type: array
   *                   items:
   *                     type: string
   *                 description: Sample data rows (up to 20 analyzed)
   *               totalRows:
   *                 type: number
   *               providerName:
   *                 type: string
   *                 description: Toll provider name
   *     responses:
   *       200:
   *         description: Column mapping and normalization analysis
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   properties:
   *                     columnMapping:
   *                       type: object
   *                     providerDetected:
   *                       type: string
   *                       nullable: true
   *                     dateFormat:
   *                       type: string
   *                       nullable: true
   *                     locationStrategy:
   *                       type: string
   *                       enum: [separate_columns, merged_field, entry_exit]
   *                     overallConfidence:
   *                       type: number
   *                     totalRows:
   *                       type: number
   *                 processingTimeMs:
   *                   type: number
   *       400:
   *         description: Missing headers or sampleRows
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.post('/tolls/csv-normalize', (req, res) =>
    handleTollCsvNormalize(req, res, deps)
  );

  /**
   * @openapi
   * /api/ai/tolls/invoice-vision:
   *   post:
   *     summary: AI toll invoice vision extraction
   *     description: Extracts structured toll transaction data from invoice images using Anthropic Claude vision (claude-sonnet-4-20250514, max 4096 tokens, temperature 0.1). Supports JPEG, PNG, WebP, GIF. Recognizes 10+ major toll providers (E-ZPass, SunPass, FasTrak, I-PASS, etc.).
   *     tags:
   *       - AI
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - imageBase64
   *             properties:
   *               imageBase64:
   *                 type: string
   *                 description: Base64-encoded toll invoice image
   *               mediaType:
   *                 type: string
   *                 default: image/jpeg
   *                 description: Image MIME type (image/jpeg, image/png, image/webp, image/gif)
   *     responses:
   *       200:
   *         description: Extracted invoice metadata and transactions
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   properties:
   *                     invoiceMeta:
   *                       type: object
   *                       properties:
   *                         invoiceNumber:
   *                           type: string
   *                           nullable: true
   *                         invoiceDate:
   *                           type: string
   *                           format: date
   *                           nullable: true
   *                         providerName:
   *                           type: string
   *                         totalAmount:
   *                           type: number
   *                           nullable: true
   *                     transactions:
   *                       type: array
   *                       items:
   *                         type: object
   *                         properties:
   *                           transaction_date:
   *                             type: string
   *                             format: date
   *                           provider_name:
   *                             type: string
   *                           plaza_name:
   *                             type: string
   *                             nullable: true
   *                           state:
   *                             type: string
   *                           amount:
   *                             type: number
   *                     confidence:
   *                       type: number
   *                     warnings:
   *                       type: array
   *                       items:
   *                         type: string
   *                 processingTimeMs:
   *                   type: number
   *       400:
   *         description: Missing imageBase64
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.post('/tolls/invoice-vision', (req, res) =>
    handleTollInvoiceVision(req, res, deps)
  );

  /**
   * @openapi
   * /api/ai/safety/mvr-vision:
   *   post:
   *     summary: AI MVR/driving record vision extraction
   *     description: Extracts driver info, violations, accidents, and suspensions from MVR document images. Generates risk assessment with hire recommendation. Uses OpenAI gpt-4.1-mini vision (max 4096 tokens, temperature 0.1). Risk levels — 3+ violations in 3 years = high; major violation = high; DUI/suspension = critical.
   *     tags:
   *       - AI
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - imageBase64
   *             properties:
   *               imageBase64:
   *                 type: string
   *                 description: Base64-encoded MVR document image
   *               mediaType:
   *                 type: string
   *                 default: image/jpeg
   *                 description: MIME type (image/jpeg, image/png, image/webp, application/pdf)
   *     responses:
   *       200:
   *         description: Extracted MVR data with risk assessment
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   properties:
   *                     driverInfo:
   *                       type: object
   *                       properties:
   *                         fullName:
   *                           type: string
   *                           nullable: true
   *                         licenseNumber:
   *                           type: string
   *                           nullable: true
   *                         licenseState:
   *                           type: string
   *                         licenseClass:
   *                           type: string
   *                           enum: [A, B, C, non-CDL]
   *                         licenseStatus:
   *                           type: string
   *                           enum: [valid, suspended, revoked, expired]
   *                           nullable: true
   *                     movingViolations:
   *                       type: array
   *                       items:
   *                         type: object
   *                         properties:
   *                           date:
   *                             type: string
   *                             format: date
   *                           description:
   *                             type: string
   *                           severity:
   *                             type: string
   *                             enum: [minor, major, serious]
   *                     accidents:
   *                       type: array
   *                       items:
   *                         type: object
   *                     suspensions:
   *                       type: array
   *                       items:
   *                         type: object
   *                     riskAssessment:
   *                       type: object
   *                       properties:
   *                         riskLevel:
   *                           type: string
   *                           enum: [low, medium, high, critical]
   *                         hireRecommendation:
   *                           type: string
   *                           enum: [recommend, caution, decline]
   *                         hireRecommendationReason:
   *                           type: string
   *                     confidence:
   *                       type: number
   *                 processingTimeMs:
   *                   type: number
   *       400:
   *         description: Missing imageBase64
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.post('/safety/mvr-vision', (req, res) =>
    handleMvrVision(req, res, deps)
  );

  /**
   * @openapi
   * /api/ai/fmcsa/match-driver:
   *   post:
   *     summary: AI FMCSA driver name matching
   *     description: Fuzzy-matches an FMCSA inspection driver name against fleet driver records. Uses Anthropic Claude (claude-sonnet-4-20250514, max 1024 tokens). Handles abbreviations, nicknames (23 common mappings), misspellings, and middle initials. Confidence thresholds — 0.85+ auto_match, 0.5-0.84 suggest, below 0.5 no_match.
   *     tags:
   *       - AI
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - fmcsaDriverName
   *               - fleetDrivers
   *             properties:
   *               fmcsaDriverName:
   *                 type: string
   *                 description: Driver name from FMCSA inspection (e.g., "HORTON, TYRON D")
   *               fleetDrivers:
   *                 type: array
   *                 description: Fleet drivers to match against (max 200)
   *                 items:
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: string
   *                     first_name:
   *                       type: string
   *                     last_name:
   *                       type: string
   *                     cdl_number:
   *                       type: string
   *     responses:
   *       200:
   *         description: Match result with confidence and candidates
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 match:
   *                   type: object
   *                   nullable: true
   *                   properties:
   *                     driverId:
   *                       type: string
   *                     confidence:
   *                       type: number
   *                     reasoning:
   *                       type: string
   *                 status:
   *                   type: string
   *                   enum: [auto_match, suggest, no_match]
   *                 candidates:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       driverId:
   *                         type: string
   *                       confidence:
   *                         type: number
   *                       reasoning:
   *                         type: string
   *                 meta:
   *                   type: object
   *                   properties:
   *                     model:
   *                       type: string
   *                     processingTimeMs:
   *                       type: number
   *                     driversEvaluated:
   *                       type: number
   *       400:
   *         description: Missing fmcsaDriverName or fleetDrivers
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.post('/fmcsa/match-driver', (req, res) =>
    handleFmcsaDriverMatch(req, res, deps)
  );

  /**
   * @openapi
   * /api/ai/drivers/psp-vision:
   *   post:
   *     summary: AI PSP report vision extraction
   *     description: Extracts inspections and crashes from Pre-employment Screening Program (PSP) report images or PDFs. Uses Anthropic Claude vision (claude-sonnet-4-20250514, max 8192 tokens, temperature 0.1). Supports PDF documents directly.
   *     tags:
   *       - AI
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - fileBase64
   *             properties:
   *               fileBase64:
   *                 type: string
   *                 description: Base64-encoded PSP report (image or PDF)
   *               mediaType:
   *                 type: string
   *                 default: image/jpeg
   *                 description: MIME type (image/jpeg, image/png, image/webp, image/gif, application/pdf)
   *     responses:
   *       200:
   *         description: Extracted PSP inspection and crash data
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   properties:
   *                     inspections:
   *                       type: array
   *                       items:
   *                         type: object
   *                     crashes:
   *                       type: array
   *                       items:
   *                         type: object
   *                 processingTimeMs:
   *                   type: number
   *       400:
   *         description: Missing fileBase64
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.post('/drivers/psp-vision', (req, res) =>
    handlePspReportVision(req, res, deps)
  );

  /**
   * @openapi
   * /api/ai/settlements/insights:
   *   post:
   *     summary: AI settlement insights
   *     description: Generates operational insights for settlement data including profitability, fuel efficiency, and risk analysis. Uses OpenAI gpt-4.1-mini (temperature 0.2). Returns max 4 categorized insights.
   *     tags:
   *       - AI
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - settlement
   *             properties:
   *               settlement:
   *                 type: object
   *                 description: Settlement data
   *                 properties:
   *                   id:
   *                     type: integer
   *                   settlement_number:
   *                     type: string
   *                   settlement_type:
   *                     type: string
   *                   date:
   *                     type: string
   *                     format: date
   *               driver:
   *                 type: object
   *               truck:
   *                 type: object
   *               payableTo:
   *                 type: string
   *               metrics:
   *                 type: object
   *               priorPeriod:
   *                 type: object
   *               expenseBreakdown:
   *                 type: object
   *               anomalyFlags:
   *                 type: array
   *                 items:
   *                   type: string
   *     responses:
   *       200:
   *         description: Settlement insights
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 summary:
   *                   type: string
   *                 insights:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       title:
   *                         type: string
   *                       message:
   *                         type: string
   *                       category:
   *                         type: string
   *                         enum: [profitability, fuel, comparison, quality, risk]
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.post('/settlements/insights', (req, res) =>
    handleSettlementInsights(req, res, deps)
  );

  /**
   * @openapi
   * /api/ai/loads/nlq:
   *   post:
   *     summary: AI loads natural-language query parser (FN-800)
   *     description: >
   *       Converts free-text (e.g. "Smith's pending loads over $1000") into a validated
   *       filter object for the loads list. Uses Anthropic Claude Haiku (temperature 0).
   *       Returns `{ success: true, fallback: true }` when nothing extractable or on upstream
   *       failure so callers can use keyword search.
   *     tags:
   *       - AI
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - query
   *             properties:
   *               query:
   *                 type: string
   *                 description: Natural-language question about loads
   *     responses:
   *       200:
   *         description: Parsed filters, or fallback for keyword search
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 fallback:
   *                   type: boolean
   *                 filters:
   *                   type: object
   *                 meta:
   *                   type: object
   *       400:
   *         description: Missing or invalid query
   */
  router.post('/loads/nlq', (req, res) => handleLoadsNlq(req, res, deps));

  /**
   * @openapi
   * /api/ai/briefing/generate:
   *   post:
   *     summary: Generate Daily AI Briefing (FN-1139)
   *     description: >
   *       Produces a five-section operational briefing (throughput, exceptions, driver risk,
   *       vehicle risk, recommended action) from upstream-aggregated metrics. Uses Anthropic
   *       Claude Sonnet 4.6 (temperature 0.2). Caches result per `(tenantId, date)` for 24h;
   *       backend (FN-1141) sets `forceRefresh=true` when the user clicks "Refresh".
   *     tags:
   *       - AI
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - tenantId
   *               - date
   *             properties:
   *               tenantId:
   *                 type: string
   *                 description: Tenant UUID
   *               date:
   *                 type: string
   *                 format: date
   *                 description: Calendar day (YYYY-MM-DD) for the briefing
   *               metrics:
   *                 type: object
   *                 description: Upstream-aggregated fleet metrics for the day
   *               forceRefresh:
   *                 type: boolean
   *                 description: Bypass cache and regenerate
   *     responses:
   *       200:
   *         description: Five-section briefing
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 cached:
   *                   type: boolean
   *                 generatedAt:
   *                   type: string
   *                   format: date-time
   *                 data:
   *                   type: object
   *                   properties:
   *                     throughput:
   *                       $ref: '#/components/schemas/BriefingSection'
   *                     exceptions:
   *                       $ref: '#/components/schemas/BriefingSection'
   *                     driverRisk:
   *                       $ref: '#/components/schemas/BriefingSection'
   *                     vehicleRisk:
   *                       $ref: '#/components/schemas/BriefingSection'
   *                     recommendedAction:
   *                       $ref: '#/components/schemas/BriefingSection'
   *                 meta:
   *                   type: object
   *                   properties:
   *                     model:
   *                       type: string
   *                     processingTimeMs:
   *                       type: number
   *       400:
   *         description: Missing or invalid tenantId/date/metrics
   *       502:
   *         description: AI upstream unavailable, parse error, or schema mismatch
   * components:
   *   schemas:
   *     BriefingSection:
   *       type: object
   *       properties:
   *         headline:
   *           type: string
   *         detail:
   *           type: string
   *         metric:
   *           type: string
   */
  router.post('/briefing/generate', (req, res) =>
    handleBriefingGenerate(req, res, deps)
  );

  /**
   * @openapi
   * /api/ai/ask:
   *   post:
   *     summary: Ask FleetNeuron natural-language Q&A (FN-1148)
   *     description: >
   *       Classifies the user's prompt into one of {loads, drivers, vehicles,
   *       generic} and routes it to a domain-specific Claude prompt. The
   *       briefing context (FN-1124) provides today's fleet snapshot for
   *       grounding. Returns a structured `{kind:"text", headline, detail}`
   *       answer envelope so the Control Center bar (FN-1146) can render it
   *       inline.
   *     tags:
   *       - AI
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - prompt
   *             properties:
   *               prompt:
   *                 type: string
   *                 description: User's natural-language question (max 1000 chars)
   *               briefingContext:
   *                 type: object
   *                 description: Today's briefing context (FN-1124 schema) used to ground the answer
   *               tenantId:
   *                 type: string
   *                 description: Tenant identifier (forwarded from gateway JWT)
   *     responses:
   *       200:
   *         description: Classified intent and structured answer
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 intent:
   *                   type: string
   *                   enum: [loads, drivers, vehicles, generic]
   *                 answer:
   *                   type: object
   *                   properties:
   *                     kind:
   *                       type: string
   *                       enum: [text]
   *                     headline:
   *                       type: string
   *                     detail:
   *                       type: string
   *                 classification:
   *                   type: object
   *                   properties:
   *                     confidence:
   *                       type: number
   *                     reasoning:
   *                       type: string
   *                     source:
   *                       type: string
   *                 meta:
   *                   type: object
   *                   properties:
   *                     model:
   *                       type: string
   *                     processingTimeMs:
   *                       type: number
   *       400:
   *         description: Missing or invalid prompt
   *       502:
   *         description: AI upstream unavailable, parse error, or schema mismatch
   */
  router.post('/ask', (req, res) => handleAsk(req, res, deps));

  /**
   * @openapi
   * /api/ai/score-alert:
   *   post:
   *     summary: Score Smart Alert severity (FN-1159)
   *     description: >
   *       Combines a deterministic rule-based baseline (alert type + facts) with a
   *       Claude-derived contextual boost to produce a 0-100 severity, a one-sentence
   *       reasoning token, and a recommended dispatcher action. Falls back to the
   *       rule-based baseline + canned reasoning/action when Claude is unavailable
   *       or returns malformed output, so the gateway aggregator (FN-1161) always
   *       gets a finite severity.
   *     tags:
   *       - AI
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - alert
   *             properties:
   *               tenantId:
   *                 type: string
   *                 description: Optional tenant context, passed through to logging.
   *               alert:
   *                 type: object
   *                 required:
   *                   - id
   *                   - type
   *                 properties:
   *                   id:
   *                     type: string
   *                   type:
   *                     type: string
   *                     enum: [hos_imminent, fatigue, inspection_overdue, late_load_risk]
   *                   subjectId:
   *                     type: string
   *                   subjectKind:
   *                     type: string
   *                     enum: [driver, vehicle, load]
   *                   facts:
   *                     type: object
   *                     description: Type-specific signal facts (minutesRemaining, daysOverdue, etaDelta, fatigueScore, etc.).
   *     responses:
   *       200:
   *         description: Severity-scored alert with reasoning and recommended action
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 severity:
   *                   type: integer
   *                   minimum: 0
   *                   maximum: 100
   *                 reasoning:
   *                   type: string
   *                 action:
   *                   type: string
   *                 meta:
   *                   type: object
   *                   properties:
   *                     baseScore:
   *                       type: integer
   *                     boost:
   *                       type: integer
   *                     scoredBy:
   *                       type: string
   *                     model:
   *                       type: string
   *                     processingTimeMs:
   *                       type: number
   *       400:
   *         description: Missing or invalid alert payload
   */
  router.post('/score-alert', (req, res) => handleScoreAlert(req, res, deps));

  /**
   * @openapi
   * /api/ai/explain/{token}:
   *   get:
   *     summary: Resolve an AI explainability token (FN-1176)
   *     description: >
   *       Returns the rationale (sources, rules, scores) for an AI-derived value
   *       previously minted by ai-service (briefing claim, severity decision,
   *       predictive trend). Tokens are returned alongside any AI output and
   *       expire 30 days after mint.
   *     tags:
   *       - AI
   *     parameters:
   *       - in: path
   *         name: token
   *         required: true
   *         schema:
   *           type: string
   *           pattern: '^expl_[a-f0-9]{32}$'
   *         description: Explainability token returned alongside an AI output
   *     responses:
   *       200:
   *         description: Rationale resolved
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   description: Rationale payload (kind-specific shape)
   *                 meta:
   *                   type: object
   *                   properties:
   *                     token:
   *                       type: string
   *                     createdAt:
   *                       type: string
   *                       format: date-time
   *                     expiresAt:
   *                       type: string
   *                       format: date-time
   *                     processingTimeMs:
   *                       type: number
   *       400:
   *         description: Malformed token
   *       404:
   *         description: Token not found or expired
   */
  router.get('/explain/:token', (req, res) => handleExplain(req, res, deps));

  /**
   * @openapi
   * /api/ai/reports/{reportKey}/anomalies:
   *   post:
   *     summary: AI structured anomaly detection for a report (FN-1134)
   *     description: >
   *       Returns severity-tagged structured outliers for a report dataset using
   *       Anthropic Claude with prompt caching (system prompt + per-report
   *       schema). Malformed model output collapses to an empty array (logged,
   *       not 500). Requires the caller to hold `reports.view`.
   *     tags:
   *       - AI
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: reportKey
   *         required: true
   *         schema:
   *           type: string
   *           pattern: '^[a-z][a-z0-9_-]{0,63}$'
   *         description: Stable identifier for the report being analysed.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               data:
   *                 oneOf:
   *                   - type: array
   *                   - type: object
   *                 description: Report rows or aggregate object.
   *               filters:
   *                 type: object
   *                 description: Filters applied when the report was rendered.
   *               priorPeriod:
   *                 type: object
   *                 description: Aggregate metrics for the comparison period.
   *     responses:
   *       200:
   *         description: Structured anomalies (possibly empty)
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 anomalies:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       metric:
   *                         type: string
   *                       value:
   *                         type: number
   *                       deltaPct:
   *                         type: number
   *                         nullable: true
   *                       severity:
   *                         type: string
   *                         enum: [info, warning, critical]
   *                       context:
   *                         type: string
   *                 meta:
   *                   type: object
   *                   properties:
   *                     reportKey:
   *                       type: string
   *                     scoredBy:
   *                       type: string
   *                     model:
   *                       type: string
   *                     cacheReadTokens:
   *                       type: integer
   *                     cacheWriteTokens:
   *                       type: integer
   *                     processingTimeMs:
   *                       type: number
   *       400:
   *         description: Bad request (invalid reportKey or body)
   *       403:
   *         description: Caller lacks reports.view
   */
  router.post(
    '/reports/:reportKey/anomalies',
    loadAuthContext,
    (req, res) => handleReportsAnomalies(req, res, deps)
  );

  /**
   * @openapi
   * /api/ai/reports/{reportKey}/narrative:
   *   post:
   *     summary: Generate a narrative for a financial report (FN-1123)
   *     description: >
   *       Produces a 2–3 sentence plain-prose narrative explaining the headline
   *       movement in a financial report (revenue-by-driver, fuel-spend-by-truck,
   *       load-margin, or any other report key). Uses Anthropic Claude Sonnet 4.6
   *       (temperature 0.2, max 400 tokens) with **prompt caching** on two static
   *       blocks: the role/style system prompt and the per-report schema block.
   *       The dynamic payload (cards, data rows, filters, prior-period values) is
   *       sent in the user message and is NOT cached.
   *     tags:
   *       - AI
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: reportKey
   *         required: true
   *         schema:
   *           type: string
   *           pattern: '^[a-z0-9-]{1,64}$'
   *         description: Report identifier (e.g. revenue-by-driver, fuel-spend-by-truck, load-margin)
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               cards:
   *                 type: array
   *                 description: KPI cards displayed on the report
   *                 items:
   *                   type: object
   *               data:
   *                 type: array
   *                 description: Raw data rows underlying the report (truncated to 200 for prompt size)
   *                 items:
   *                   type: object
   *               filters:
   *                 type: object
   *                 description: Active filters applied to the report
   *               priorPeriod:
   *                 oneOf:
   *                   - type: object
   *                   - type: array
   *                 description: Prior-period values for delta comparisons
   *     responses:
   *       200:
   *         description: Generated narrative
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 narrative:
   *                   type: string
   *                   description: 2–3 sentence plain-prose narrative
   *                 generatedAt:
   *                   type: string
   *                   format: date-time
   *                 meta:
   *                   type: object
   *                   properties:
   *                     model:
   *                       type: string
   *                     cacheReadTokens:
   *                       type: integer
   *                     cacheCreationTokens:
   *                       type: integer
   *                     processingTimeMs:
   *                       type: number
   *       400:
   *         description: Invalid reportKey or request body
   *       403:
   *         description: Missing or invalid bearer token, or insufficient role
   *       413:
   *         description: Request body exceeds 256KB
   *       502:
   *         description: AI upstream unavailable
   */
  router.post('/reports/:reportKey/narrative', (req, res) =>
    handleReportsNarrative(req, res, deps)
  );

  return router;
}

module.exports = {
  buildAiRouter
};
