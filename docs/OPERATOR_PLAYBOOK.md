# Operator Playbook

Day-to-day commands for running zentrix in production. Hostname examples
assume `https://zentrix.example.com` — replace with the actual deploy URL.

---

## Production environment variables

The platform refuses to start until env validation passes (see `src/lib/env.ts`).
Set these in **Vercel → Project → Settings → Environment Variables** for the
production environment.

### Required for core functionality

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | Pooled Postgres connection (Neon) |
| `DIRECT_URL` | Direct Postgres connection (for migrations) |
| `PRIVY_APP_ID` | Privy app ID — embedded wallets + auth |
| `PRIVY_APP_SECRET` | Privy server secret — JWT verify + delegated signing |
| `HELIUS_RPC_URL` | Solana RPC endpoint (mainnet) |
| `HELIUS_WEBHOOK_SECRET` | Bearer token for webhook auth |
| `HELIUS_WEBHOOK_ID` | Helius webhook ID |
| `USDC_MINT_ADDRESS` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (mainnet USDC) |

### Required for cron + admin

| Var | Purpose |
|-----|---------|
| `CRON_SECRET` | Bearer token for `/api/cron/*` (Vercel sends as `Authorization`) |
| `ADMIN_API_TOKEN` | Bearer token for `/api/admin/*` (you, the operator) |

### Optional kill-switches

| Var | Default | Purpose |
|-----|---------|---------|
| `DEPOSITS_DISABLED` | `false` | Hard kill for deposit crediting (env layer of R8) |
| `WITHDRAWALS_DISABLED` | `false` | Hard kill for withdrawal intake (env layer of R8) |

### Withdrawal economics (have defaults — only set to override)

| Var | Default | Purpose |
|-----|---------|---------|
| `WITHDRAWAL_FEE_BPS` | `50` | Fee in basis points (50 = 0.5%) |
| `WITHDRAWAL_FEE_MIN_USDC` | `"0.5"` | Minimum fee (clamp floor) |
| `WITHDRAWAL_FEE_MAX_USDC` | `"10"` | Maximum fee (clamp ceiling) |
| `WITHDRAWAL_MIN_USDC` | `"1"` | Minimum withdrawal amount |
| `PLATFORM_TREASURY_SCOPE` | `"treasury"` | Treasury account scopeKey |

### Optional observability

| Var | Purpose |
|-----|---------|
| `SENTRY_DSN` | If set: errors flow to Sentry. If empty: pino logs only (default) |

---

## Generating tokens

`CRON_SECRET` and `ADMIN_API_TOKEN` must each be at least 32 characters of
unguessable entropy. Generate from any machine you trust (your laptop, a
disposable VM):

```bash
# Linux / macOS / Git-Bash on Windows
openssl rand -hex 32

# PowerShell (no openssl needed)
[Convert]::ToHexString((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

Either gives you a 64-char hex string. Paste into Vercel env settings, never
into the codebase, never into a git commit, never into Slack.

Rotate `ADMIN_API_TOKEN` whenever an operator with access leaves the team.

---

## Check platform health

```bash
curl -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  https://zentrix.example.com/api/admin/metrics
```

Expected: `200 OK` with Prometheus exposition text. Look at:

- `zentrix_circuit_breaker_open{key="..."}` — should all be `0` in normal operation
- `zentrix_reconciliation_delta_units` — should be `0` (delta in micro-USDC)
- `zentrix_reconciliation_age_seconds` — should be `< 1000` (recon runs every 15 min)
- `zentrix_withdrawals_total{status="failed"}` — non-zero is fine (chain rejections happen), but a sudden spike is worth investigating

`401` means the token is wrong or the env var is unset.

---

## Inspect circuit breakers

```bash
curl -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  https://zentrix.example.com/api/admin/breakers
```

Returns a JSON array of all 3 breakers with `isOpen`, `reason`, `openedBy`,
`tripCount`, and timestamps.

---

## Trip a breaker (pause flow)

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"withdrawals","action":"trip","reason":"investigating delta spike","by":"alice"}' \
  https://zentrix.example.com/api/admin/breakers
```

| Field | Type | Notes |
|-------|------|-------|
| `key` | `"deposits" \| "withdrawals" \| "settlement"` | which feature to disable |
| `action` | `"trip"` | trip = open the breaker (block the flow) |
| `reason` | string, optional (default `"manual"`) | why; surfaces in metrics + logs |
| `by` | string, optional (default `"admin"`) | who; surfaces in `openedBy` |

Effect: within ~5 seconds (cache TTL), all serverless instances stop processing
that flow. For withdrawals this means **both** intake (`POST /api/withdrawals`)
and the executor cron stop accepting/draining.

---

## Reset a breaker (resume flow)

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"withdrawals","action":"reset","by":"alice"}' \
  https://zentrix.example.com/api/admin/breakers
```

`action: "reset"` clears `isOpen`, `reason`, and sets `closedAt`. `tripCount`
is preserved (it's a lifetime counter).

---

## When recon delta is non-zero

Recon runs every 15 minutes (`*/15 * * * *`) and writes a `ReconciliationLog`
row. The auto-trip kicks in when `|delta| > 1 USDC` — it trips
the **withdrawals** breaker and writes a log line at level `error`.

1. Check the latest `ReconciliationLog` row for the `notes` field. It will
   say `balanced`, or `delta=N (positive=ledger>chain, possibly missed deposit;
   negative=chain>ledger, possibly bug)`, or `rpc failure: <message>`.
2. **Positive delta** (`ledger > chain`): a deposit hit chain but ledger missed
   it, OR a user has a balance but their wallet was never provisioned (rare).
   Wait one full poll cycle (~1 min). If still positive: investigate the
   deposit poller.
3. **Negative delta** (`chain > ledger`): a withdrawal was processed off-chain
   but the ledger missed the debit. **STOP withdrawals immediately** — verify
   the auto-trip fired (it should have). Investigate before resetting.
4. **`rpc failure: ...`**: Solana RPC was unreachable. The breaker is
   **not** tripped on RPC failure (otherwise an outage would take withdrawals
   down). Check Helius status, retry next cycle.
5. **Read recent ledger entries** in Prisma Studio: `pnpm prisma studio` →
   `LedgerTransaction` → sort by `createdAt` desc.

Anything you don't understand: trip the breaker manually first, investigate
second. Conservative beats clever.

---

## When the env store is broken (Vercel ticket 01142477 redux)

Last-resort hardcoded kill-switch. Use only when the env-based switch
(`WITHDRAWALS_DISABLED`) is unreachable.

1. Edit `src/lib/withdrawals/kill-switch-hardcode.ts`:
   ```ts
   export const HARDCODED_WITHDRAWALS_DISABLED = true;
   ```
2. Commit + push to `main`. Vercel auto-deploys.
3. Open a GitHub issue with label `tech-debt-env-store` describing the
   env-store outage and its mitigation.
4. Within 30 days: resolve the env-store issue, revert the hardcoded flag
   to `false`, redeploy. Hardcoded switches are not allowed to become
   permanent (R8).

---

## Quick troubleshooting reference

| Symptom | First check | Then |
|---------|-------------|------|
| Users report stuck withdrawals | `/api/admin/breakers` — is `withdrawals` open? | If yes, check recon log; reset if false alarm |
| Deposits not crediting | `zentrix_deposits_total{status="credited"}` not incrementing | Trip `deposits` breaker; check Helius webhook + cron poller |
| Metrics endpoint returns 401 | `ADMIN_API_TOKEN` not set or token wrong in your shell | Re-export from your password store |
| Recon hasn't run in 1+ hour | `zentrix_reconciliation_age_seconds` > 4000 | Vercel cron status; check `/api/cron/reconcile` last invocation |
| `_resetCircuitBreakerCache` needed in prod? | No — never. That's a test-only helper. Operator changes propagate via 5s TTL automatically | — |
