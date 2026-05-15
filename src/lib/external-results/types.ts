import type { SupportedProvider, SupportedSport } from "@/lib/api/types";

/**
 * Genormaliseerde resultaat-shape voor alle providers.
 * Adapter vertaalt provider-specifieke response naar dit format.
 */
export type ExternalEventResult =
  | {
      kind: "completed";
      homeTeam: string;
      awayTeam: string;
      homeScore: number;
      awayScore: number;
      finishedAt: Date;
    }
  | {
      kind: "draw";
      homeTeam: string;
      awayTeam: string;
      homeScore: number;
      awayScore: number;
      finishedAt: Date;
    }
  | { kind: "postponed"; reason?: string }
  | { kind: "cancelled"; reason?: string }
  | { kind: "in_progress" }
  | { kind: "scheduled" }
  | { kind: "not_found" };

/**
 * Provider input — wat caller meegeeft om event op te halen.
 */
export type FetchEventInput = {
  eventId: string;
  league: string;
  sport: SupportedSport;
};

/**
 * Uniforme provider interface. Elke provider adapter implementeert dit.
 *
 * MUST:
 *   - timeout binnen 5 sec per fetch (anders cron-batch verloopt)
 *   - throw ProviderError op transport failures (NOT silent fallback)
 *   - return ExternalEventResult.not_found voor 404, NIET throwen
 */
export interface ExternalResultProvider {
  readonly name: SupportedProvider;
  fetchEvent(input: FetchEventInput): Promise<ExternalEventResult>;
}

/**
 * Error thrown door providers bij transport / parse failures.
 * Caller (circuit breaker, cron) onderschept dit en track failure rate.
 */
export class ProviderError extends Error {
  constructor(
    public readonly provider: SupportedProvider,
    public readonly code:
      | "TIMEOUT"
      | "HTTP_ERROR"
      | "PARSE_ERROR"
      | "RATE_LIMITED"
      | "NETWORK_ERROR",
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/**
 * Shared fetch helper met timeout en error normalisatie.
 * Alle providers gebruiken dit, geen direct fetch().
 *
 * Behavior:
 *   - 5s default timeout → ProviderError TIMEOUT
 *   - 429 → ProviderError RATE_LIMITED
 *   - 5xx → ProviderError HTTP_ERROR
 *   - 404 → returns null (caller maps to {kind:"not_found"})
 *   - non-JSON → ProviderError PARSE_ERROR
 *   - network/abort → ProviderError NETWORK_ERROR
 */
export async function providerFetch(
  provider: SupportedProvider,
  url: string,
  options: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<unknown> {
  const timeout = options.timeoutMs ?? 5000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", ...options.headers },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.status === 429) {
      throw new ProviderError(
        provider,
        "RATE_LIMITED",
        `Rate limited by ${provider}`,
        429,
      );
    }
    if (res.status >= 500) {
      throw new ProviderError(
        provider,
        "HTTP_ERROR",
        `${provider} server error ${res.status}`,
        res.status,
      );
    }
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new ProviderError(
        provider,
        "HTTP_ERROR",
        `${provider} returned ${res.status}`,
        res.status,
      );
    }

    try {
      return await res.json();
    } catch {
      throw new ProviderError(
        provider,
        "PARSE_ERROR",
        `${provider} returned non-JSON`,
      );
    }
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof ProviderError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new ProviderError(
        provider,
        "TIMEOUT",
        `${provider} timed out after ${timeout}ms`,
      );
    }
    throw new ProviderError(
      provider,
      "NETWORK_ERROR",
      `${provider}: ${err instanceof Error ? err.message : "unknown"}`,
    );
  }
}
