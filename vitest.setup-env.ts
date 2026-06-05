import { config } from "dotenv";
import { assertTestDb } from "./src/lib/__guards__/assert-test-db";
// Draait in ELKE worker (pool: threads). override:false → weigert i.p.v. maskeert.
config({ path: ".env.test" });
assertTestDb();
