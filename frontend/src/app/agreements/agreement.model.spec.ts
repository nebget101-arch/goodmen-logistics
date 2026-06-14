/// <reference types="jasmine" />

import {
  toggleRole,
  isLowConfidence,
  countLowConfidence,
  roleLabel,
  LOW_CONFIDENCE_THRESHOLD,
  AgreementField,
} from './agreement.model';

function field(overrides: Partial<AgreementField> = {}): AgreementField {
  return {
    id: 'f1',
    fieldKey: 'carrier_name',
    label: 'Carrier Name',
    fieldType: 'text',
    page: 1,
    role: 'internal',
    suggestedRole: 'internal',
    confidence: 0.95,
    ...overrides,
  };
}

describe('agreement.model — role toggle', () => {
  it('flips internal → signer', () => {
    expect(toggleRole('internal')).toBe('signer');
  });

  it('flips signer → internal', () => {
    expect(toggleRole('signer')).toBe('internal');
  });

  it('is its own inverse (double toggle returns the original)', () => {
    expect(toggleRole(toggleRole('internal'))).toBe('internal');
    expect(toggleRole(toggleRole('signer'))).toBe('signer');
  });

  it('roleLabel renders human-readable copy', () => {
    expect(roleLabel('internal')).toBe('Internal');
    expect(roleLabel('signer')).toBe('Signer');
  });
});

describe('agreement.model — low-confidence flagging', () => {
  it('flags a field below the default threshold', () => {
    expect(isLowConfidence(field({ confidence: 0.5 }))).toBeTrue();
  });

  it('does not flag a field at or above the threshold', () => {
    expect(isLowConfidence(field({ confidence: LOW_CONFIDENCE_THRESHOLD }))).toBeFalse();
    expect(isLowConfidence(field({ confidence: 0.92 }))).toBeFalse();
  });

  it('treats the threshold as an exclusive lower bound', () => {
    // 0.69999 is below 0.7 → flagged; exactly 0.7 → not flagged.
    expect(isLowConfidence(field({ confidence: 0.6999 }))).toBeTrue();
    expect(isLowConfidence(field({ confidence: 0.7 }))).toBeFalse();
  });

  it('honors a custom threshold', () => {
    expect(isLowConfidence(field({ confidence: 0.8 }), 0.85)).toBeTrue();
    expect(isLowConfidence(field({ confidence: 0.8 }), 0.75)).toBeFalse();
  });

  it('treats missing / NaN confidence as low (needs review)', () => {
    expect(isLowConfidence(field({ confidence: null }))).toBeTrue();
    expect(isLowConfidence(field({ confidence: NaN }))).toBeTrue();
  });

  it("prefers the backend's lowConfidence flag when present", () => {
    // High confidence but backend already flagged it → still low.
    expect(isLowConfidence(field({ confidence: 0.99, lowConfidence: true }))).toBeTrue();
  });

  it('counts only the flagged fields in a map', () => {
    const fields = [
      field({ confidence: 0.99 }),
      field({ confidence: 0.4 }),
      field({ confidence: 0.65 }),
      field({ confidence: 0.85 }),
    ];
    expect(countLowConfidence(fields)).toBe(2);
  });

  it('countLowConfidence is safe on an empty / null list', () => {
    expect(countLowConfidence([])).toBe(0);
    expect(countLowConfidence(null as unknown as AgreementField[])).toBe(0);
  });
});
