// Fail-closed DB-host-guard. Default-deny: alleen expliciet toegestane test-hosts.
// Allowlist is HARDCODED (niet uit env) zodat een verdwaalde shell-var 'm niet kan oprekken.
const ALLOWED_TEST_HOSTS = ["localhost", "127.0.0.1"];

export function assertTestDb(): void {
  const url = process.env.DATABASE_URL;
  if (!url || url.trim() === "") {
    throw new Error("[assertTestDb] DATABASE_URL leeg/ongezet — geweigerd (geen URL is geen vrijbrief).");
  }
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("[assertTestDb] DATABASE_URL onparsebaar — geweigerd.");
  }
  if (!ALLOWED_TEST_HOSTS.includes(host)) {
    throw new Error(
      `[assertTestDb] DB-host '${host}' staat NIET op de test-allowlist (${ALLOWED_TEST_HOSTS.join(", ")}). ` +
      `Tests weigeren te draaien tegen niet-test-DB. Gebruik .env.test (lokale Postgres).`
    );
  }
}
