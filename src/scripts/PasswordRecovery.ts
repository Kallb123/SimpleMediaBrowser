/**
 * Offline "forgot password" recovery for the settings lock.
 *
 * There's no email or server to reset via, so recovery is a small arithmetic
 * challenge derived from today's date: enough friction that a child can't
 * just guess or brute-force it, but computable by an adult with a
 * calculator. Entering the correct code clears the settings password, so
 * the app never has to store a second secret.
 */

export function computeRecoveryCode(date: Date = new Date()): string {
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const code = (day * 137 + month * 971 + year * 7) % 1000000;
  return String(code).padStart(6, '0');
}

export function recoveryChallengeText(date: Date = new Date()): string {
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  return `Today is ${day}/${month}/${year}. Compute (day × 137 + month × 971 + year × 7) mod 1,000,000 and enter the 6-digit result (pad with leading zeros if needed).`;
}
