import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createBashToolDefinition } from '../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/bash.js';
import { waitForChildProcess, waitForChildProcessResult } from '../node_modules/@earendil-works/pi-coding-agent/dist/utils/child-process.js';
const tool = createBashToolDefinition(process.cwd(), { shellPath: '/bin/bash' });
const ctx = undefined as unknown as Parameters<typeof tool.execute>[4];
const run = (command: string, timeout?: number, signal?: AbortSignal) => tool.execute('fixture', { command, ...(timeout === undefined ? {} : { timeout }) }, signal, undefined, ctx);
test('real bash: signal, output, ordinary exits, timeout and cancellation', { timeout: 10000 }, async () => {
  assert.match(JSON.stringify(await run('printf ok; exit 0')), /ok/);
  await assert.rejects(run('exit 7'), /code 7/);
  await assert.rejects(run('kill -TERM $$'), /signal SIGTERM/);
  await assert.rejects(run('printf before; kill -TERM $$'), /before[\s\S]*signal SIGTERM/);
  await assert.rejects(run('sleep 5', .05), /timed out/);
  const pre = new AbortController(); pre.abort();
  await assert.rejects(run('exit 0', undefined, pre.signal), /aborted/);
  const active = new AbortController();
  const pending = tool.execute('cancel', { command: 'printf ready; sleep 5' }, active.signal, update => {
    if (JSON.stringify(update).includes('ready')) active.abort();
  }, ctx);
  await assert.rejects(pending, /aborted/);
});
test('unknown null exit is not success', async () => {
  const custom = createBashToolDefinition(process.cwd(), { operations: { exec: async () => ({ exitCode: null }) } });
  await assert.rejects(custom.execute('null', { command: '' }, undefined, undefined, ctx), /code null/);
});
for (const mode of ['exit', 'close', 'idle'] as const) test(`waiter retains signal via ${mode}`, async () => {
  const child = Object.assign(new EventEmitter(), { stdout: mode === 'idle' ? new PassThrough() : null, stderr: null });
  const waiting = waitForChildProcessResult(child as unknown as ChildProcess);
  child.emit(mode === 'close' ? 'close' : 'exit', null, 'SIGTERM');
  assert.deepEqual(await waiting, { exitCode: null, signal: 'SIGTERM' });
});
test('inherited stdio drains late active output and retains signal', async () => {
  const child = spawn('/bin/bash', ['-c', '(for i in 1 2 3 4 5; do sleep .04; printf late; done; sleep .3) & kill -TERM $$'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', chunk => { out += chunk; });
  assert.deepEqual(await waitForChildProcessResult(child), { exitCode: null, signal: 'SIGTERM' });
  assert.equal(out, 'late'.repeat(5));
});
test('legacy waiter remains number/null', async () => {
  assert.equal(await waitForChildProcess(spawn('/bin/bash', ['-c', 'exit 7'])), 7);
  assert.equal(await waitForChildProcess(spawn('/bin/bash', ['-c', 'kill -TERM $$'])), null);
});
for (const inGit of [false, true]) test(`installer reproducibility, idempotence and fail closed guards (git=${inGit})`, () => {
  const dir = mkdtempSync(resolve('.o07-install-'));
  const root = join(dir, 'node_modules/@earendil-works/pi-coding-agent');
  const installer = resolve('scripts/apply-sdk-bash-signal.mjs');
  try {
    mkdirSync(root, { recursive: true });
    const files = ['dist/utils/child-process.js', 'dist/utils/child-process.d.ts', 'dist/core/tools/bash.js', 'dist/core/tools/bash.d.ts'];
    const patched = files.map(path => readFileSync(join('node_modules/@earendil-works/pi-coding-agent', path)));
    for (const path of files) {
      mkdirSync(join(root, path, '..'), { recursive: true }); cpSync(join('node_modules/@earendil-works/pi-coding-agent', path), join(root, path));
    }
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.85.1' }));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    env.GIT_CEILING_DIRECTORIES = dir;
    execFileSync('git', ['apply', '-R', resolve('patches/pi-coding-agent-0.85.1-bash-signal.patch')], { cwd: root, env });
    for (const [i, file] of files.entries()) assert.notDeepEqual(readFileSync(join(root, file)), patched[i]);
    delete env.GIT_CEILING_DIRECTORIES;
    if (inGit) {
      execFileSync('git', ['init', '--quiet', dir], { env });
      assert.equal(execFileSync('git', ['rev-parse', '--show-prefix'], { cwd: root, env }).toString().trim(), 'node_modules/@earendil-works/pi-coding-agent/');
    }
    // Even a git executable returning success without applying must fail closed.
    const pristine = files.map(file => readFileSync(join(root, file)));
    const fakeBin = join(dir, 'fake-bin'); mkdirSync(fakeBin);
    writeFileSync(join(fakeBin, 'git'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    assert.throws(() => execFileSync(process.execPath, [installer], {
      cwd: dir, env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` }, stdio: 'pipe',
    }), /Post-patch hash mismatch/);
    for (const [i, file] of files.entries()) assert.deepEqual(readFileSync(join(root, file)), pristine[i]);
    assert.match(execFileSync(process.execPath, [installer], { cwd: dir }).toString(), /applied/);
    for (const [i, file] of files.entries()) assert.deepEqual(readFileSync(join(root, file)), patched[i]);
    assert.match(execFileSync(process.execPath, [installer], { cwd: dir }).toString(), /already applied/);
    for (const [i, file] of files.entries()) assert.deepEqual(readFileSync(join(root, file)), patched[i]);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.85.2' }));
    assert.throws(() => execFileSync(process.execPath, [installer], { cwd: dir, stdio: 'pipe' }), /Expected.*0.85.1/);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.85.1' }));
    writeFileSync(join(root, 'dist/utils/child-process.js'), '// unknown');
    assert.throws(() => execFileSync(process.execPath, [installer], { cwd: dir, stdio: 'pipe' }), /Unknown upstream/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
