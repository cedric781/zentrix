import { config } from "dotenv";
import { assertTestDb } from "./src/lib/__guards__/assert-test-db";

export default function () {
  // laad .env.test EXPLICIET (overschrijft .env→.env.local symlink)
  config({ path: ".env.test", override: true });
  assertTestDb(); // fail-closed: aborteert hele run als host niet allowlisted
}
