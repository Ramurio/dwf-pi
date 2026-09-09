import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { openWorkflowDatabase } from "../src/sqlite.js";

test("initialization releases failed lock attempts and opens WAL after a real competing transaction", { timeout: 15_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-db-lock-")), filename = join(directory, "state.sqlite");
  const initial = new DatabaseSync(filename);
  initial.exec("CREATE TABLE preserved (value INTEGER)"); initial.close();
  const worker = new Worker(`
    const {parentPort,workerData}=require('node:worker_threads');
    const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync(workerData);
    db.exec('BEGIN EXCLUSIVE; INSERT INTO preserved VALUES(42)');
    parentPort.postMessage('locked');
    setTimeout(()=>{db.exec('COMMIT');db.close()},350);
  `, { eval: true, workerData: filename, execArgv: [] });
  const exited = once(worker, "exit");
  try {
    await once(worker, "message");
    const db = openWorkflowDatabase(filename, "CREATE TABLE IF NOT EXISTS initialized(value TEXT)");
    try {
      assert.equal(db.prepare("SELECT value FROM preserved").get()!.value, 42);
      assert.equal(db.prepare("PRAGMA journal_mode").get()!.journal_mode, "wal");
      assert.equal(db.prepare("PRAGMA synchronous").get()!.synchronous, 2);
      assert.equal(db.prepare("PRAGMA foreign_keys").get()!.foreign_keys, 1);
      assert.equal(db.prepare("PRAGMA busy_timeout").get()!.timeout, 5000);
      assert.equal(db.prepare("SELECT count(*) AS count FROM initialized").get()!.count, 0);
    } finally { db.close(); }
    assert.equal((await exited)[0], 0);
  } finally { await worker.terminate(); await rm(directory, { recursive: true, force: true }); }
});

test("schema errors roll back setup instead of leaving a partially initialized connection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-db-schema-")), filename = join(directory, "state.sqlite");
  try {
    assert.throws(() => openWorkflowDatabase(filename, "CREATE TABLE partial(value TEXT); INVALID SQL"), /syntax error/);
    const db = new DatabaseSync(filename);
    try { assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='partial'").get(), undefined); }
    finally { db.close(); }
    const recovered = openWorkflowDatabase(filename, "CREATE TABLE ready(value TEXT)");
    recovered.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
