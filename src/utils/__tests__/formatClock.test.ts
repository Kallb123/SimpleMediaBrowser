import { formatClock } from '@/utils/formatClock';

describe('formatClock', () => {
  it('formats minutes and seconds', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(599)).toBe('9:59');
  });

  it('adds hours from one hour up', () => {
    expect(formatClock(3600)).toBe('1:00:00');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(36000 + 61)).toBe('10:01:01');
  });

  it('truncates fractions of a second', () => {
    expect(formatClock(59.99)).toBe('0:59');
  });

  it('shows unusable input as zero', () => {
    expect(formatClock(-3)).toBe('0:00');
    expect(formatClock(NaN)).toBe('0:00');
    expect(formatClock(Infinity)).toBe('0:00');
  });
});
