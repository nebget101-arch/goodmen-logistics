const express = require('express');
const router = express.Router();
const roadsideService = require('../services/roadside.service');

/**
 * @openapi
 * /api/roadside/calls:
 *   post:
 *     summary: Create a roadside call
 *     description: Creates a new roadside assistance call record. Per 49 CFR Part 396 — Inspection, Repair, and Maintenance.
 *     tags:
 *       - Roadside
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               caller_name:
 *                 type: string
 *               caller_phone:
 *                 type: string
 *               vehicle_id:
 *                 type: string
 *               driver_id:
 *                 type: string
 *               location:
 *                 type: string
 *               description:
 *                 type: string
 *               urgency:
 *                 type: string
 *                 enum: [low, medium, high, critical]
 *               intake_source:
 *                 type: string
 *     responses:
 *       201:
 *         description: Roadside call created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
// POST /api/roadside/calls
router.post('/calls', async (req, res) => {
  try {
    const userId = req.context?.userId || req.user?.id || null;
    const created = await roadsideService.createCall(req.body, userId, req.context);
    res.status(201).json(created);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/roadside/calls:
 *   get:
 *     summary: List roadside calls
 *     description: Retrieves a list of roadside assistance calls, scoped by tenant and operating entity. Per 49 CFR Part 396 — Inspection, Repair, and Maintenance.
 *     tags:
 *       - Roadside
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by call status
 *       - in: query
 *         name: urgency
 *         schema:
 *           type: string
 *         description: Filter by urgency level
 *       - in: query
 *         name: vehicle_id
 *         schema:
 *           type: string
 *         description: Filter by vehicle ID
 *       - in: query
 *         name: driver_id
 *         schema:
 *           type: string
 *         description: Filter by driver ID
 *     responses:
 *       200:
 *         description: List of roadside calls
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
// GET /api/roadside/calls
router.get('/calls', async (req, res) => {
  try {
    const rows = await roadsideService.listCalls(req.query, req.context);
    res.json(rows);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/roadside/calls/{id}:
 *   get:
 *     summary: Get a roadside call by ID
 *     description: Retrieves a single roadside assistance call by its ID. Per 49 CFR Part 396 — Inspection, Repair, and Maintenance.
 *     tags:
 *       - Roadside
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Roadside call ID
 *     responses:
 *       200:
 *         description: Roadside call details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Call not found
 *       500:
 *         description: Server error
 */
// GET /api/roadside/calls/:id
router.get('/calls/:id', async (req, res) => {
  try {
    const row = await roadsideService.getCall(req.params.id, req.context);
    if (!row) return res.status(404).json({ error: 'Not found' });
    return res.json(row);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/roadside/calls/{id}/status:
 *   patch:
 *     summary: Update roadside call status
 *     description: Updates the status of an existing roadside call. Per 49 CFR Part 396 — Inspection, Repair, and Maintenance.
 *     tags:
 *       - Roadside
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Roadside call ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 description: New status value
 *     responses:
 *       200:
 *         description: Updated roadside call
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
// PATCH /api/roadside/calls/:id/status
router.patch('/calls/:id/status', async (req, res) => {
  try {
    const userId = req.context?.userId || req.user?.id || null;
    const row = await roadsideService.setStatus(req.params.id, req.body.status, userId, req.context);
    res.json(row);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/roadside/calls/{id}/triage:
 *   post:
 *     summary: Triage a roadside call
 *     description: Submits triage information for a roadside call, including urgency assessment and notes. Per 49 CFR Part 396 — Inspection, Repair, and Maintenance.
 *     tags:
 *       - Roadside
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Roadside call ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               urgency:
 *                 type: string
 *                 enum: [low, medium, high, critical]
 *               notes:
 *                 type: string
 *               category:
 *                 type: string
 *     responses:
 *       200:
 *         description: Triaged roadside call
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
// POST /api/roadside/calls/:id/triage
router.post('/calls/:id/triage', async (req, res) => {
  try {
    const userId = req.context?.userId || req.user?.id || null;
    const row = await roadsideService.triage(req.params.id, req.body, userId, req.context);
    res.json(row);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/roadside/calls/{id}/dispatch:
 *   post:
 *     summary: Assign dispatch to a roadside call
 *     description: Assigns dispatch resources (service provider, ETA, etc.) to a roadside call. Per 49 CFR Part 396 — Inspection, Repair, and Maintenance.
 *     tags:
 *       - Roadside
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Roadside call ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               provider_name:
 *                 type: string
 *               provider_phone:
 *                 type: string
 *               eta_minutes:
 *                 type: integer
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Dispatch assigned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
// POST /api/roadside/calls/:id/dispatch
router.post('/calls/:id/dispatch', async (req, res) => {
  try {
    const userId = req.context?.userId || req.user?.id || null;
    const row = await roadsideService.assignDispatch(req.params.id, req.body, userId, req.context);
    res.json(row);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/roadside/calls/{id}/resolve:
 *   post:
 *     summary: Resolve a roadside call
 *     description: Marks a roadside call as resolved with resolution details. Per 49 CFR Part 396 — Inspection, Repair, and Maintenance.
 *     tags:
 *       - Roadside
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Roadside call ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               resolution_notes:
 *                 type: string
 *               resolution_type:
 *                 type: string
 *               cost:
 *                 type: number
 *     responses:
 *       200:
 *         description: Resolved roadside call
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
// POST /api/roadside/calls/:id/resolve
router.post('/calls/:id/resolve', async (req, res) => {
  try {
    const userId = req.context?.userId || req.user?.id || null;
    const row = await roadsideService.resolveCall(req.params.id, req.body, userId, req.context);
    res.json(row);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/roadside/calls/{id}/work-order:
 *   post:
 *     summary: Link a work order to a roadside call
 *     description: Associates a maintenance work order with a roadside call for tracking repair work. Per 49 CFR Part 396 — Inspection, Repair, and Maintenance.
 *     tags:
 *       - Roadside
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Roadside call ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               work_order_id:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Work order linked
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
// POST /api/roadside/calls/:id/work-order
router.post('/calls/:id/work-order', async (req, res) => {
  try {
    const userId = req.context?.userId || req.user?.id || null;
    const row = await roadsideService.linkWorkOrder(req.params.id, req.body, userId, req.context);
    res.json(row);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/roadside/calls/{id}/media/upload-url:
 *   post:
 *     summary: Generate a media upload URL for a roadside call
 *     description: Creates a pre-signed upload URL for attaching media (photos, documents) to a roadside call. Per 49 CFR Part 396 — Inspection, Repair, and Maintenance.
 *     tags:
 *       - Roadside
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Roadside call ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               file_name:
 *                 type: string
 *               content_type:
 *                 type: string
 *     responses:
 *       200:
 *         description: Pre-signed upload URL
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 upload_url:
 *                   type: string
 *                 storage_key:
 *                   type: string
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
// POST /api/roadside/calls/:id/media/upload-url
router.post('/calls/:id/media/upload-url', async (req, res) => {
  try {
    const userId = req.context?.userId || req.user?.id || null;
    const upload = await roadsideService.createMediaUploadUrl(req.params.id, req.body, userId, req.context);
    res.json(upload);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/roadside/calls/{id}/media:
 *   post:
 *     summary: Add media to a roadside call
 *     description: Attaches uploaded media metadata to a roadside call record. Per 49 CFR Part 396 — Inspection, Repair, and Maintenance.
 *     tags:
 *       - Roadside
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Roadside call ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               storage_key:
 *                 type: string
 *               file_name:
 *                 type: string
 *               content_type:
 *                 type: string
 *               label:
 *                 type: string
 *     responses:
 *       201:
 *         description: Media record created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
// POST /api/roadside/calls/:id/media
router.post('/calls/:id/media', async (req, res) => {
  try {
    const userId = req.context?.userId || req.user?.id || null;
    const media = await roadsideService.addMedia(req.params.id, req.body, userId, req.context);
    res.status(201).json(media);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/roadside/calls/{id}/public-link:
 *   post:
 *     summary: Create a public link for a roadside call
 *     description: Generates a shareable public token/link for external parties (e.g., drivers) to view and upload media for a roadside call. Per 49 CFR Part 396 — Inspection, Repair, and Maintenance.
 *     tags:
 *       - Roadside
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Roadside call ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               expires_in_hours:
 *                 type: integer
 *                 description: Number of hours until the link expires
 *     responses:
 *       200:
 *         description: Public link details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                 url:
 *                   type: string
 *                 expires_at:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
// POST /api/roadside/calls/:id/public-link
router.post('/calls/:id/public-link', async (req, res) => {
  try {
    const userId = req.context?.userId || req.user?.id || null;
    const link = await roadsideService.createPublicToken(req.params.id, req.body, userId, req.context);
    res.json(link);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/roadside/calls/{id}/notify:
 *   post:
 *     summary: Send a notification for a roadside call
 *     description: Triggers a notification (email, SMS, etc.) related to a roadside call. Per 49 CFR Part 396 — Inspection, Repair, and Maintenance.
 *     tags:
 *       - Roadside
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Roadside call ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *               recipients:
 *                 type: array
 *                 items:
 *                   type: string
 *               message:
 *                 type: string
 *     responses:
 *       200:
 *         description: Notification sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
// POST /api/roadside/calls/:id/notify
router.post('/calls/:id/notify', async (req, res) => {
  try {
    const userId = req.context?.userId || req.user?.id || null;
    const result = await roadsideService.notifyCall(req.params.id, req.body, userId, req.context);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/roadside/calls/{id}/timeline:
 *   get:
 *     summary: Get the timeline of a roadside call
 *     description: Retrieves the chronological event timeline for a roadside call, including status changes, dispatches, and notifications. Per 49 CFR Part 396 — Inspection, Repair, and Maintenance.
 *     tags:
 *       - Roadside
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Roadside call ID
 *     responses:
 *       200:
 *         description: Call timeline events
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   event_type:
 *                     type: string
 *                   timestamp:
 *                     type: string
 *                     format: date-time
 *                   details:
 *                     type: object
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Call not found
 *       500:
 *         description: Server error
 */
// GET /api/roadside/calls/:id/timeline
router.get('/calls/:id/timeline', async (req, res) => {
  try {
    const timeline = await roadsideService.getTimeline(req.params.id, req.context);
    if (!timeline) return res.status(404).json({ error: 'Not found' });
    return res.json(timeline);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/roadside/calls/{id}/ai-call:
 *   post:
 *     summary: Initiate an AI voice call for a roadside call
 *     description: Triggers an outbound AI-powered Twilio voice call to the caller's phone number for automated triage questions. Per 49 CFR Part 396 — Inspection, Repair, and Maintenance.
 *     tags:
 *       - Roadside
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Roadside call ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - toPhone
 *             properties:
 *               toPhone:
 *                 type: string
 *                 description: Phone number to call
 *               message:
 *                 type: string
 *                 description: Optional custom message
 *               autoAnswer:
 *                 type: boolean
 *                 description: Whether to auto-answer
 *     responses:
 *       200:
 *         description: AI call initiated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 callSid:
 *                   type: string
 *       400:
 *         description: Validation error or call initiation failure
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
// POST /api/roadside/calls/:id/ai-call
// Initiate an AI voice call to the caller's phone number
router.post('/calls/:id/ai-call', async (req, res) => {
  try {
    const userId = req.context?.userId || req.user?.id || null;
    const { toPhone, message, autoAnswer } = req.body;

    if (!toPhone) {
      return res.status(400).json({ error: 'toPhone is required' });
    }

    const result = await roadsideService.initiateAiCall(req.params.id, toPhone, {
      message,
      autoAnswer,
      userId
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/roadside/calls/{id}/notify-dispatcher:
 *   post:
 *     summary: Notify dispatcher(s) of a new roadside call
 *     description: Sends notification email(s) to one or more dispatchers about a new roadside call. Per 49 CFR Part 396 — Inspection, Repair, and Maintenance.
 *     tags:
 *       - Roadside
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Roadside call ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - emails
 *             properties:
 *               emails:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: email
 *                 description: List of dispatcher email addresses
 *               url:
 *                 type: string
 *                 description: Link to the call detail page
 *     responses:
 *       200:
 *         description: Dispatcher notifications sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Validation error (emails required)
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
// POST /api/roadside/calls/:id/notify-dispatcher
// Send notification email(s) to dispatcher(s)
router.post('/calls/:id/notify-dispatcher', async (req, res) => {
  try {
    const { emails, url } = req.body;

    if (!emails || emails.length === 0) {
      return res.status(400).json({ error: 'emails array is required' });
    }

    const result = await roadsideService.notifyDispatcherNewCall(
      req.params.id,
      { emails, url }
    );

    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/roadside/calls/{id}/notify-dispatch-assigned:
 *   post:
 *     summary: Notify parties that dispatch has been assigned
 *     description: Sends notification emails when a dispatch resource is assigned to a roadside call. Per 49 CFR Part 396 — Inspection, Repair, and Maintenance.
 *     tags:
 *       - Roadside
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Roadside call ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               emails:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: email
 *               url:
 *                 type: string
 *     responses:
 *       200:
 *         description: Dispatch-assigned notifications sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
// POST /api/roadside/calls/:id/notify-dispatch-assigned
// Send notification emails when dispatch is assigned
router.post('/calls/:id/notify-dispatch-assigned', async (req, res) => {
  try {
    const result = await roadsideService.notifyDispatchAssigned(
      req.params.id,
      req.body
    );

    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/roadside/calls/{id}/notify-resolved:
 *   post:
 *     summary: Notify parties that a roadside call is resolved
 *     description: Sends notification emails when a roadside call has been resolved. Per 49 CFR Part 396 — Inspection, Repair, and Maintenance.
 *     tags:
 *       - Roadside
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Roadside call ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               emails:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: email
 *               url:
 *                 type: string
 *     responses:
 *       200:
 *         description: Resolved notifications sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
// POST /api/roadside/calls/:id/notify-resolved
// Send notification emails when call is resolved
router.post('/calls/:id/notify-resolved', async (req, res) => {
  try {
    const result = await roadsideService.notifyCallResolved(
      req.params.id,
      req.body
    );

    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/roadside/calls/{id}/notify-payment-contact:
 *   post:
 *     summary: Send billing notification to payment contact
 *     description: Sends a billing notification email to the payment contact associated with a roadside call. Per 49 CFR Part 396 — Inspection, Repair, and Maintenance.
 *     tags:
 *       - Roadside
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Roadside call ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               url:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment contact notified
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
// POST /api/roadside/calls/:id/notify-payment-contact
// Send billing notification to payment contact
router.post('/calls/:id/notify-payment-contact', async (req, res) => {
  try {
    const result = await roadsideService.notifyPaymentContact(
      req.params.id,
      req.body
    );

    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /api/roadside/calls/{id}/recording:
 *   get:
 *     summary: Get the Twilio call recording for a roadside call
 *     description: Retrieves the Twilio voice recording URL for an AI-initiated roadside call, if available. Per 49 CFR Part 396 — Inspection, Repair, and Maintenance.
 *     tags:
 *       - Roadside
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Roadside call ID
 *     responses:
 *       200:
 *         description: Recording URL
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 recording_url:
 *                   type: string
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: No recording found
 *       500:
 *         description: Server error
 */
// GET /api/roadside/calls/:id/recording
// Get Twilio call recording URL if available
router.get('/calls/:id/recording', async (req, res) => {
  try {
    const recordingUrl = await roadsideService.getTwilioCallRecording(req.params.id);

    if (!recordingUrl) {
      return res.status(404).json({ error: 'No recording found' });
    }

    res.json({ recording_url: recordingUrl });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
