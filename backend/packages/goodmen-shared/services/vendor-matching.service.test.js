'use strict';

jest.mock('../internal/db', () => ({
  knex: null,
}));
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

const { findMatches, invalidateCache } = require('./vendor-matching.service');

const mockRows = [
  {
    vendor_id: 'v1',
    name: 'Alpha Towing',
    skills: JSON.stringify(['Towing', 'Flatbed Transport']),
    capacity: 5,
    pos_lat: 41.88,
    pos_lng: -87.63,
    pos_recorded_at: new Date().toISOString(),
  },
  {
    vendor_id: 'v2',
    name: 'Beta Roadside',
    skills: JSON.stringify(['Tire Change', 'Fuel Delivery']),
    capacity: 2,
    pos_lat: 41.95,
    pos_lng: -87.70,
    pos_recorded_at: new Date().toISOString(),
  },
  {
    vendor_id: 'v3',
    name: 'Distant Towing',
    skills: JSON.stringify(['Towing']),
    capacity: 10,
    pos_lat: 43.00,
    pos_lng: -90.00,
    pos_recorded_at: new Date().toISOString(),
  },
];

function buildDbMock(rows) {
  const qb = {
    join: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    modify: jest.fn((fn) => { fn(qb); return qb; }),
    select: jest.fn().mockResolvedValue(rows),
  };
  const raw = jest.fn().mockReturnValue('(raw sql)');
  const knexFn = jest.fn().mockReturnValue(qb);
  knexFn.raw = raw;
  return knexFn;
}

describe('vendor-matching.service', () => {
  beforeEach(() => {
    const db = require('../internal/db');
    db.knex = buildDbMock(mockRows);
    invalidateCache('test-incident');
    invalidateCache(null);
  });

  describe('haversine / radius filter', () => {
    it('excludes vendors beyond the radius', async () => {
      const matches = await findMatches({ lat: 41.88, lng: -87.63, radiusKm: 20, tenantId: null });
      const ids = matches.map((m) => m.vendor_id);
      expect(ids).not.toContain('v3');
    });

    it('includes vendors within radius', async () => {
      const matches = await findMatches({ lat: 41.88, lng: -87.63, radiusKm: 20, tenantId: null });
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].vendor_id).toBe('v1');
    });
  });

  describe('skills filter', () => {
    it('returns only vendors with required skill', async () => {
      const matches = await findMatches({
        lat: 41.88,
        lng: -87.63,
        radiusKm: 20,
        requiredSkills: ['Towing'],
        tenantId: null,
      });
      expect(matches.every((m) => m.skills.includes('Towing'))).toBe(true);
    });

    it('returns empty when no vendor has all required skills', async () => {
      const matches = await findMatches({
        lat: 41.88,
        lng: -87.63,
        radiusKm: 20,
        requiredSkills: ['Towing', 'Fuel Delivery'],
        tenantId: null,
      });
      expect(matches).toHaveLength(0);
    });
  });

  describe('ranking', () => {
    it('sorts by score descending', async () => {
      const matches = await findMatches({ lat: 41.88, lng: -87.63, radiusKm: 50, tenantId: null });
      for (let i = 1; i < matches.length; i++) {
        expect(matches[i - 1].score).toBeGreaterThanOrEqual(matches[i].score);
      }
    });

    it('closest vendor scores highest when capacity is equal', async () => {
      const rows = [
        { ...mockRows[0], vendor_id: 'near', pos_lat: 41.881, pos_lng: -87.631, capacity: 5 },
        { ...mockRows[0], vendor_id: 'far', pos_lat: 41.90, pos_lng: -87.65, capacity: 5 },
      ];
      const db = require('../internal/db');
      db.knex = buildDbMock(rows);
      const matches = await findMatches({ lat: 41.88, lng: -87.63, radiusKm: 50, tenantId: null });
      expect(matches[0].vendor_id).toBe('near');
    });
  });

  describe('cache', () => {
    it('returns cached result on second call', async () => {
      const db = require('../internal/db');
      const spy = jest.spyOn(db.knex(), 'select');

      await findMatches({ incidentId: 'inc-1', lat: 41.88, lng: -87.63, radiusKm: 50, tenantId: null });

      db.knex = buildDbMock([]);
      const second = await findMatches({ incidentId: 'inc-1', lat: 41.88, lng: -87.63, radiusKm: 50, tenantId: null });
      expect(second.length).toBeGreaterThan(0);
    });

    it('clears cache on invalidate', async () => {
      await findMatches({ incidentId: 'inc-2', lat: 41.88, lng: -87.63, radiusKm: 50, tenantId: null });
      invalidateCache('inc-2');

      const db = require('../internal/db');
      db.knex = buildDbMock([]);
      const after = await findMatches({ incidentId: 'inc-2', lat: 41.88, lng: -87.63, radiusKm: 50, tenantId: null });
      expect(after).toHaveLength(0);
    });
  });
});
