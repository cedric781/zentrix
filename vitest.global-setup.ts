import { config } from "dotenv";
import { assertTestDb } from "./src/lib/__guards__/assert-test-db";

export default function () {
  // laad .env.test ZONDER override (dotenv-default): een extern gezette
  // (prod-)DATABASE_URL wordt NIET gemaskeerd, zodat de guard 'm kan weigeren.
  config({ path: ".env.test" });
  assertTestDb(); // fail-closed: aborteert hele run als host niet allowlisted
}
