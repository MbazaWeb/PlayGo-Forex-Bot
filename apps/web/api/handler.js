import {strategyStore} from '../server/trading/strategy-store.js';
import {readOperations} from '../server/trading/operations.js';
import {listAccounts} from '../../api/src/providers/deriv.js';
import {readDemoPortfolio,readDemoHistory,readMarketQuote,readDemoSignal} from '../server/trading/demo-portfolio.js';
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

const dbConfig = () => {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return /^https:\/\/[^/]+\.supabase\.co\/?$/.test(url) && key.length > 20 ? { url: url.replace(/\/$/, ''), key } : null;
};
async function dbRequest(db, endpoint, options = {}) {
  return fetch(db.url + '/rest/v1/' + endpoint, {
    ...options,
    headers: { apikey: db.key, Authorization: 'Bearer ' + db.key, ...options.headers },
    signal: AbortSignal.timeout(12000)
  });
}
function safeSnapshot(data) {
  if (!data || data.status !== 'connected' || data.terminal?.connected !== true ||
      !Number.isFinite(Date.parse(data.timestamp)) || Math.abs(Date.now() - Date.parse(data.timestamp)) > 120000 ||
      !data.account || !Number.isSafeInteger(data.account.login) ||
      typeof data.account.server !== 'string' || data.account.server.length > 120 ||
      !Array.isArray(data.positions) || data.positions.length > 500) return false;
  const a = data.account;
  if (!['balance','equity','margin','margin_free','profit'].every(k => typeof a[k] === 'number' && Number.isFinite(a[k]))) return false;
  return data.positions.every(p => Number.isSafeInteger(p.ticket) && typeof p.symbol === 'string' && p.symbol.length <= 32 &&
    ['buy','sell'].includes(p.type) && ['volume','price_open','price_current','profit'].every(k => typeof p[k] === 'number' && Number.isFinite(p[k])));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const path = String(req.query.route || '').replace(/^\/+/, '');
  const configured = validConfig();
  const cs = cookies(req);
  const candidate = configured ? open(cs['__Host-playgo_session']) : null;
  const session = typeof candidate?.token === 'string' && candidate.token.length ? candidate : null;

  if (path === 'mt5/ingest' && req.method === 'POST') {
    const secret = process.env.PLAYGO_MT5_SYNC_TOKEN || '';
    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (secret.length < 32 || Buffer.byteLength(token) !== Buffer.byteLength(secret) ||
        !timingSafeEqual(Buffer.from(token), Buffer.from(secret))) return respond(res, 401, { error: 'Unauthorized' });
    const db = dbConfig();
    const expectedLogin = Number(process.env.MT5_EXPECTED_LOGIN);
    const expectedServer = process.env.MT5_EXPECTED_SERVER || '';
    if (!db || !Number.isSafeInteger(expectedLogin) || !expectedServer) return respond(res, 503, { error: 'MT5 ingest not configured' });
    const data = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return null; } })() : req.body;
    if (!safeSnapshot(data) || data.account.login !== expectedLogin || data.account.server !== expectedServer)
      return respond(res, 400, { error: 'Invalid account or stale snapshot' });
    if (Buffer.byteLength(JSON.stringify(data)) > 100000) return respond(res, 413, { error: 'Snapshot too large' });
    try {
      const result = await dbRequest(db, 'playgo_mt5_snapshots?on_conflict=id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify([{ id: 'primary', account_login: expectedLogin, account_server: expectedServer,
          observed_at: data.timestamp, received_at: new Date().toISOString(), snapshot: data }])
      });
      if (!result.ok) throw Error('Database rejected snapshot');
      return respond(res, 200, { ok: true, execution: false });
    } catch { return respond(res, 503, { error: 'Snapshot storage unavailable' }); }
  }
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
    if (typeof flow?.state !== 'string' || typeof flow.verifier !== 'string' || !state || !code || req.query.error ||
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
  if (path === 'demo/strategy' && ['GET','POST'].includes(req.method)) {
    const write=req.method==='POST';
    if(write && (req.headers.origin!==ORIGIN || req.headers['x-playgo-request']!=='1'))
      return respond(res,403,{error:'Request origin rejected'});
    try {
      const params=new URLSearchParams(req.query);
      const accounts=await listAccounts(session.token,fetch,CLIENT);
      const row=await strategyStore({accountId:params.get('account'),accounts,fetchImpl:fetch},write?'save':params.get('view')==='history'?'history':'read',{
        packId:params.get('pack'),fast:Number(params.get('fast')),slow:Number(params.get('slow')),
        enabled:params.get('enabled')==='true'?true:params.get('enabled')==='false'?false:null
      });
      return respond(res,200,{strategy:row});
    } catch(err) {
      return respond(res,err.message==='DEMO_ACCOUNT_REQUIRED'?403:err.message==='INVALID_STRATEGY'?400:err.status||503,{error:'Strategy unavailable'});
    }
  }
  if (['demo/portfolio','demo/history','demo/quote','demo/operations','demo/signal'].includes(path) && req.method === 'GET') {
    try {
      const accountId = req.query.account;
      const accounts = await listAccounts(session.token, fetch, CLIENT);
      const read = path.endsWith('/operations') ? readOperations : path.endsWith('/history') ? readDemoHistory : readDemoPortfolio;
      const context = {token:session.token, accountId, accounts, appId:CLIENT, fetchImpl:fetch};
      const params = new URLSearchParams(req.query);
      const result = path.endsWith('/signal') ? await readDemoSignal(context,params) : path.endsWith('/quote') ? await readMarketQuote(context, {
        symbol:'frxEURUSD',contractType:params.get('direction') ?? 'CALL',duration:Number(params.get('minutes') ?? 15),durationUnit:'m',stake:Number(params.get('stake') ?? 1)
      }) : await read(context);
      return respond(res, 200, result);
    } catch (err) {
      return respond(res, err.message === 'DEMO_ACCOUNT_REQUIRED' ? 403 : err.message === 'BROKER_RATE_LIMIT' ? 429 : ['INVALID_QUOTE','INVALID_STRATEGY'].includes(err.message) ? 400 : err.status || 502, {error:'Demo portfolio unavailable'});
    }
  }
  if (path === 'accounts' && req.method === 'GET') {
    try {
      const response = await fetch(ACCOUNTS_URL, { headers: { 'Deriv-App-ID': CLIENT, Authorization: 'Bearer ' + session.token }, signal: AbortSignal.timeout(15000) });
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

  if (path === 'mt5/status' && req.method === 'GET') {
    const db = dbConfig(), owner = process.env.MT5_OWNER_DERIV_ACCOUNT_ID || '';
    if (!db || !owner) return respond(res, 200, { status: 'not_linked', execution: false });
    try {
      const identity = await fetch(ACCOUNTS_URL, { headers: { 'Deriv-App-ID': CLIENT, Authorization: 'Bearer ' + session.token }, signal: AbortSignal.timeout(12000) });
      if (!identity.ok) return respond(res, 403, { error: 'Cannot verify account owner' });
      const body = await identity.json();
      const rows = Array.isArray(body.data) ? body.data : body.data?.accounts ?? body.accounts;
      if (!Array.isArray(rows) || !rows.some(a => String(a.account_id ?? a.id ?? a.loginid ?? '') === owner))
        return respond(res, 403, { error: 'MT5 is not paired with this user' });
      const result = await dbRequest(db, 'playgo_mt5_snapshots?id=eq.primary&select=observed_at,snapshot&limit=1');
      if (!result.ok) throw Error('Database unavailable');
      const [row] = await result.json();
      if (!row) return respond(res, 200, { status: 'awaiting_sync', execution: false });
      const age = Date.now() - Date.parse(row.observed_at);
      return respond(res, 200, { status: age >= 0 && age <= 90000 ? 'connected' : 'stale',
        observed_at: row.observed_at, account: row.snapshot.account, positions: row.snapshot.positions, execution: false });
    } catch { return respond(res, 503, { error: 'MT5 status unavailable' }); }
  }

  if (path.startsWith('orders') || path.startsWith('bots')) return respond(res, 501, { error: 'Broker order submission is disabled.' });
  return respond(res, 404, { error: 'Route not found' });
}
