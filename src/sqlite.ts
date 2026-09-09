import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Only idempotent connection/schema setup is retried, never application writes.
 * SQLite can return BUSY without invoking its busy handler during lock promotion.
 * Close the failed connection to release its locks before another setup attempt.
 */
export function openWorkflowDatabase(filename: string, schema: string): DatabaseSync {
  if (filename !== ":memory:") mkdirSync(dirname(resolve(filename)), { recursive: true, mode: 0o700 });
  const deadline = performance.now() + 5_000;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(filename);
      database.exec("PRAGMA busy_timeout=100");
      const mode = database.prepare("PRAGMA journal_mode=WAL").get();
      if (filename !== ":memory:" && mode?.journal_mode !== "wal") throw new Error("Workflow journal requires WAL mode");
      database.exec("PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
      database.exec(schema);
      database.exec("COMMIT; PRAGMA busy_timeout=5000");
      return database;
    } catch (error) {
      // Closing rolls back an incomplete schema transaction and releases any read lock.
      database?.close();
      const code = (error as { errcode?: number }).errcode;
      const remaining = deadline - performance.now();
      if (typeof code !== "number" || (code & 0xff) !== 5 || remaining <= 0) throw error;
      Atomics.wait(sleeper, 0, 0, Math.min(remaining, 10 + Math.random() * 20));
    }
  }
}
