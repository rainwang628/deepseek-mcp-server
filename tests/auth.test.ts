import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { fixture, closeHttp, TEST_TOKEN } from './helpers.js';
import { listenLoopback } from '../scripts/mock-deepseek.js';
test('HTTP requires auth and validates host/origin; healthz reveals no configuration', async t => {
  const f = await fixture(); t.after(() => f.close());
  for (const token of ['', 'wrong-token']) {
    const r = await fetch(`${f.url}/mcp`, { method: 'POST', headers: { Authorization: token ? `Bearer ${token}` : '' } });
    assert.equal(r.status, 401); assert.match(r.headers.get('www-authenticate')!, /^Bearer/);
  }
  // fetch/undici normalizes Host; use the HTTP client to send the actual hostile header.
  const hostStatus = await new Promise<number>(resolve => {
    request(`${f.url}/healthz`, { headers: { Host: 'untrusted.invalid' } }, res => { res.resume(); resolve(res.statusCode!); }).end();
  });
  assert.equal(hostStatus, 403);
  const origin = await fetch(`${f.url}/healthz`, { headers: { Origin: 'https://untrusted.invalid' } }); assert.equal(origin.status, 403);
  const health = await fetch(`${f.url}/healthz`); assert.deepEqual(await health.json(), { status: 'ok', service: 'deepseek-mcp-server' });
  const unsupported = await fetch(`${f.url}/mcp`, { method: 'GET', headers: { Authorization: `Bearer ${TEST_TOKEN}` } }); assert.equal(unsupported.status, 405);
  const invalid = await fetch(`${f.url}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TEST_TOKEN}` }, body: '{bad' });
  assert.equal(invalid.status, 400); assert.equal((await invalid.text()).includes('{bad'), false);
  const large = await fetch(`${f.url}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TEST_TOKEN}` }, body: JSON.stringify({ padding: 'x'.repeat(300000) }) });
  assert.equal(large.status, 413); assert.equal(f.mock.state.calls, 0);
});
test('OAuth discovery and signed JWT verification enforce issuer, audience, expiry, scope and owner', async t => {
  const keys = await generateKeyPair('RS256'); const jwk = await exportJWK(keys.publicKey); jwk.kid = 'local-test-key';
  const jwks = createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] })); });
  const issuer = await listenLoopback(jwks); t.after(() => closeHttp(jwks));
  const f = await fixture({ AUTH_MODE: 'oauth', OAUTH_ISSUER: issuer, OAUTH_JWKS_URL: `${issuer}/jwks`, OAUTH_ALLOWED_SUBJECTS: 'test-owner' });
  t.after(() => f.close());
  const sign = (overrides: Record<string, unknown> = {}) => new SignJWT({ iss: issuer, aud: f.c.PUBLIC_URL,
    sub: 'test-owner', scope: 'deepseek:invoke', exp: Math.floor(Date.now() / 1000) + 300, ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'local-test-key' }).sign(keys.privateKey);
  const discovery = await fetch(`${f.url}/.well-known/oauth-protected-resource/mcp`);
  const metadata = await discovery.json() as Record<string, unknown>;
  assert.equal(metadata.resource, f.c.PUBLIC_URL); assert.deepEqual(metadata.authorization_servers, [issuer]);
  const missing = await fetch(`${f.url}/mcp`, { method: 'POST' }); assert.equal(missing.status, 401);
  assert.match(missing.headers.get('www-authenticate')!, /oauth-protected-resource\/mcp/);
  const client = await f.client(await sign()); assert.equal((await client.listTools()).tools.length, 2);
  for (const claims of [{ iss: 'https://wrong.invalid' }, { aud: 'https://wrong.invalid/mcp' },
    { exp: Math.floor(Date.now() / 1000) - 10 }, { exp: undefined }, { sub: 'other-owner' }, { scope: 'unrelated' }]) {
    const r = await fetch(`${f.url}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${await sign(claims)}` } });
    assert.equal(r.status, claims.scope === 'unrelated' ? 403 : 401);
  }
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools[1]!._meta?.securitySchemes, [{ type: 'oauth2', scopes: ['deepseek:invoke'] }]);
  assert.equal(f.mock.state.calls, 0);
});
