import assert from "node:assert/strict";
import test from "node:test";
import { copyFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { openWorkflowDatabase } from "../src/sqlite.js";

test("online backup preserves committed WAL rows missing from a single-file copy", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-backup-"));
  const sourcePath = join(directory, "source.sqlite");
  let writer: DatabaseSync | undefined;
  try {
    writer = openWorkflowDatabase(sourcePath, "CREATE TABLE backup_probe (id TEXT PRIMARY KEY)");
    writer.exec("PRAGMA wal_autocheckpoint=0; INSERT INTO backup_probe VALUES ('baseline')");
    assert.equal(writer.prepare("PRAGMA wal_autocheckpoint").get()!.wal_autocheckpoint, 0);
    const checkpoint = writer.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get()!;
    assert.equal(checkpoint.busy, 0);
    assert.equal(checkpoint.log, 0);
    writer.exec("INSERT INTO backup_probe VALUES ('post-checkpoint')");
    assert.ok((await stat(`${sourcePath}-wal`)).size > 0);
    assert.equal(writer.prepare("SELECT count(*) AS n FROM backup_probe").get()!.n, 2);

    // Keep the writer open: closing it could checkpoint away the regression.
    const naivePath = join(directory, "naive.sqlite");
    await copyFile(sourcePath, naivePath);
    const destination = join(directory, "online.sqlite");
    const source = new DatabaseSync(sourcePath, { readOnly: true });
    try { await backup(source, destination); }
    finally { source.close(); }

    for (const [filename, expected] of [
      [naivePath, ["baseline"]],
      [destination, ["baseline", "post-checkpoint"]],
    ] as const) {
      const copy = new DatabaseSync(filename, { readOnly: true });
      try {
        assert.deepEqual(copy.prepare("PRAGMA integrity_check").all().map(row => row.integrity_check), ["ok"]);
        assert.deepEqual(copy.prepare("SELECT id FROM backup_probe ORDER BY id").all().map(row => row.id), expected);
        assert.throws(() => copy.exec("INSERT INTO backup_probe VALUES ('forbidden')"), /readonly/i);
        assert.equal(copy.prepare("SELECT count(*) AS n FROM backup_probe WHERE id='forbidden'").get()!.n, 0);
      } finally { copy.close(); }
    }
  } finally {
    writer?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
