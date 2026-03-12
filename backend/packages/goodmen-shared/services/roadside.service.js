const db = require('../internal/db').knex;
const dtLogger = require('../utils/logger');
const { generateToken, hashToken } = require('./token-service');
const notifications = require('./notification-service');
const { getSignedUploadUrl } = require('../storage/r2-storage');
const workOrdersService = require('./work-orders.service');
const twilioService = require('./twilio.service');
const roadsideEmailService = require('./roadside-email.service');
const {
  normalizeRoadsideCallDraft,
  normalizeEnum,
  ROADSIDE_CALL_STATUS,
  ROADSIDE_CALL_URGENCY,
  ROADSIDE_INTAKE_SOURCE,
  ROADSIDE_DISPATCH_STATUS,
  ROADSIDE_WORK_ORDER_LINK_STATUS,
  resolveConfidenceTier
} = require('./roadside-domain');

const DEFAULT_INBOUND_AI_QUESTIONS = Object.freeze([
  'Can you briefly describe what happened to the vehicle?',
  'Is the driver currently in a safe location?',
  'Are there immediate hazards such as smoke, leaking fluids, or traffic exposure?',
  'What is the vehicle or unit number involved?',
  'Do you need roadside repair, a tow, or both?',
  'What is your exact location or nearest landmark?'
]);

function scopeCallsQuery(queryBuilder, context = {}, tableAlias = 'roadside_calls') {
  if (!context?.isGlobalAdmin && context?.tenantId) {
    queryBuilder.andWhere(`${tableAlias}.tenant_id`, context.tenantId);
  }

  if (!context?.isGlobalAdmin && context?.allowedOperatingEntityIds?.length) {
    queryBuilder.whereIn(`${tableAlias}.operating_entity_id`, context.allowedOperatingEntityIds);
  }
}

function getPublicBaseUrl() {
  return (process.env.PUBLIC_APP_BASE_URL || process.env.APP_BASE_URL || 'http://localhost:4200').replace(/\/$/, '');
}

function buildPublicRoadsideUrl(callId, token) {
  return `${getPublicBaseUrl()}/roadside/${callId}?token=${encodeURIComponent(token)}`;
}

async function generateCallNumber(trx) {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = `${now.getUTCMonth() + 1}`.padStart(2, '0');
  const d = `${now.getUTCDate()}`.padStart(2, '0');
  const prefix = `RS-${y}${m}${d}`;

  const latest = await trx('roadside_calls')
    .where('call_number', 'like', `${prefix}-%`)
    .orderBy('created_at', 'desc')
    .first('call_number');

  const seq = latest?.call_number ? Number(latest.call_number.split('-').pop()) + 1 : 1;
  const padded = `${seq}`.padStart(4, '0');
  return `${prefix}-${padded}`;
}

async function assertCallAccess(trx, callId, context = {}, forUpdate = false) {
  const query = trx('roadside_calls').where('id', callId).modify((qb) => scopeCallsQuery(qb, context));
  if (forUpdate) query.forUpdate();
  const row = await query.first();
  if (!row) throw new Error('Roadside call not found');
  return row;
}

async function logEvent(trx, callId, eventType, actorType = 'SYSTEM', actorId = null, payload = {}, sessionId = null) {
  await trx('roadside_event_logs').insert({
    call_id: callId,
    session_id: sessionId,
    actor_type: actorType,
    actor_id: actorId,
    event_type: eventType,
    event_payload: payload || {}
  });
}

function getAiQuestionsFromCall(call = {}, events = []) {
  const snapshotQuestions = call?.location_snapshot?.ai_intake?.questions;
  if (Array.isArray(snapshotQuestions) && snapshotQuestions.length) {
    return snapshotQuestions;
  }

  const eventQuestions = events.find((event) => Array.isArray(event?.event_payload?.questions))?.event_payload?.questions;
  if (Array.isArray(eventQuestions) && eventQuestions.length) {
    return eventQuestions;
  }

  return [];
}

function enrichCallWithAiQuestions(call = {}, events = []) {
  const aiQuestions = getAiQuestionsFromCall(call, events);
  return {
    ...call,
    ai_questions: aiQuestions,
    ai_questions_preview: aiQuestions.slice(0, 3)
  };
}

function buildQaHistory(transcript = []) {
  if (!Array.isArray(transcript) || !transcript.length) return [];

  const buckets = new Map();

  transcript.forEach((entry) => {
    const questionIndex = Number.isFinite(Number(entry?.question_index))
      ? Number(entry.question_index)
      : null;

    if (questionIndex == null) return;

    if (!buckets.has(questionIndex)) {
      buckets.set(questionIndex, {
        question_index: questionIndex,
        question: null,
        answer: null,
        answer_confidence: null,
        answer_input_type: null,
        asked_at: null,
        answered_at: null
      });
    }

    const bucket = buckets.get(questionIndex);
    if ((entry?.role === 'assistant' || entry?.type === 'question') && entry?.text) {
      bucket.question = entry.text;
      bucket.asked_at = entry.timestamp || bucket.asked_at;
    }

    if ((entry?.role === 'driver' || entry?.type === 'answer') && entry?.text) {
      bucket.answer = entry.text;
      bucket.answered_at = entry.timestamp || bucket.answered_at;
      bucket.answer_confidence = entry.confidence ?? bucket.answer_confidence;
      bucket.answer_input_type = entry.input_type || bucket.answer_input_type;
    }
  });

  return Array.from(buckets.values()).sort((a, b) => a.question_index - b.question_index);
}

function enrichCallWithQaHistory(call = {}, transcript = []) {
  const aiQaHistory = buildQaHistory(transcript);
  const aiAnswersPreview = aiQaHistory
    .filter((entry) => !!entry.answer)
    .map((entry) => ({ question_index: entry.question_index, answer: entry.answer }))
    .slice(0, 3);

  return {
    ...call,
    ai_qa_history: aiQaHistory,
    ai_answers_preview: aiAnswersPreview
  };
}

async function getOrCreateActiveSession(callId, options = {}) {
  let session = await db('roadside_sessions')
    .where({ call_id: callId, session_status: 'ACTIVE' })
    .orderBy('started_at', 'desc')
    .first();

  if (session) return session;

  const [created] = await db('roadside_sessions')
    .insert({
      call_id: callId,
      session_status: 'ACTIVE',
      ai_model: options.ai_model || 'twilio-voice-intake',
      prompt_version: options.prompt_version || 'twilio-v1',
      transcript: JSON.stringify([])
    })
    .returning('*');

  return created;
}

async function appendSessionTranscript(callId, entry = {}, options = {}) {
  if (!callId) return null;

  return db.transaction(async (trx) => {
    let session = null;

    if (options.sessionId) {
      session = await trx('roadside_sessions').where({ id: options.sessionId }).first();
    }

    if (!session) {
      session = await trx('roadside_sessions')
        .where({ call_id: callId, session_status: 'ACTIVE' })
        .orderBy('started_at', 'desc')
        .first();
    }

    if (!session) {
      const [created] = await trx('roadside_sessions')
        .insert({
          call_id: callId,
          session_status: 'ACTIVE',
          ai_model: options.ai_model || 'twilio-voice-intake',
          prompt_version: options.prompt_version || 'twilio-v1',
          transcript: JSON.stringify([])
        })
        .returning('*');
      session = created;
    }

    let existingTranscript = session.transcript;
    if (typeof existingTranscript === 'string') {
      try {
        existingTranscript = JSON.parse(existingTranscript);
      } catch (_) {
        existingTranscript = [];
      }
    }

    const transcript = Array.isArray(existingTranscript) ? [...existingTranscript] : [];
    transcript.push({
      timestamp: new Date().toISOString(),
      role: entry.role || 'system',
      type: entry.type || null,
      text: entry.text || '',
      question_index: Number.isFinite(Number(entry.question_index)) ? Number(entry.question_index) : null,
      call_sid: entry.call_sid || null,
      input_type: entry.input_type || null,
      confidence: entry.confidence ?? null
    });

    await trx('roadside_sessions')
      .where({ id: session.id })
      .update({
        transcript: JSON.stringify(transcript),
        updated_at: trx.fn.now()
      });

    return session.id;
  });
}

async function appendInboundAiQuestion(callId, payload = {}) {
  return appendSessionTranscript(callId, {
    role: 'assistant',
    type: 'question',
    text: payload.question || '',
    question_index: payload.question_index,
    call_sid: payload.call_sid || null
  });
}

async function appendInboundAiAnswer(callId, payload = {}) {
  return appendSessionTranscript(callId, {
    role: 'driver',
    type: 'answer',
    text: payload.answer || '',
    question_index: payload.question_index,
    call_sid: payload.call_sid || null,
    input_type: payload.input_type || null,
    confidence: payload.confidence ?? null
  });
}

async function endActiveSession(callId) {
  if (!callId) return;

  await db('roadside_sessions')
    .where({ call_id: callId, session_status: 'ACTIVE' })
    .update({
      session_status: 'ENDED',
      ended_at: db.fn.now(),
      updated_at: db.fn.now()
    });
}

async function createCall(payload = {}, userId = null, context = {}) {
  return db.transaction(async (trx) => {
    const normalized = normalizeRoadsideCallDraft(payload);
    const callNumber = await generateCallNumber(trx);

    const [created] = await trx('roadside_calls')
      .insert({
        call_number: callNumber,
        tenant_id: context?.tenantId || null,
        operating_entity_id: context?.operatingEntityId || null,
        source_channel: normalized.source_channel,
        caller_name: normalized.caller_name,
        caller_phone: normalized.caller_phone,
        caller_email: normalized.caller_email,
        driver_id: payload.driver_id || null,
        customer_id: payload.customer_id || null,
        unit_id: payload.unit_id || null,
        trailer_id: payload.trailer_id || null,
        issue_type: normalized.issue_type,
        incident_summary: normalized.incident_summary,
        urgency: normalized.urgency,
        status: normalized.status,
        location_snapshot: payload.location_snapshot || {},
        created_by: userId || null,
        updated_by: userId || null
      })
      .returning('*');

    await logEvent(trx, created.id, 'CALL_CREATED', 'USER', userId, {
      source_channel: created.source_channel,
      urgency: created.urgency,
      status: created.status
    });

    return created;
  });
}

async function findCallByTwilioCallSid(callSid) {
  if (!callSid) return null;

  const event = await db('roadside_event_logs')
    .whereRaw("event_payload ->> 'twilio_call_sid' = ?", [callSid])
    .orderBy('occurred_at', 'desc')
    .first('call_id');

  if (!event?.call_id) return null;

  return db('roadside_calls').where({ id: event.call_id }).first();
}

async function createInboundTwilioCall(callData = {}) {
  const existingCall = await findCallByTwilioCallSid(callData.callSid);
  if (existingCall) {
    return existingCall;
  }

  return db.transaction(async (trx) => {
    const normalized = normalizeRoadsideCallDraft({
      source_channel: 'PHONE',
      caller_phone: callData.from || null,
      incident_summary: 'Inbound Twilio voice call received'
    });
    const aiQuestions = [...DEFAULT_INBOUND_AI_QUESTIONS];
    const callNumber = await generateCallNumber(trx);

    const [created] = await trx('roadside_calls')
      .insert({
        call_number: callNumber,
        tenant_id: null,
        operating_entity_id: null,
        source_channel: normalized.source_channel,
        caller_name: normalized.caller_name,
        caller_phone: normalized.caller_phone,
        caller_email: normalized.caller_email,
        driver_id: null,
        customer_id: null,
        unit_id: null,
        trailer_id: null,
        issue_type: normalized.issue_type,
        incident_summary: normalized.incident_summary,
        urgency: normalized.urgency,
        status: normalized.status,
        location_snapshot: {
          ai_intake: {
            source: 'TWILIO_VOICE',
            status: 'ASKED',
            questions: aiQuestions
          },
          twilio: {
            call_sid: callData.callSid || null,
            account_sid: callData.accountSid || null,
            to: callData.to || null,
            from: callData.from || null,
            direction: callData.direction || null,
            initial_status: callData.callStatus || null,
            api_version: callData.apiVersion || null
          }
        },
        created_by: null,
        updated_by: null
      })
      .returning('*');

    await logEvent(trx, created.id, 'CALL_CREATED', 'SYSTEM', null, {
      source_channel: created.source_channel,
      urgency: created.urgency,
      status: created.status,
      created_from: 'TWILIO_INBOUND'
    });

    await logEvent(trx, created.id, 'TWILIO_INBOUND_CALL_RECEIVED', 'SYSTEM', null, {
      twilio_call_sid: callData.callSid || null,
      twilio_account_sid: callData.accountSid || null,
      from_phone: callData.from || null,
      to_phone: callData.to || null,
      call_status: callData.callStatus || null,
      direction: callData.direction || null,
      api_version: callData.apiVersion || null,
      questions: aiQuestions
    });

    return created;
  });
}

async function logTwilioCallStatus(callId, statusData = {}) {
  if (!callId) return;

  await db('roadside_event_logs').insert({
    call_id: callId,
    event_type: 'TWILIO_CALL_STATUS_UPDATED',
    actor_type: 'SYSTEM',
    actor_id: null,
    occurred_at: db.fn.now(),
    event_payload: {
      twilio_call_sid: statusData.callSid || null,
      call_status: statusData.callStatus || null,
      call_duration: statusData.callDuration || null,
      recording_url: statusData.recordingUrl || null,
      recording_sid: statusData.recordingSid || null
    }
  });
}

async function logTwilioRecording(callId, recordingData = {}) {
  if (!callId) return;

  await db('roadside_event_logs').insert({
    call_id: callId,
    event_type: 'TWILIO_RECORDING_AVAILABLE',
    actor_type: 'SYSTEM',
    actor_id: null,
    occurred_at: db.fn.now(),
    event_payload: {
      twilio_call_sid: recordingData.callSid || null,
      recording_sid: recordingData.recordingSid || null,
      recording_url: recordingData.recordingUrl || null,
      recording_status: recordingData.recordingStatus || null,
      recording_duration: recordingData.recordingDuration || null
    }
  });
}

async function listCalls(filters = {}, context = {}) {
  const limit = Math.min(Math.max(Number(filters.limit || 25), 1), 100);
  const query = db('roadside_calls').modify((qb) => scopeCallsQuery(qb, context));

  if (filters.status) {
    query.andWhere('status', normalizeEnum(filters.status, ROADSIDE_CALL_STATUS, 'OPEN'));
  }
  if (filters.urgency) {
    query.andWhere('urgency', normalizeEnum(filters.urgency, ROADSIDE_CALL_URGENCY, 'NORMAL'));
  }
  if (filters.driver_id) {
    query.andWhere('driver_id', filters.driver_id);
  }

  const rows = await query.orderBy('opened_at', 'desc').limit(limit);
  if (!rows.length) return rows;

  const callIds = rows.map((row) => row.id).filter(Boolean);
  const sessions = await db('roadside_sessions')
    .whereIn('call_id', callIds)
    .orderBy('updated_at', 'desc');

  const latestSessionByCallId = new Map();
  sessions.forEach((session) => {
    if (!latestSessionByCallId.has(session.call_id)) {
      latestSessionByCallId.set(session.call_id, session);
    }
  });

  return rows.map((row) => {
    const base = enrichCallWithAiQuestions(row);
    const session = latestSessionByCallId.get(row.id);
    return enrichCallWithQaHistory(base, session?.transcript || []);
  });
}

async function getCall(callId, context = {}) {
  const call = await db('roadside_calls')
    .where('id', callId)
    .modify((qb) => scopeCallsQuery(qb, context))
    .first();
  if (!call) return null;

  const [latestIntake, latestAssessment, latestDispatch, workOrderLink, recentEvents] = await Promise.all([
    db('roadside_intakes').where({ call_id: callId }).first(),
    db('roadside_ai_assessments').where({ call_id: callId }).orderBy('created_at', 'desc').first(),
    db('roadside_dispatch_assignments').where({ call_id: callId }).orderBy('created_at', 'desc').first(),
    db('roadside_work_order_links').where({ roadside_call_id: callId }).first(),
    db('roadside_event_logs').where({ call_id: callId }).orderBy('occurred_at', 'desc').limit(50)
  ]);

  const latestSession = await db('roadside_sessions')
    .where({ call_id: callId })
    .orderBy('updated_at', 'desc')
    .first();

  const enrichedCall = enrichCallWithQaHistory(
    enrichCallWithAiQuestions(call, recentEvents || []),
    latestSession?.transcript || []
  );

  return {
    ...enrichedCall,
    intake: latestIntake || null,
    ai_assessment: latestAssessment || null,
    dispatch: latestDispatch || null,
    work_order_link: workOrderLink || null,
    recent_events: recentEvents || []
  };
}

async function setStatus(callId, status, userId = null, context = {}) {
  const normalizedStatus = normalizeEnum(status, ROADSIDE_CALL_STATUS, 'OPEN');
  return db.transaction(async (trx) => {
    const call = await assertCallAccess(trx, callId, context, true);

    const patch = {
      status: normalizedStatus,
      updated_at: trx.fn.now(),
      updated_by: userId || call.updated_by
    };
    if (normalizedStatus === 'RESOLVED' || normalizedStatus === 'CANCELED') {
      patch.closed_at = trx.fn.now();
    }

    await trx('roadside_calls').where({ id: callId }).update(patch);
    await logEvent(trx, callId, 'STATUS_UPDATED', 'USER', userId, {
      from: call.status,
      to: normalizedStatus
    });

    return trx('roadside_calls').where({ id: callId }).first();
  });
}

async function triage(callId, payload = {}, userId = null, context = {}) {
  return db.transaction(async (trx) => {
    await assertCallAccess(trx, callId, context, true);

    const intakeSource = normalizeEnum(payload.intake_source, ROADSIDE_INTAKE_SOURCE, 'AI_AGENT');

    await trx('roadside_intakes')
      .insert({
        call_id: callId,
        intake_source: intakeSource,
        intake_payload: payload.intake_payload || {},
        symptoms: payload.symptoms || null,
        requires_tow: !!payload.requires_tow,
        safety_risk: !!payload.safety_risk,
        recommended_action: payload.recommended_action || null
      })
      .onConflict('call_id')
      .merge({
        intake_source: intakeSource,
        intake_payload: payload.intake_payload || {},
        symptoms: payload.symptoms || null,
        requires_tow: !!payload.requires_tow,
        safety_risk: !!payload.safety_risk,
        recommended_action: payload.recommended_action || null,
        updated_at: trx.fn.now(),
        captured_at: trx.fn.now()
      });

    const confidenceScore = payload.confidence_score == null ? null : Number(payload.confidence_score);
    const [assessment] = await trx('roadside_ai_assessments')
      .insert({
        call_id: callId,
        assessment_version: Number(payload.assessment_version || 1),
        model_name: payload.model_name || null,
        prompt_version: payload.prompt_version || null,
        confidence_score: Number.isFinite(confidenceScore) ? confidenceScore : null,
        risk_level: normalizeEnum(payload.risk_level, ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], 'LOW'),
        requires_human_review: payload.requires_human_review == null
          ? resolveConfidenceTier(confidenceScore) === 'LOW_CONFIDENCE'
          : !!payload.requires_human_review,
        reasoning: payload.reasoning || null,
        recommendation: payload.recommendation || {}
      })
      .returning('*');

    const callPatch = {
      status: 'TRIAGED',
      urgency: normalizeEnum(payload.urgency, ROADSIDE_CALL_URGENCY, 'NORMAL'),
      updated_at: trx.fn.now(),
      updated_by: userId
    };
    if (payload.issue_type) callPatch.issue_type = payload.issue_type;

    await trx('roadside_calls')
      .where({ id: callId })
      .update(callPatch);

    await logEvent(trx, callId, 'TRIAGE_COMPLETED', 'AI', userId, {
      confidence_score: assessment.confidence_score,
      risk_level: assessment.risk_level,
      requires_human_review: assessment.requires_human_review
    });

    return getCall(callId, context);
  });
}

async function assignDispatch(callId, payload = {}, userId = null, context = {}) {
  return db.transaction(async (trx) => {
    await assertCallAccess(trx, callId, context, true);

    const [assignment] = await trx('roadside_dispatch_assignments')
      .insert({
        call_id: callId,
        assigned_driver_id: payload.assigned_driver_id || null,
        assigned_vendor_name: payload.assigned_vendor_name || null,
        assigned_vendor_phone: payload.assigned_vendor_phone || null,
        dispatch_status: normalizeEnum(payload.dispatch_status, ROADSIDE_DISPATCH_STATUS, 'PENDING'),
        eta_minutes: payload.eta_minutes ?? null,
        dispatched_at: payload.dispatched_at || trx.fn.now(),
        notes: payload.notes || null,
        created_by: userId
      })
      .returning('*');

    await trx('roadside_calls').where({ id: callId }).update({
      status: assignment.dispatch_status === 'CANCELED' ? 'CANCELED' : 'DISPATCHED',
      updated_by: userId,
      updated_at: trx.fn.now()
    });

    await logEvent(trx, callId, 'DISPATCH_ASSIGNED', 'DISPATCHER', userId, {
      assignment_id: assignment.id,
      dispatch_status: assignment.dispatch_status,
      assigned_driver_id: assignment.assigned_driver_id,
      assigned_vendor_name: assignment.assigned_vendor_name
    });

    return getCall(callId, context);
  });
}

async function resolveCall(callId, payload = {}, userId = null, context = {}) {
  return db.transaction(async (trx) => {
    const call = await assertCallAccess(trx, callId, context, true);

    await trx('roadside_calls').where({ id: callId }).update({
      status: 'RESOLVED',
      closed_at: payload.closed_at || trx.fn.now(),
      updated_by: userId,
      updated_at: trx.fn.now()
    });

    if (payload.payment) {
      await trx('roadside_payments').insert({
        call_id: callId,
        payer_type: normalizeEnum(payload.payment.payer_type, ['COMPANY', 'DRIVER', 'CUSTOMER', 'INSURANCE', 'OTHER'], 'COMPANY'),
        payment_status: normalizeEnum(payload.payment.payment_status, ['UNPAID', 'PENDING', 'AUTHORIZED', 'PAID', 'FAILED', 'REFUNDED'], 'UNPAID'),
        amount: Number(payload.payment.amount || 0),
        currency: payload.payment.currency || 'USD',
        payment_method: payload.payment.payment_method || null,
        external_reference: payload.payment.external_reference || null,
        authorized_at: payload.payment.authorized_at || null,
        paid_at: payload.payment.paid_at || null,
        metadata: payload.payment.metadata || {}
      });
    }

    await logEvent(trx, callId, 'CALL_RESOLVED', 'USER', userId, {
      previous_status: call.status,
      resolution: payload.resolution || null
    });

    return getCall(callId, context);
  });
}

async function linkWorkOrder(callId, payload = {}, userId = null, context = {}) {
  const call = await db('roadside_calls')
    .where('id', callId)
    .modify((qb) => scopeCallsQuery(qb, context))
    .first();
  if (!call) throw new Error('Roadside call not found');

  let workOrderId = payload.work_order_id || null;
  let failureReason = payload.failure_reason || null;

  if (!workOrderId && payload.auto_create_work_order) {
    try {
      const created = await workOrdersService.createWorkOrder({
        vehicleId: payload.vehicle_id || call.unit_id,
        customerId: payload.customer_id || call.customer_id,
        locationId: payload.location_id,
        type: payload.work_order_type || 'OTHER',
        priority: payload.work_order_priority || (call.urgency === 'CRITICAL' ? 'URGENT' : 'HIGH'),
        status: payload.work_order_status || 'open',
        description: payload.work_order_description || call.incident_summary || `Roadside call ${call.call_number}`,
        odometerMiles: payload.odometer_miles || null
      }, userId, context);
      workOrderId = created?.id || null;
    } catch (error) {
      failureReason = error.message;
      dtLogger.warn('roadside_work_order_auto_create_failed', {
        callId,
        error: error.message
      });
    }
  }

  return db.transaction(async (trx) => {
    await assertCallAccess(trx, callId, context, true);

    const fallbackStatus = workOrderId ? 'LINKED' : (failureReason ? 'FAILED' : 'PENDING');
    const linkStatus = normalizeEnum(payload.link_status, ROADSIDE_WORK_ORDER_LINK_STATUS, fallbackStatus);

    const [link] = await trx('roadside_work_order_links')
      .insert({
        roadside_call_id: callId,
        work_order_id: workOrderId,
        link_status: linkStatus,
        failure_reason: failureReason,
        linked_at: workOrderId ? trx.fn.now() : null
      })
      .onConflict('roadside_call_id')
      .merge({
        work_order_id: workOrderId,
        link_status: linkStatus,
        failure_reason: failureReason,
        linked_at: workOrderId ? trx.fn.now() : null,
        updated_at: trx.fn.now()
      })
      .returning('*');

    await logEvent(trx, callId, 'WORK_ORDER_LINK_UPDATED', 'USER', userId, {
      work_order_id: link.work_order_id,
      link_status: link.link_status,
      auto_create_work_order: !!payload.auto_create_work_order
    });

    return link;
  });
}

async function createMediaUploadUrl(callId, payload = {}, userId = null, context = {}) {
  const call = await db('roadside_calls')
    .where('id', callId)
    .modify((qb) => scopeCallsQuery(qb, context))
    .first();
  if (!call) throw new Error('Roadside call not found');

  const safeFileName = String(payload.file_name || 'media-upload').replace(/[^a-zA-Z0-9_.-]/g, '_');
  const mediaType = normalizeEnum(payload.media_type, ['PHOTO', 'VIDEO', 'AUDIO', 'DOCUMENT'], 'PHOTO');
  const key = `roadside/${callId}/${Date.now()}-${safeFileName}`;
  const signed = await getSignedUploadUrl({
    key,
    contentType: payload.content_type || 'application/octet-stream',
    expiresInSeconds: payload.expires_in_seconds || 900
  });

  await db('roadside_event_logs').insert({
    call_id: callId,
    actor_type: 'USER',
    actor_id: userId || null,
    event_type: 'MEDIA_UPLOAD_URL_CREATED',
    event_payload: {
      key: signed.key,
      media_type: mediaType,
      expires_in: signed.expiresIn
    }
  });

  return {
    upload_url: signed.url,
    storage_key: signed.key,
    expires_in: signed.expiresIn,
    media_type: mediaType
  };
}

async function createPublicMediaUploadUrl(token, payload = {}) {
  const call = await getPublicCallByToken(token);
  if (!call) throw new Error('Invalid or expired token');

  const safeFileName = String(payload.file_name || 'media-upload').replace(/[^a-zA-Z0-9_.-]/g, '_');
  const mediaType = normalizeEnum(payload.media_type, ['PHOTO', 'VIDEO', 'AUDIO', 'DOCUMENT'], 'PHOTO');
  const key = `roadside/${call.call_id}/public/${Date.now()}-${safeFileName}`;
  const signed = await getSignedUploadUrl({
    key,
    contentType: payload.content_type || 'application/octet-stream',
    expiresInSeconds: payload.expires_in_seconds || 900
  });

  await db('roadside_event_logs').insert({
    call_id: call.call_id,
    actor_type: 'DRIVER',
    actor_id: payload.uploaded_by_driver_id || null,
    event_type: 'PUBLIC_MEDIA_UPLOAD_URL_CREATED',
    event_payload: {
      key: signed.key,
      media_type: mediaType,
      expires_in: signed.expiresIn
    }
  });

  return {
    upload_url: signed.url,
    storage_key: signed.key,
    expires_in: signed.expiresIn,
    media_type: mediaType,
    call_id: call.call_id
  };
}

async function createPublicToken(callId, options = {}, userId = null, context = {}) {
  return db.transaction(async (trx) => {
    await assertCallAccess(trx, callId, context, true);

    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = options.expires_at || new Date(Date.now() + (Number(options.ttl_hours || 24) * 60 * 60 * 1000));

    await trx('roadside_public_link_tokens')
      .where({ call_id: callId, status: 'ACTIVE' })
      .update({ status: 'REVOKED' });

    const [saved] = await trx('roadside_public_link_tokens')
      .insert({
        call_id: callId,
        token_hash: tokenHash,
        status: 'ACTIVE',
        expires_at: expiresAt,
        created_by: userId || null
      })
      .returning('*');

    await logEvent(trx, callId, 'PUBLIC_LINK_CREATED', 'USER', userId, {
      token_id: saved.id,
      expires_at: saved.expires_at
    });

    const url = buildPublicRoadsideUrl(callId, token);
    return { token, url, expires_at: saved.expires_at, token_record_id: saved.id };
  });
}

async function notifyCall(callId, payload = {}, userId = null, context = {}) {
  const call = await getCall(callId, context);
  if (!call) throw new Error('Roadside call not found');

  const toPhone = payload.phone || call.caller_phone || null;
  const toEmail = payload.email || call.caller_email || null;
  const via = payload.via || 'both';
  const link = payload.link || null;

  const smsBody = payload.sms_body || `Roadside update for ${call.call_number}: ${call.status}${link ? `\n${link}` : ''}`;
  const emailSubject = payload.email_subject || `Roadside update: ${call.call_number}`;
  const emailText = payload.email_text || `Status: ${call.status}\nUrgency: ${call.urgency}${link ? `\nLink: ${link}` : ''}`;

  const [smsResult, emailResult] = await Promise.all([
    via === 'sms' || via === 'both' ? notifications.sendSms(toPhone, smsBody) : Promise.resolve({ sent: false }),
    via === 'email' || via === 'both'
      ? notifications.sendEmail({ to: toEmail, subject: emailSubject, text: emailText })
      : Promise.resolve({ sent: false })
  ]);

  await db('roadside_event_logs').insert({
    call_id: callId,
    actor_type: 'USER',
    actor_id: userId || null,
    event_type: 'NOTIFICATION_SENT',
    event_payload: {
      via,
      sms: smsResult,
      email: emailResult
    }
  });

  return { sms: smsResult, email: emailResult };
}

async function getPublicCallByToken(token) {
  const tokenHash = hashToken(token);
  if (!tokenHash) return null;

  const row = await db('roadside_public_link_tokens as t')
    .join('roadside_calls as c', 'c.id', 't.call_id')
    .where('t.token_hash', tokenHash)
    .where('t.status', 'ACTIVE')
    .where('t.expires_at', '>', db.fn.now())
    .select(
      't.id as token_id',
      't.call_id',
      'c.call_number',
      'c.caller_name',
      'c.caller_email',
      'c.caller_phone',
      'c.status',
      'c.urgency',
      'c.issue_type',
      'c.incident_summary',
      'c.location_snapshot',
      'c.opened_at'
    )
    .first();

  return row || null;
}

async function updatePublicContext(token, payload = {}) {
  return db.transaction(async (trx) => {
    const publicCall = await getPublicCallByToken(token);
    if (!publicCall) throw new Error('Invalid or expired token');

    const existingCall = await trx('roadside_calls').where({ id: publicCall.call_id }).first();
    if (!existingCall) throw new Error('Roadside call not found');

    const incomingSnapshot = {
      company_name: payload.company_name || null,
      payment_contact_name: payload.payment_contact_name || null,
      payment_email: payload.payment_email || null,
      payment_phone: payload.payment_phone || null,
      unit_number: payload.unit_number || null,
      dispatch_location_label: payload.dispatch_location_label || null,
      shared_location: payload.location && Number.isFinite(Number(payload.location.latitude)) && Number.isFinite(Number(payload.location.longitude))
        ? {
            latitude: Number(payload.location.latitude),
            longitude: Number(payload.location.longitude),
            accuracy_meters: payload.location.accuracy_meters == null ? null : Number(payload.location.accuracy_meters),
            captured_at: payload.location.captured_at || new Date().toISOString(),
            source: payload.location.source || 'BROWSER_GEOLOCATION'
          }
        : null
    };

    const mergedSnapshot = {
      ...(existingCall.location_snapshot || {}),
      ...Object.fromEntries(Object.entries(incomingSnapshot).filter(([, v]) => v !== null && v !== ''))
    };

    await trx('roadside_calls')
      .where({ id: publicCall.call_id })
      .update({
        caller_name: payload.caller_name || existingCall.caller_name,
        caller_email: payload.caller_email || existingCall.caller_email,
        caller_phone: payload.caller_phone || existingCall.caller_phone,
        incident_summary: payload.summary || existingCall.incident_summary,
        location_snapshot: mergedSnapshot,
        updated_at: trx.fn.now()
      });

    if (incomingSnapshot.shared_location) {
      await trx('roadside_locations').insert({
        call_id: publicCall.call_id,
        source: 'GPS',
        latitude: incomingSnapshot.shared_location.latitude,
        longitude: incomingSnapshot.shared_location.longitude,
        accuracy_meters: incomingSnapshot.shared_location.accuracy_meters,
        captured_at: incomingSnapshot.shared_location.captured_at,
        raw_payload: {
          source: incomingSnapshot.shared_location.source,
          dispatch_location_label: payload.dispatch_location_label || null
        }
      });
    }

    await logEvent(trx, publicCall.call_id, 'PUBLIC_CONTEXT_UPDATED', 'DRIVER', payload.uploaded_by_driver_id || null, {
      company_name: payload.company_name || null,
      payment_contact_name: payload.payment_contact_name || null,
      payment_email: payload.payment_email || null,
      payment_phone: payload.payment_phone || null,
      unit_number: payload.unit_number || null,
      has_location: !!incomingSnapshot.shared_location
    });

    return trx('roadside_calls')
      .where({ id: publicCall.call_id })
      .select(
        'id as call_id',
        'call_number',
        'caller_name',
        'caller_email',
        'caller_phone',
        'status',
        'urgency',
        'issue_type',
        'incident_summary',
        'location_snapshot',
        'opened_at'
      )
      .first();
  });
}

async function addPublicMedia(token, payload = {}) {
  return db.transaction(async (trx) => {
    const publicCall = await getPublicCallByToken(token);
    if (!publicCall) throw new Error('Invalid or expired token');

    const [row] = await trx('roadside_media')
      .insert({
        call_id: publicCall.call_id,
        session_id: payload.session_id || null,
        media_type: normalizeEnum(payload.media_type, ['PHOTO', 'VIDEO', 'AUDIO', 'DOCUMENT'], 'PHOTO'),
        storage_provider: payload.storage_provider || 'r2',
        storage_key: payload.storage_key,
        mime_type: payload.mime_type || null,
        size_bytes: payload.size_bytes || null,
        uploaded_by_driver_id: payload.uploaded_by_driver_id || null,
        uploaded_by_user_id: null,
        metadata: payload.metadata || {}
      })
      .returning('*');

    await logEvent(trx, publicCall.call_id, 'PUBLIC_MEDIA_ADDED', 'DRIVER', payload.uploaded_by_driver_id || null, {
      media_id: row.id,
      media_type: row.media_type
    });

    return row;
  });
}

async function addMedia(callId, payload = {}, userId = null, context = {}) {
  return db.transaction(async (trx) => {
    await assertCallAccess(trx, callId, context, true);
    if (!payload?.storage_key) throw new Error('storage_key is required');

    const [row] = await trx('roadside_media')
      .insert({
        call_id: callId,
        session_id: payload.session_id || null,
        media_type: normalizeEnum(payload.media_type, ['PHOTO', 'VIDEO', 'AUDIO', 'DOCUMENT'], 'PHOTO'),
        storage_provider: payload.storage_provider || 'r2',
        storage_key: payload.storage_key,
        mime_type: payload.mime_type || null,
        size_bytes: payload.size_bytes || null,
        uploaded_by_driver_id: payload.uploaded_by_driver_id || null,
        uploaded_by_user_id: userId || null,
        metadata: payload.metadata || {}
      })
      .returning('*');

    await logEvent(trx, callId, 'MEDIA_ADDED', 'USER', userId, {
      media_id: row.id,
      media_type: row.media_type
    });

    return row;
  });
}

async function markPublicTokenUsed(token) {
  const tokenHash = hashToken(token);
  if (!tokenHash) return false;

  const updated = await db('roadside_public_link_tokens')
    .where({ token_hash: tokenHash, status: 'ACTIVE' })
    .update({
      status: 'USED',
      used_at: db.fn.now()
    });

  return updated > 0;
}

async function getTimeline(callId, context = {}) {
  const call = await db('roadside_calls')
    .where('id', callId)
    .modify((qb) => scopeCallsQuery(qb, context))
    .first('id');

  if (!call) return null;

  const events = await db('roadside_event_logs')
    .where({ call_id: callId })
    .orderBy('occurred_at', 'asc');

  const locations = await db('roadside_locations')
    .where({ call_id: callId })
    .orderBy('captured_at', 'asc');

  return { call_id: callId, events, locations };
}

/**
 * Initiate an AI voice call to a phone number
 * Uses Twilio to make the call with TwiML instructions
 * @param {string} callId - Roadside call ID
 * @param {string} toPhone - Recipient phone number
 * @param {object} options
 * @param {string} [options.message] - Initial greeting message
 * @param {boolean} [options.autoAnswer] - Whether AI should auto-answer (default: true)
 * @param {string} [options.userId] - User ID initiating the call
 * @returns {Promise<{ success: boolean, twilio_call_sid?: string, error?: string }>}
 */
async function initiateAiCall(callId, toPhone, options = {}) {
  try {
    const call = await db('roadside_calls').where('id', callId).first();
    if (!call) throw new Error('Roadside call not found');

    // Default greeting message
    const defaultMessage = `Hello ${call.caller_name || 'there'}. This is FleetNeuron AI roadside support. We've received your incident report and are here to help. `;
    const message = options.message || defaultMessage;

    // Initiate Twilio call
    const result = await twilioService.initiateCall({
      toPhone,
      callId,
      callerName: call.caller_name,
      message
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to initiate Twilio call');
    }

    // Log event
    await db('roadside_event_logs').insert({
      call_id: callId,
      event_type: 'AI_CALL_INITIATED',
      actor_type: options.userId ? 'USER' : 'SYSTEM',
      actor_id: options.userId || null,
      occurred_at: db.fn.now(),
      event_payload: {
        twilio_call_sid: result.callSid,
        to_phone: toPhone,
        auto_answer: options.autoAnswer !== false
      }
    });

    dtLogger.info(`AI call initiated for roadside call ${callId} - Twilio SID: ${result.callSid}`);
    return { success: true, twilio_call_sid: result.callSid };
  } catch (error) {
    dtLogger.error(`Failed to initiate AI call for ${callId}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Send notification emails to dispatcher when a new call is created
 * @param {string} callId - Roadside call ID
 * @param {object} dispatcherContext - { emails: [], url: '' }
 * @returns {Promise<object>} Result with sent boolean and error details
 */
async function notifyDispatcherNewCall(callId, dispatcherContext = {}) {
  try {
    const call = await db('roadside_calls').where('id', callId).first();
    if (!call) throw new Error('Call not found');

    if (!dispatcherContext.emails || dispatcherContext.emails.length === 0) {
      dtLogger.debug(`No dispatcher emails configured for call ${callId}`);
      return { sent: true, skipped: true };
    }

    const dispatcherUrl = dispatcherContext.url ? `${dispatcherContext.url}?callId=${callId}` : null;
    const results = [];

    for (const email of dispatcherContext.emails) {
      const result = await roadsideEmailService.sendCallCreatedNotification({
        dispatcherEmail: email,
        callNumber: call.call_number,
        callerName: call.caller_name,
        callerPhone: call.caller_phone,
        issueType: call.issue_type || 'Unknown',
        urgency: call.urgency,
        location: call.location_snapshot?.dispatch_location_label,
        dispatcherUrl
      });
      results.push({ email, ...result });
    }

    return { sent: results.some(r => r.sent), results };
  } catch (error) {
    dtLogger.error(`Failed to notify dispatcher for call ${callId}: ${error.message}`);
    return { sent: false, error: error.message };
  }
}

/**
 * Send notification emails when dispatch is assigned
 * @param {string} callId - Roadside call ID
 * @param {object} notificationConfig
 * @param {string} [notificationConfig.driverEmail]
 * @param {string} [notificationConfig.driverPhone]
 * @param {string} [notificationConfig.vendorEmail]
 * @param {string} [notificationConfig.publicPortalUrl]
 * @returns {Promise<object>}
 */
async function notifyDispatchAssigned(callId, notificationConfig = {}) {
  try {
    const call = await db('roadside_calls').where('id', callId).first();
    const dispatch = await db('roadside_dispatch_assignments')
      .where('call_id', callId)
      .orderBy('created_at', 'desc')
      .first();

    if (!call || !dispatch) throw new Error('Call or dispatch not found');

    const result = await roadsideEmailService.sendDispatchAssignedNotification({
      driverEmail: notificationConfig.driverEmail || call.caller_email,
      driverPhone: notificationConfig.driverPhone || call.caller_phone,
      callNumber: call.call_number,
      vendorName: dispatch.assigned_vendor_name,
      vendorPhone: dispatch.assigned_vendor_phone,
      eta: dispatch.eta_minutes ? `${dispatch.eta_minutes} minutes` : 'TBD',
      vendorEmail: notificationConfig.vendorEmail,
      publicPortalUrl: notificationConfig.publicPortalUrl
    });

    dtLogger.info(`Dispatch assigned notification sent for call ${callId}`);
    return result;
  } catch (error) {
    dtLogger.error(`Failed to notify dispatch assigned for call ${callId}: ${error.message}`);
    return { sent: false, error: error.message };
  }
}

/**
 * Send notification emails when call is resolved
 * @param {string} callId - Roadside call ID
 * @param {object} notificationConfig
 * @param {string} [notificationConfig.driverEmail]
 * @param {string} [notificationConfig.resolutionNotes]
 * @param {string} [notificationConfig.dispatcherEmail]
 * @returns {Promise<object>}
 */
async function notifyCallResolved(callId, notificationConfig = {}) {
  try {
    const call = await db('roadside_calls').where('id', callId).first();
    if (!call) throw new Error('Call not found');

    const result = await roadsideEmailService.sendCallResolvedNotification({
      driverEmail: notificationConfig.driverEmail || call.caller_email,
      callNumber: call.call_number,
      resolutionNotes: notificationConfig.resolutionNotes,
      dispatcherEmail: notificationConfig.dispatcherEmail
    });

    dtLogger.info(`Call resolved notification sent for ${callId}`);
    return result;
  } catch (error) {
    dtLogger.error(`Failed to notify call resolved for ${callId}: ${error.message}`);
    return { sent: false, error: error.message };
  }
}

/**
 * Send billing/payment contact notification
 * @param {string} callId - Roadside call ID
 * @param {object} notificationConfig
 * @param {string} [notificationConfig.paymentEmail]
 * @param {string} [notificationConfig.estimatedCost]
 * @param {string} [notificationConfig.invoiceUrl]
 * @returns {Promise<object>}
 */
async function notifyPaymentContact(callId, notificationConfig = {}) {
  try {
    const call = await db('roadside_calls').where('id', callId).first();
    if (!call) throw new Error('Call not found');

    const paymentEmail = notificationConfig.paymentEmail ||
      call.location_snapshot?.payment_email ||
      call.caller_email;

    if (!paymentEmail) {
      return { sent: false, error: 'No payment email found' };
    }

    const result = await roadsideEmailService.sendPaymentContactNotification({
      paymentEmail,
      callNumber: call.call_number,
      companyName: call.location_snapshot?.company_name || 'N/A',
      estimatedCost: notificationConfig.estimatedCost,
      invoiceUrl: notificationConfig.invoiceUrl
    });

    dtLogger.info(`Payment contact notification sent for ${callId}`);
    return result;
  } catch (error) {
    dtLogger.error(`Failed to notify payment contact for ${callId}: ${error.message}`);
    return { sent: false, error: error.message };
  }
}

/**
 * Get Twilio call recording URL
 * @param {string} callId - Roadside call ID
 * @returns {Promise<string|null>}
 */
async function getTwilioCallRecording(callId) {
  try {
    const event = await db('roadside_event_logs')
      .where({ call_id: callId, event_type: 'AI_CALL_INITIATED' })
      .first();

    const twilioCallSid = event?.event_payload?.twilio_call_sid || event?.details?.twilio_call_sid;
    if (!twilioCallSid) return null;

    const recordingUrl = await twilioService.getCallRecordingUrl(twilioCallSid);
    return recordingUrl;
  } catch (error) {
    dtLogger.error(`Failed to get recording for ${callId}: ${error.message}`);
    return null;
  }
}

module.exports = {
  createCall,
  listCalls,
  getCall,
  setStatus,
  triage,
  assignDispatch,
  resolveCall,
  linkWorkOrder,
  createMediaUploadUrl,
  createPublicToken,
  notifyCall,
  getPublicCallByToken,
  updatePublicContext,
  createPublicMediaUploadUrl,
  addMedia,
  addPublicMedia,
  markPublicTokenUsed,
  getTimeline,
  findCallByTwilioCallSid,
  createInboundTwilioCall,
  getOrCreateActiveSession,
  appendSessionTranscript,
  appendInboundAiQuestion,
  appendInboundAiAnswer,
  endActiveSession,
  logTwilioCallStatus,
  logTwilioRecording,
  initiateAiCall,
  notifyDispatcherNewCall,
  notifyDispatchAssigned,
  notifyCallResolved,
  notifyPaymentContact,
  getTwilioCallRecording
};
