/**
 * HARDCODED kill switch fallback per LESSONS_FROM_WAGER.md R8.
 *
 * If the env store fails (Wager hit Vercel ticket 01142477), an operator
 * can flip this constant and redeploy to instantly disable withdrawals.
 * The env-based switch (WITHDRAWALS_DISABLED) takes precedence; this is
 * the last resort.
 *
 * If you set this to true: open a GitHub issue with label
 * `tech-debt-env-store` describing why the env store failed, and resolve
 * within 30 days. Hardcoded switches are not allowed to become permanent.
 */
export const HARDCODED_WITHDRAWALS_DISABLED = false;
