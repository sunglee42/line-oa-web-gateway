import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createGateway } from '../src/server.js';
import { AuthManager } from '../src/auth.js';

test('browser API key issuance requires session and CSRF; rotation persists and revokes old key', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gateway-key-'));
  const gateway = await createGateway({ dataDir: dir });
  try {
    await gateway.start(0, 0, '127.0.0.1');
    const base = `http://127.0.0.1:${(gateway.uiServer.address() as AddressInfo).port}`;
    assert.equal((await fetch(`${base}/api/api-key`, { method: 'POST' })).status, 401);
    const session = gateway.auth.anonymousSession();
    const headers = { Cookie: session.cookie.split(';')[0], 'X-CSRF-Token': session.csrf };
    assert.equal((await fetch(`${base}/api/api-key`, { method: 'POST', headers: { Cookie: headers.Cookie } })).status, 403);
    const generate = async () => {
      const response = await fetch(`${base}/api/api-key`, { method: 'POST', headers });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      return await response.json() as { apiKey: string; createdAt: string };
    };
    const first = await generate();
    assert.equal(gateway.auth.validApiKey(`Bearer ${first.apiKey}`), true);
    const second = await generate();
    assert.notEqual(first.apiKey, second.apiKey);
    assert.equal(gateway.auth.validApiKey(`Bearer ${first.apiKey}`), false);
    assert.equal(gateway.auth.validApiKey(`Bearer ${second.apiKey}`), true);
    const status = await (await fetch(`${base}/api/api-key`, { headers })).json();
    assert.deepEqual(status, { configured: true, createdAt: second.createdAt });
    const disk = await readFile(join(dir, 'secrets/api-key.json'), 'utf8');
    assert.equal(disk.includes(second.apiKey), false);
    const restored = new AuthManager(dir, false); await restored.load();
    assert.equal(restored.validApiKey(`Bearer ${second.apiKey}`), true);
  } finally { await gateway.stop(); await rm(dir, { recursive: true, force: true }); }
});
