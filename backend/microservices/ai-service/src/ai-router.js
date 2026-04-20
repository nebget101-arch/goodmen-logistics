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
   *     summary: AI loads natural-language query parser
   *     description: Converts a free-text query (e.g. "Smith's pending loads over $1000") into a structured filter object for the loads list. Uses Anthropic Claude Haiku 4.5 (temperature 0, max 512 tokens). Returns `{ fallback: true }` if the model cannot extract usable filters so the caller can fall back to a keyword search.
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
   *               - query
   *             properties:
   *               query:
   *                 type: string
   *                 description: Natural-language question about loads
   *     responses:
   *       200:
   *         description: Parsed filters, or a fallback signal if nothing extractable
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 fallback:
   *                   type: boolean
   *                   description: Present and true when the backend should fall back to a keyword search
   *                 filters:
   *                   type: object
   *                   description: Validated subset of ALLOWED_FILTERS
   *                 meta:
   *                   type: object
   *                   properties:
   *                     model:
   *                       type: string
   *                     processingTimeMs:
   *                       type: number
   *                     reason:
   *                       type: string
   *       400:
   *         description: Missing or invalid query
   *       401:
   *         description: Unauthorized
   */
  router.post('/loads/nlq', (req, res) => handleLoadsNlq(req, res, deps));

  return router;
}

module.exports = {
  buildAiRouter
};
