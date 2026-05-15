import type { SupportedProvider, SupportedSport } from "@/lib/api/types";
import type { ExternalResultProvider, FetchEventInput, ExternalEventResult } from "./types";
import { EspnProvider } from "./providers/espn";
import { TheSportsDbProvider } from "./providers/thesportsdb";
import { withCircuitBreaker } from "./circuit-breaker";

const SPORT_PROVIDERS: Record<SupportedSport, SupportedProvider[]> = {
  football: ["espn", "thesportsdb"],
  basketball: ["espn", "thesportsdb"],
  american_football: ["espn", "thesportsdb"],
  ice_hockey: ["espn", "thesportsdb"],
  baseball: ["espn", "thesportsdb"],
  tennis: ["espn", "thesportsdb"],
  mma: ["espn", "thesportsdb"],
};

const PROVIDER_INSTANCES: Record<SupportedProvider, ExternalResultProvider | null> = {
  espn: new EspnProvider(),
  thesportsdb: new TheSportsDbProvider(),
  "football-data": null,
};

export class NoProviderAvailableError extends Error {
  constructor(
    public readonly sport: SupportedSport,
    public readonly attempted: SupportedProvider[],
    public readonly errors: Array<{ provider: SupportedProvider; message: string }>,
  ) {
    const reasons = errors.map((e) => `${e.provider}: ${e.message}`).join(" | ");
    super(`No provider available for sport=${sport} (tried: ${attempted.join(", ")}) — ${reasons}`);
    this.name = "NoProviderAvailableError";
  }
}

export async function fetchExternalResult(
  input: FetchEventInput,
): Promise<{ result: ExternalEventResult; provider: SupportedProvider }> {
  const providers = SPORT_PROVIDERS[input.sport];
  if (!providers || providers.length === 0) {
    throw new NoProviderAvailableError(input.sport, [], []);
  }

  const errors: Array<{ provider: SupportedProvider; message: string }> = [];

  for (const providerName of providers) {
    const provider = PROVIDER_INSTANCES[providerName];
    if (!provider) {
      errors.push({ provider: providerName, message: "Not implemented" });
      continue;
    }

    try {
      const result = await withCircuitBreaker(providerName, () => provider.fetchEvent(input));
      return { result, provider: providerName };
    } catch (err) {
      errors.push({
        provider: providerName,
        message: err instanceof Error ? err.message : "unknown error",
      });
    }
  }

  throw new NoProviderAvailableError(input.sport, providers, errors);
}
