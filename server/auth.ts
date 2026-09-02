import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { PersonId } from '../shared/contracts.js';
import { isPerson } from '../shared/validation.js';
import { config } from './config.js';

type Session = { actor: PersonId; expires: number };
const sessions = new Map<string, Session>();
const failures = new Map<string, { count: number; resetAt: number }>();
const scrypt = promisify(scryptCallback);

declare module 'hono' {
  interface ContextVariableMap { actor: PersonId }
}

function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function verifyPassword(person: PersonId, password: string): Promise<boolean> {
  if (config.devAuth) return password === person;
  const encoded = person === 'zhuzhu' ? process.env.ZHUZHU_PASSWORD_SCRYPT : process.env.XIAOHUA_PASSWORD_SCRYPT;
  if (!encoded) return false;
  const [saltHex, expectedHex] = encoded.split(':');
  if (!saltHex || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function login(c: Context): Promise<Response> {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  const limit = failures.get(ip);
  if (limit && limit.resetAt > Date.now() && limit.count >= 8) return c.json({ error: '登录尝试过多，请稍后再试' }, 429);
  const body = await c.req.json().catch(() => null) as { person?: unknown; password?: unknown } | null;
  if (!body || !isPerson(body.person) || typeof body.password !== 'string' || !(await verifyPassword(body.person, body.password))) {
    failures.set(ip, { count: (limit?.resetAt ?? 0) > Date.now() ? (limit?.count ?? 0) + 1 : 1, resetAt: Date.now() + 10 * 60_000 });
    return c.json({ error: '账号或密码不正确' }, 401);
  }
  failures.delete(ip);
  const token = randomBytes(32).toString('base64url');
  sessions.set(tokenDigest(token), { actor: body.person, expires: Date.now() + 14 * 24 * 60 * 60_000 });
  setCookie(c, 'fitness_session', token, {
    httpOnly: true, secure: config.origin.startsWith('https:'), sameSite: 'Strict', path: '/', maxAge: 14 * 24 * 60 * 60,
  });
  return c.json({ actor: body.person });
}

export function logout(c: Context): Response {
  const token = getCookie(c, 'fitness_session');
  if (token) sessions.delete(tokenDigest(token));
  deleteCookie(c, 'fitness_session', { path: '/' });
  return c.json({ ok: true });
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const token = getCookie(c, 'fitness_session');
  const session = token ? sessions.get(tokenDigest(token)) : undefined;
  if (!session || session.expires <= Date.now()) return c.json({ error: '请先登录' }, 401);
  c.set('actor', session.actor);
  await next();
};

export function requireExactOrigin(c: Context): Response | null {
  const origin = c.req.header('origin');
  if (origin && origin !== config.origin && origin !== 'http://127.0.0.1:5173') return c.json({ error: '请求来源不允许' }, 403);
  return null;
}
