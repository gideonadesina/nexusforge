/**
 * Vitest global setup.
 *
 * Loads .env.local so the integration suite talks to the REAL FalkorDB
 * instance. There is no mock FalkorDB anywhere in this project: if the
 * database is unreachable, these tests fail rather than pretending to pass.
 */
import { loadLocalEnv } from "../scripts/_env";

loadLocalEnv();
