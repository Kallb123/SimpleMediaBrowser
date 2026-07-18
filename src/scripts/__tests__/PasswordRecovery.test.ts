import { computeRecoveryCode, recoveryChallengeText } from '../PasswordRecovery';

describe('computeRecoveryCode', () => {
  it('is deterministic for a given date', () => {
    const date = new Date(2026, 6, 18); // 18 Jul 2026 (month is 0-indexed)
    expect(computeRecoveryCode(date)).toBe(computeRecoveryCode(new Date(2026, 6, 18)));
  });

  it('matches the documented formula', () => {
    const date = new Date(2026, 6, 18);
    const expected = (18 * 137 + 7 * 971 + 2026 * 7) % 1000000;
    expect(computeRecoveryCode(date)).toBe(String(expected).padStart(6, '0'));
  });

  it('is always a zero-padded 6-digit string', () => {
    for (const date of [new Date(2000, 0, 1), new Date(2099, 11, 31), new Date(2026, 6, 18)]) {
      expect(computeRecoveryCode(date)).toMatch(/^\d{6}$/);
    }
  });

  it('changes from one day to the next', () => {
    const today = computeRecoveryCode(new Date(2026, 6, 18));
    const tomorrow = computeRecoveryCode(new Date(2026, 6, 19));
    expect(today).not.toBe(tomorrow);
  });
});

describe('recoveryChallengeText', () => {
  it('includes the date it was generated for', () => {
    const date = new Date(2026, 6, 18);
    expect(recoveryChallengeText(date)).toContain('18/7/2026');
  });
});
