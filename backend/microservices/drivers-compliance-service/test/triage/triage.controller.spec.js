'use strict';

jest.mock('../../src/clients/ai-service.client');
jest.mock('../../src/services/triage.service');
jest.mock('../../src/telemetry/triage.telemetry');

const { postTriage, getTriage } = require('../../src/controllers/triage.controller');
const aiServiceClient = require('../../src/clients/ai-service.client');
const triageService = require('../../src/services/triage.service');
const triageTelemetry = require('../../src/telemetry/triage.telemetry');

function makeReqRes(overrides = {}) {
  const req = {
    params: { id: 'incident-abc' },
    context: { tenantId: 'tenant-xyz' },
    headers: { authorization: 'Bearer tok' },
    body: {},
    ...overrides,
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return { req, res };
}

const AI_RESULT = {
  severity: 'HIGH',
  category: 'TIRE',
  urgency: 'HIGH',
  vendor_skills: ['tire_repair'],
  rationale: 'Driver reported tire blowout at highway speed.',
  prompt_version: 'v1.0',
  model_name: 'claude-opus-4-8',
  cache_read_tokens: 1500,
  cache_creation_tokens: 0,
};

const PERSISTED_ROW = { id: 'triage-001', incident_id: 'incident-abc', tenant_id: 'tenant-xyz', ...AI_RESULT };

beforeEach(() => jest.clearAllMocks());

describe('postTriage', () => {
  it('calls AI service, persists result, returns 201', async () => {
    const { req, res } = makeReqRes();
    aiServiceClient.requestTriage.mockResolvedValue(AI_RESULT);
    triageService.persistTriageResult.mockResolvedValue(PERSISTED_ROW);
    triageTelemetry.recordTriageCall.mockReturnValue(undefined);

    await postTriage(req, res);

    expect(aiServiceClient.requestTriage).toHaveBeenCalledWith(
      expect.objectContaining({ incidentId: 'incident-abc', tenantId: 'tenant-xyz' })
    );
    expect(triageService.persistTriageResult).toHaveBeenCalledWith(
      expect.objectContaining({ incidentId: 'incident-abc', tenantId: 'tenant-xyz', result: AI_RESULT })
    );
    expect(triageTelemetry.recordTriageCall).toHaveBeenCalledWith(
      expect.objectContaining({ incidentId: 'incident-abc', tenantId: 'tenant-xyz', success: true })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(PERSISTED_ROW);
  });

  it('returns 400 when tenantId is missing', async () => {
    const { req, res } = makeReqRes({ context: {} });

    await postTriage(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing tenant context' });
    expect(aiServiceClient.requestTriage).not.toHaveBeenCalled();
  });

  it('returns 500 and records telemetry when AI service throws', async () => {
    const { req, res } = makeReqRes();
    aiServiceClient.requestTriage.mockRejectedValue(new Error('AI timeout'));

    await postTriage(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'AI timeout' });
    expect(triageTelemetry.recordTriageCall).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, errorCode: 'AI timeout' })
    );
  });

  it('returns 500 when DB persist throws', async () => {
    const { req, res } = makeReqRes();
    aiServiceClient.requestTriage.mockResolvedValue(AI_RESULT);
    triageService.persistTriageResult.mockRejectedValue(new Error('DB write failed'));

    await postTriage(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'DB write failed' });
  });
});

describe('getTriage', () => {
  it('returns the latest triage record', async () => {
    const { req, res } = makeReqRes();
    triageService.getLatestTriage.mockResolvedValue(PERSISTED_ROW);

    await getTriage(req, res);

    expect(triageService.getLatestTriage).toHaveBeenCalledWith({
      incidentId: 'incident-abc',
      tenantId: 'tenant-xyz',
    });
    expect(res.json).toHaveBeenCalledWith(PERSISTED_ROW);
  });

  it('returns 404 when no record exists', async () => {
    const { req, res } = makeReqRes();
    triageService.getLatestTriage.mockResolvedValue(null);

    await getTriage(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'No triage record found' });
  });

  it('returns 400 when tenantId is missing', async () => {
    const { req, res } = makeReqRes({ context: {} });

    await getTriage(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing tenant context' });
    expect(triageService.getLatestTriage).not.toHaveBeenCalled();
  });

  it('returns 500 on DB error', async () => {
    const { req, res } = makeReqRes();
    triageService.getLatestTriage.mockRejectedValue(new Error('DB read error'));

    await getTriage(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'DB read error' });
  });
});
