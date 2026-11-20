import { createHash, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';

const ORIGIN = process.env.APP_ORIGIN || '';
const REDIRECT = process.env.DERIV_REDIRECT_URI || '';
const CLIENT = process.env.DERIV_CLIENT_ID || '';
const SECRET = process.env.PLAYGO_COOKIE_SECRET || '';
const SCOPES = process.env.DERIV_SCOPES || 'trade';
const TOKEN_URL = 'https://auth.deriv.com/oauth2/token';
const ACCOUNTS_URL = 'https://api.derivws.com/trading/v1/options/accounts';
const random = () => randomBytes(32).toString('base64url');
const validConfig = () => {
  try {
    const origin = new URL(ORIGIN);
    const redirect = new URL(REDIRECT);
    return origin.protocol === 'https:' && origin.origin === ORIGIN &&
      redirect.origin === ORIGIN && redirect.pathname === '/api/auth/deriv/callback' &&
      Boolean(CLIENT && SECRET.length >= 32);
  } catch { return false; }
};
function key() { return createHash('sha256').update(SECRET).digest(); }
function seal(data) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
function open(value) {
  try {
    if (!value || value.length > 8000) return null;
    const b = Buffer.from(value, 'base64url');
    if (b.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', key(), b.subarray(0,12));
    decipher.setAuthTag(b.subarray(12,28));
    const data = JSON.parse(Buffer.concat([decipher.update(b.subarray(28)), decipher.final()]).toString());
    return data && Number.isFinite(data.exp) && data.exp > Date.now() ? data : null;
  } catch { return null; }
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split('=')).filter(x => x.length === 2));
}
function cookie(name, value, seconds) {
  return name + '=' + value + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + seconds;
}
function respond(res, status, body) { res.status(status).json(body); }
function redirect(res, url) { res.writeHead(302, { Location: url }); res.end(); }
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const path = String(req.query.route || '').replace(/^\/+/, '');
  const configured = validConfig();
  const cs = cookies(req);
  const session = configured ? open(cs['__Host-playgo_session']) : null;
  if (path === 'health' && req.method === 'GET') return respond(res, 200, { status: 'ok', execution: false });
  if (path === 'session' && req.method === 'GET') return respond(res, 200, { authenticated: !!session, configured, execution: false, mt5: 'not_linked' });
  if (path === 'auth/deriv/start' && req.method === 'GET') {
    if (!configured) return respond(res, 503, { error: 'Configure DERIV_CLIENT_ID, PLAYGO_COOKIE_SECRET, APP_ORIGIN and DERIV_REDIRECT_URI in Vercel.' });
    const state = random(), verifier = random();
    res.setHeader('Set-Cookie', cookie('__Host-playgo_oauth', seal({ state, verifier, exp: Date.now() + 300000 }), 300));
    const url = new URL('https://auth.deriv.com/oauth2/auth');
    url.search = new URLSearchParams({ response_type: 'code', client_id: CLIENT, redirect_uri: REDIRECT, scope: SCOPES, state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
    return redirect(res, url.toString());
  }
  if (path === 'auth/deriv/callback' && req.method === 'GET') {
    res.setHeader('Set-Cookie', cookie('__Host-playgo_oauth', '', 0));
    if (!configured) return respond(res, 503, { error: 'OAuth server is not configured' });
    const flow = open(cs['__Host-playgo_oauth']);
    const state = String(req.query.state || '');
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!flow || !state || !code || req.query.error ||
      Buffer.byteLength(state) !== Buffer.byteLength(flow.state) ||
      !timingSafeEqual(Buffer.from(state), Buffer.from(flow.state))) return redirect(res, ORIGIN + '/?auth_error=invalid_callback');
    try {
      const response = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: CLIENT, code, code_verifier: flow.verifier, redirect_uri: REDIRECT }),
        signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('token exchange failed');
      const data = await response.json();
      if (typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new Error('invalid token');
      const seconds = Math.min(data.expires_in, 28800);
      const tokenCookie = cookie('__Host-playgo_session', seal({ token: data.access_token, exp: Date.now() + seconds * 1000 }), seconds);
      res.setHeader('Set-Cookie', [cookie('__Host-playgo_oauth', '', 0), tokenCookie]);
      return redirect(res, ORIGIN + '/');
    } catch { return redirect(res, ORIGIN + '/?auth_error=exchange_failed'); }
  }
  if (path === 'auth/logout' && req.method === 'POST') {
    if (req.headers.origin !== ORIGIN || req.headers['x-playgo-request'] !== '1') return respond(res, 403, { error: 'Request origin rejected' });
    res.setHeader('Set-Cookie', cookie('__Host-playgo_session', '', 0));
    return respond(res, 200, { ok: true });
  }
  if (!session) return respond(res, 401, { error: 'Sign in with Deriv first.' });
  if (path === 'accounts' && req.method === 'GET') {
    try {
      const response = await fetch(ACCOUNTS_URL, { headers: { Authorization: 'Bearer ' + session.token }, signal: AbortSignal.timeout(15000) });
      if (response.status === 401) {
        res.setHeader('Set-Cookie', cookie('__Host-playgo_session', '', 0));
        return respond(res, 401, { error: 'Your Deriv session expired. Sign in again.' });
      }
      if (!response.ok) throw new Error('broker unavailable');
      const data = await response.json();
      const rows = Array.isArray(data.data) ? data.data : data.data?.accounts ?? data.accounts;
      if (!Array.isArray(rows)) throw new Error('invalid account schema');
      return respond(res, 200, { accounts: rows.map(a => ({
        account_id: String(a.account_id ?? a.id ?? a.loginid ?? ''),
        account_type: typeof a.account_type === 'string' ? a.account_type : null,
        currency: typeof a.currency === 'string' ? a.currency : null,
        balance: typeof a.balance === 'number' || typeof a.balance === 'string' ? a.balance : null
      })) });
    } catch { return respond(res, 502, { error: 'Could not retrieve Deriv accounts.' }); }
  }
  if (path === 'mt5/status' && req.method === 'GET') return respond(res, 200, { status: 'not_linked', execution: false });
  if (path.startsWith('orders') || path.startsWith('bots')) return respond(res, 501, { error: 'Order execution and automated trading are not implemented.' });
  return respond(res, 404, { error: 'Route not found' });
}
