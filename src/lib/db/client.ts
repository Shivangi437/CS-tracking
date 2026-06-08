import { neon, NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle, NeonHttpDatabase } from "drizzle-orm/neon-http";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Lazy-initialised so that the absence of DATABASE_URL doesn't crash
 * `next build`'s page-data collection step. Initialises on first query.
 */
let _db: NeonHttpDatabase<typeof schema> | null = null;
let _sql: NeonQueryFunction<false, false> | null = null;

function init() {
  if (_db) return;
  _sql = neon(env.DATABASE_URL);
  _db = drizzle(_sql, { schema });
}

export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_target, prop) {
    init();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (_db as any)[prop];
  },
});

export { schema };
