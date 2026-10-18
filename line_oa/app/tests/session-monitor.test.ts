import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { SessionMonitor } from '../src/session-monitor.js';
import { SessionManager } from '../src/session.js';
import { LineClient, type RequestFn } from '../src/line-client.js';
import { MemoryLogger } from '../src/logger.js';
import type { SessionCredentials } from '../src/types.js';

const credentials = (): SessionCredentials => ({ version: 1, botId: `U${'a'.repeat(32)}`,
  cookies: [{ name: '__Host-chat-ses', value: 'synthetic-session' }], importedAt: new Date().toISOString() });

async function fixture(request: RequestFn, busy = () => false, interval = 5 * 60_000) {
  const dir = await mkdtemp(join(tmpdir(), 'line-oa-monitor-'));
  const sessions = new SessionManager(dir);
  await sessions.load();
  const client = new LineClient(sessions, 1000, request);
  const monitor = new SessionMonitor(sessions, client, new MemoryLogger(), busy, interval);
  return { dir, sessions, client, monitor, async close() { monitor.stop(); await rm(dir, { recursive: true, force: true }); } };
}

test('background monitor checks CSRF and read-only contacts; expiry stops further probes', async () => {
  let status = 200;
  const paths: string[] = [];
  const h = await fixture(async (method, path) => {
    assert.equal(method, 'GET'); paths.push(path);
    return { status, body: path.includes('csrfToken') ? { token: 'synthetic-csrf' } : { list: [] }, contentType: 'application/json' };
  });
  try {
    await h.monitor.check(); assert.equal(paths.length, 0);
    await h.sessions.importCredentials(credentials());
    await h.monitor.check();
    assert.equal(h.sessions.getStatus().state, 'CONNECTED'); assert.equal(paths.length, 2);
    const saved = JSON.parse(await readFile(join(h.dir, 'secrets/line-session.json'), 'utf8'));
    assert.equal(saved.csrfToken, 'synthetic-csrf');
    status = 401; await h.monitor.check();
    assert.equal(h.sessions.getStatus().state, 'EXPIRED');
    assert.equal(h.sessions.getStatus().loginRequiredReason, 'expired');
    await h.monitor.check(); assert.equal(paths.length, 3);
    status = 200; await h.sessions.importCredentials(credentials()); await h.monitor.check();
    assert.equal(h.sessions.getStatus().state, 'CONNECTED');
  } finally { await h.close(); }
});

test('network, CSRF, permission and rate-limit failures do not masquerade as expiry; recover without QR', async () => {
  let status = 0;
  const h = await fixture(async (_method, path) => {
    if (!status) throw new Error('offline');
    return { status, body: path.includes('csrfToken') ? { token: 'synthetic-csrf' } : { list: [] }, contentType: 'application/json' };
  });
  try {
    await h.sessions.importCredentials(credentials()); await h.monitor.check();
    assert.equal(h.sessions.getStatus().state, 'DISCONNECTED');
    for (status of [403, 429, 500]) {
      await h.monitor.check(); assert.equal(h.sessions.getStatus().state, 'ERROR');
      assert.equal(h.sessions.getStatus().loginRequiredReason, undefined);
    }
    status = 200; await h.monitor.check(); assert.equal(h.sessions.getStatus().state, 'CONNECTED');
  } finally { await h.close(); }
});

test('background and foreground validations share a single probe; busy sender skips background', async () => {
  let release!: () => void; let calls = 0; let busy = true;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const h = await fixture(async (_method, path) => {
    calls++; await gate;
    return { status: 200, body: path.includes('csrfToken') ? { token: 'synthetic-csrf' } : { list: [] }, contentType: 'application/json' };
  }, () => busy);
  try {
    await h.sessions.importCredentials(credentials()); await h.monitor.check(); assert.equal(calls, 0);
    busy = false;
    const first = h.monitor.check(); const second = h.monitor.check(); const foreground = h.client.validate();
    assert.equal(calls, 1); release(); await Promise.all([first, second, foreground]);
    assert.equal(calls, 2); assert.equal(h.sessions.getStatus().state, 'CONNECTED');
  } finally { release(); await h.close(); }
});

test('pending background result cannot restore logout or overwrite a new login', async () => {
  for (const action of ['logout', 'login'] as const) {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const h = await fixture(async () => { await gate; return { status: 401, body: {}, contentType: 'application/json' }; });
    try {
      await h.sessions.importCredentials(credentials()); const pending = h.monitor.check();
      if (action === 'logout') await h.sessions.logout();
      else await h.sessions.importCredentials({ ...credentials(), botId: `U${'b'.repeat(32)}` });
      release(); await pending;
      assert.equal(h.sessions.getStatus().state, action === 'logout' ? 'AUTH_REQUIRED' : 'VALIDATING');
      if (action === 'logout') assert.equal(h.sessions.getStatus().loginRequiredReason, 'logged_out');
      else assert.equal(h.sessions.getCredentials()?.botId, `U${'b'.repeat(32)}`);
    } finally { release(); await h.close(); }
  }
});

test('scheduled checks detect idle expiry without sends; stopping cancels future checks', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let status = 200; let calls = 0;
  const h = await fixture(async (_method, path) => {
    calls++;
    return { status, body: path.includes('csrfToken') ? { token: 'synthetic-csrf' } : { list: [] }, contentType: 'application/json' };
  });
  try {
    await h.sessions.importCredentials(credentials()); h.monitor.start(); await h.monitor.check(); await nextTurn();
    assert.equal(h.sessions.getStatus().state, 'CONNECTED');
    status = 401; t.mock.timers.tick(5 * 60_000); await h.monitor.check(); await nextTurn();
    assert.equal(h.sessions.getStatus().state, 'EXPIRED'); assert.equal(calls, 3);
    h.monitor.stop(); t.mock.timers.tick(30 * 60_000); await nextTurn(); assert.equal(calls, 3);
  } finally { await h.close(); }
});
