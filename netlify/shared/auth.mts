import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'memo_session';
const maxAge = 12 * 60 * 60;
function sign(value: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  return createHmac('sha256', secret).update(value).digest('hex');
}
export function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function sessionCookie() {
  const expiry = String(Math.floor(Date.now() / 1000) + maxAge);
  return `${COOKIE}=${expiry}.${sign(expiry)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}
export function clearCookie() {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}
export function authenticated(request: Request) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/(?:^|;\s*)memo_session=([^;]+)/);
  if (!match) return false;
  const [expiry, signature, ...rest] = match[1].split('.');
  if (rest.length || !/^\d+$/.test(expiry) || !/^[0-9a-f]{64}$/.test(signature || '')) return false;
  if (Number(expiry) < Date.now() / 1000) return false;
  return safeEqual(signature, sign(expiry));
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  return origin === new URL(request.url).origin;
}
export function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}
export function requireAuth(req: Request) {
  return authenticated(req) ? null : json({ error: 'Du må logge inn.' }, 401);
}
