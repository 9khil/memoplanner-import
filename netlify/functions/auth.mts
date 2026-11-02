import { authenticated, clearCookie, json, safeEqual, sameOrigin, sessionCookie } from '../shared/auth.mts';
export default async (req: Request) => {
  if (req.method === 'GET') return json({ loggedIn: authenticated(req) });
  if (req.method !== 'POST' || !sameOrigin(req)) return json({ error: 'Ugyldig forespørsel.' }, 403);
  const body = await req.json().catch(() => ({}));
  if (body.action === 'logout') return json({ loggedIn: false }, 200, { 'Set-Cookie': clearCookie() });
  if (body.action !== 'login' || typeof body.password !== 'string') return json({ error: 'Ugyldig forespørsel.' }, 400);
  const password = process.env.APP_PASSWORD;
  if (!password || password.length < 16) return json({ error: 'APP_PASSWORD er ikke konfigurert (minst 16 tegn).' }, 503);
  if (!safeEqual(body.password, password)) return json({ error: 'Feil passord.' }, 401);
  return json({ loggedIn: true }, 200, { 'Set-Cookie': sessionCookie() });
};
