/**
 * Heuristic password strength (FN-9). Not a substitute for server-side policy;
 * provides UX feedback only.
 */
export type PasswordStrengthTier = 0 | 1 | 2 | 3 | 4;

export const PASSWORD_STRENGTH_LABELS: Record<PasswordStrengthTier, string> = {
  0: '',
  1: 'Weak',
  2: 'Fair',
  3: 'Strong',
  4: 'Very Strong'
};

/** 0–100 */
export function scorePasswordStrength(password: string): number {
  if (!password) return 0;
  let score = 0;
  const len = password.length;
  if (len >= 8) score += 10;
  if (len >= 10) score += 6;
  if (len >= 12) score += 8;
  if (len >= 14) score += 6;
  if (len >= 16) score += 6;
  if (/[a-z]/.test(password)) score += 12;
  if (/[A-Z]/.test(password)) score += 12;
  if (/[0-9]/.test(password)) score += 12;
  if (/[^a-zA-Z0-9]/.test(password)) score += 18;
  const variety = [/[a-z]/.test(password), /[A-Z]/.test(password), /[0-9]/.test(password), /[^a-zA-Z0-9]/.test(password)].filter(
    Boolean
  ).length;
  if (variety >= 3) score += 6;
  if (variety >= 4) score += 10;
  return Math.min(100, Math.round(score));
}

export function getPasswordStrengthTier(score: number, hasInput: boolean): PasswordStrengthTier {
  if (!hasInput) return 0;
  if (score <= 28) return 1;
  if (score <= 52) return 2;
  if (score <= 78) return 3;
  return 4;
}
