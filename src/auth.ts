import { createHash, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { RequestHandler } from 'express';
import type { Config } from './config.js';
import type { Logger } from './logging.js';
export const OAUTH_SCOPE = 'deepseek:invoke';
export function resourceMetadataUrl(c: Config): string {
  return new URL('/.well-known/oauth-protected-resource/mcp', c.PUBLIC_URL).href;
}
export function authenticate(c: Config, log: Logger): RequestHandler {
  const keys = c.AUTH_MODE === 'oauth' ? createRemoteJWKSet(new URL(c.OAUTH_JWKS_URL), { timeoutDuration: 5000, cooldownDuration: 30000 }) : undefined;
  const digest = (v: string) => createHash('sha256').update(v).digest();
  const expected = digest(c.MCP_BEARER_TOKEN);
  return async (req, res, next) => {
    const header = req.headers.authorization;
    const token = typeof header === 'string' && /^Bearer [^\s]+$/i.test(header) ? header.slice(7) : '';
    let status = 401;
    try {
      if (!token || token.length > 16384) throw new Error('invalid');
      if (c.AUTH_MODE === 'bearer') {
        if (!timingSafeEqual(expected, digest(token))) throw new Error('invalid');
      } else {
        const { payload } = await jwtVerify(token, keys!, { issuer: c.OAUTH_ISSUER, audience: c.PUBLIC_URL,
          algorithms: ['RS256', 'ES256', 'EdDSA'], requiredClaims: ['exp', 'sub', 'iss', 'aud'] });
        if (!payload.sub || !c.OAUTH_ALLOWED_SUBJECTS.includes(payload.sub)) throw new Error('invalid');
        if (typeof payload.scope !== 'string' || !payload.scope.split(' ').includes(OAUTH_SCOPE)) { status = 403; throw new Error('scope'); }
      }
      next();
    } catch {
      log({ event: 'http_rejected', code: 'UNAUTHORIZED' });
      const challenge = c.AUTH_MODE === 'oauth'
        ? `Bearer resource_metadata="${resourceMetadataUrl(c)}", scope="${OAUTH_SCOPE}", error="${status === 403 ? 'insufficient_scope' : 'invalid_token'}"`
        : 'Bearer realm="deepseek-mcp"';
      res.setHeader('WWW-Authenticate', challenge);
      res.status(status).json({ error: status === 403 ? 'insufficient_scope' : 'unauthorized' });
    }
  };
}
