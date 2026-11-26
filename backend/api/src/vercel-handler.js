import {readPortfolio, readHistory, closePortfolioContract} from './portfolio/index.js';
import {isDerivAccount, startRealAgents, stopRealAgents, readRealAgentStatuses, runRealAgentTick, placeRealAgentOrders, calculateStake, MAX_STAKE_ABSOLUTE_USD, MAX_STAKE_PERCENT} from '../../trading/agents/index.js';
import {listAccounts} from './providers/deriv.js';
import { createHash, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import {accountReference, activateAccount, publicAccount, publicAccountBody, publicAgentResult, resolveActiveAccount} from './account-selection.js';
import {readCurrencyPerUsd} from '../../trading/execute.js';
import {readAutoStartPreference, writeAutoStartPreference, recordBrowserConsoleLogs} from '../../trading/real-store.js';
import {readJsonBody} from './read-json-body.js';

const ORIGIN = process.env.APP_ORIGIN || '';
const REDIRECT = process.env.DERIV_REDIRECT_URI || '';
const CLIENT = process.env.DERIV_CLIENT_ID || '';
const SECRET = process.env.PLAYGO_COOKIE_SECRET || '';
const SCOPES = process.env.DERIV_SCOPES || 'trade';
const TOKEN_URL = 'https://auth.deriv.com/oauth2/token';
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
function respond(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
function redirect(res, url) { res.writeHead(302, { Location: url }); res.end(); }
function logCorrelatedRequest(req, res, path, accountRef) {
  if (!accountRef || typeof res.once !== 'function') return;
  const headerId = req.headers['x-vercel-id'];
  const requestId = typeof headerId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(headerId)
    ? headerId : randomBytes(16).toString('hex');
  const knownRoutes = new Set([
    'accounts', 'accounts/select', 'diagnostics/client', 'history', 'portfolio', 'portfolio/close',
    'agent/preferences', 'agent/limits', 'agent/status', 'agent/start', 'agent/stop', 'agent/run',
    'agent/place', 'mt5/status',
  ]);
  res.once('finish', () => {
    console.info(JSON.stringify({
      event: 'playgo.api.request',
      requestId,
      accountReference: accountRef,
      method: req.method,
      route: knownRoutes.has(path) ? path : 'other',
      statusCode: res.statusCode,
    }));
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const url = new URL(req.url, 'http://localhost');
  const query = req.query ? new URLSearchParams(req.query) : url.searchParams;
  const routedPath = query.get('route') ?? url.pathname.replace(/^\/api\/?/, '');
  const path = String(routedPath).replace(/^\/+/, '');
  const configured = validConfig();
  const cs = cookies(req);
  const candidate = configured ? open(cs['__Host-playgo_session']) : null;
  const session = typeof candidate?.token === 'string' && candidate.token.length ? candidate : null;

  if (path === 'health' && req.method === 'GET') return respond(res, 200, { status: 'ok', execution: process.env.LIVE_TRADING_ENABLED === 'true' });
  if (path === 'session' && req.method === 'GET') return respond(res, 200, { authenticated: !!session, configured, execution: process.env.LIVE_TRADING_ENABLED === 'true', mt5: 'not_linked' });

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
    const state = query.get('state') || '';
    const code = query.get('code') || '';
    if (typeof flow?.state !== 'string' || typeof flow.verifier !== 'string' || !state || !code || query.get('error') ||
      Buffer.byteLength(state) !== Buffer.byteLength(flow.state) ||
      !timingSafeEqual(Buffer.from(state), Buffer.from(flow.state))) return redirect(res, ORIGIN + '/?auth_error=invalid_callback');
    try {
      const response = await fetch(TOKEN_URL, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: CLIENT, code, code_verifier: flow.verifier, redirect_uri: REDIRECT }),
        signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('token exchange failed');
      const data = await response.json();
      if (typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new Error('invalid token');
      const seconds = Math.min(data.expires_in, 28800);
      const tokenCookie = cookie('__Host-playgo_session', seal({ token: data.access_token, exp: Date.now() + seconds * 1000, activeAccountId: null }), seconds);
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

  const params = query;
  if (params.has('account')) return respond(res, 400, { error: 'Use the active Deriv account.' });
  let accounts;
  try {
    accounts = await listAccounts(session.token, fetch, CLIENT);
  } catch (error) {
    const status = error.status || 502;
    if (status === 401) res.setHeader('Set-Cookie', cookie('__Host-playgo_session', '', 0));
    return respond(res, status, { error: status === 401 ? 'Deriv session expired. Sign in again.' : status === 429 ? 'Deriv account service rate limit exceeded.' : 'Could not verify Deriv accounts.' });
  }
  const account = resolveActiveAccount(session, accounts);
  const accountRef = account ? accountReference(session.token, account.account_id) : null;

  logCorrelatedRequest(req, res, path, accountRef);

  if (path === 'diagnostics/client' && req.method === 'POST') {
    if (req.headers.origin !== ORIGIN || req.headers['x-playgo-request'] !== '1')
      return respond(res, 403, { error: 'Request origin rejected.' });
    if (!account || !accountRef) return respond(res, 400, { error: 'Select a connected Deriv account.' });
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      return respond(res, error.message === 'REQUEST_BODY_TOO_LARGE' ? 413 : 400, { error: error.message });
    }
    if (body?.accountRef !== accountRef || !Array.isArray(body?.entries))
      return respond(res, 400, { error: 'INVALID_BROWSER_DIAGNOSTICS' });
    try {
      const result = await recordBrowserConsoleLogs({
        accountId: account.account_id,
        accountReference: accountRef,
        entries: body.entries,
        requestId: typeof req.headers['x-vercel-id'] === 'string' &&
          /^[A-Za-z0-9._:-]{1,128}$/.test(req.headers['x-vercel-id'])
          ? req.headers['x-vercel-id'] : null,
        fetchImpl: fetch,
      });
      return respond(res, 202, result);
    } catch (error) {
      const code = error.code || error.message || 'BROWSER_DIAGNOSTICS_WRITE_FAILED';
      return respond(res, code.startsWith('INVALID_') ? 400 : 503, { error: code });
    }
  }

  if (path === 'accounts' && req.method === 'GET')
    return respond(res, 200, {
      accounts: accounts.filter(isDerivAccount).map(row => publicAccount(row, session.token)),
      activeAccountRef: accountRef,
    });

  if (path === 'accounts/select' && req.method === 'POST') {
    if (req.headers.origin !== ORIGIN || req.headers['x-playgo-request'] !== '1')
      return respond(res, 403, { error: 'Request origin rejected.' });
    try {
      const selected = await activateAccount({
        session, accounts, accountRef: params.get('accountRef'), token: session.token,
        confirmReal: params.get('confirmReal') === '1', appId: CLIENT, env: process.env, fetchImpl: fetch,
      });
      const seconds = Math.max(1, Math.floor((session.exp - Date.now()) / 1000));
      res.setHeader('Set-Cookie', cookie('__Host-playgo_session', seal(session), seconds));
      return respond(res, 200, { activeAccount: publicAccount(selected, session.token) });
    } catch (error) {
      const code = error.code || 'ACCOUNT_SELECTION_FAILED';
      return respond(res, code === 'ACCOUNT_SWITCH_OPEN_POSITIONS' ? 409 :
        ['REAL_ACCOUNT_CONFIRMATION_REQUIRED', 'ACCOUNT_REFERENCE_NOT_FOUND'].includes(code) ? 400 : 503, { error: code });
    }
  }

  if (path.startsWith('agent/') && !account)
    return respond(res, 400, { error: 'Select a connected Deriv account.' });

  if (path === 'agent/preferences' && req.method === 'GET') {
    try {
      const enabled = await readAutoStartPreference({ accountId: account.account_id, env: process.env, fetchImpl: fetch });
      return respond(res, 200, { accountRef, autoStartEnabled: enabled });
    } catch (error) {
      return respond(res, 503, { error: error.code || 'AUTO_START_SETTINGS_UNAVAILABLE' });
    }
  }
  if (path === 'agent/preferences' && req.method === 'POST') {
    if (req.headers.origin !== ORIGIN || req.headers['x-playgo-request'] !== '1')
      return respond(res, 403, { error: 'Request origin rejected.' });
    const enabled = params.get('enabled');
    if (!['0', '1'].includes(enabled)) return respond(res, 400, { error: 'Invalid auto-start setting.' });
    if (enabled === '1' && account.account_type === 'real' && params.get('confirmReal') !== '1')
      return respond(res, 400, { error: 'REAL_AUTO_START_CONFIRMATION_REQUIRED' });
    try {
      await writeAutoStartPreference({ accountId: account.account_id, enabled: enabled === '1', env: process.env, fetchImpl: fetch });
      return respond(res, 200, { accountRef, autoStartEnabled: enabled === '1' });
    } catch (error) {
      return respond(res, 503, { error: error.code || 'AUTO_START_SETTINGS_UNAVAILABLE' });
    }
  }
  if (path === 'agent/limits' && req.method === 'GET') {
    try {
      const currencyPerUsd = await readCurrencyPerUsd({ account, token: session.token, appId: CLIENT, fetchImpl: fetch });
      const stake = calculateStake(Number(account.balance), account.currency, currencyPerUsd);
      return respond(res, 200, {
        accountRef, currency: account.currency, stake,
        maxStake: MAX_STAKE_ABSOLUTE_USD * currencyPerUsd,
        sizingPercent: MAX_STAKE_PERCENT * 100,
      });
    } catch (error) {
      return respond(res, 503, { error: error.code || error.message || 'STAKE_LIMIT_UNAVAILABLE' });
    }
  }

  if (path === 'agent/status' && req.method === 'GET') {
    return respond(res, 200, {
      accounts: (await readRealAgentStatuses({ accounts: [account], env: process.env, fetchImpl: fetch }))
        .map(row => publicAgentResult(row, accountRef)),
    });
  }

  if (['agent/start', 'agent/stop', 'agent/run', 'agent/place'].includes(path) && req.method === 'POST') {
    if (req.headers.origin !== ORIGIN || req.headers['x-playgo-request'] !== '1')
      return respond(res, 403, { error: 'Request origin rejected.' });
    if (path === 'agent/start') {
      try {
        return respond(res, 200, {
          accounts: (await startRealAgents({
            accounts: [account],
            stopLossPercent: Number(params.get('stopLossPercent')),
            takeProfitPercent: Number(params.get('takeProfitPercent')),
            env: process.env,
            fetchImpl: fetch,
          })).map(row => publicAgentResult(row, accountRef)),
        });
      } catch (error) {
        const code = error.code || 'AGENT_START_FAILED';
        return respond(res, code === 'LIVE_TRADING_DISABLED' ? 403 : ['REAL_ACCOUNT_REQUIRED', 'INVALID_EXIT_SETTINGS'].includes(code) ? 400 : 503, { error: code });
      }
    }
    if (path === 'agent/stop') {
      return respond(res, 200, {
        accounts: (await stopRealAgents({ accounts: [account], env: process.env, fetchImpl: fetch }))
          .map(row => publicAgentResult(row, accountRef)),
      });
    }
    if (path === 'agent/place') {
      try {
        return respond(res, 200, {
          accounts: (await placeRealAgentOrders({
            accounts: [account],
            token: session.token,
            appId: CLIENT,
            symbol: params.get('symbol'),
            granularity: Number(params.get('granularity')),
          automatic: params.get('mode') === 'automatic',
            terminalAction: params.get('terminalAction'),
            orderRequestId: params.get('orderRequestId'),
          stopLossPercent: Number(params.get('stopLossPercent')),
            takeProfitPercent: Number(params.get('takeProfitPercent')),
            env: process.env,
            fetchImpl: fetch,
          })).map(row => publicAgentResult(row, accountRef)),
        });
      } catch (error) {
        const code = error.code || 'AGENT_PLACE_FAILED';
        return respond(res, code === 'LIVE_TRADING_DISABLED' ? 403 : ['REAL_ACCOUNT_REQUIRED', 'INVALID_EXIT_SETTINGS', 'INVALID_MARKET_REQUEST','INVALID_TERMINAL_ACTION'].includes(code) ? 400 : 503, { error: code });
      }
    }
    const results = [];
    for (const row of [account]) {
      try {
        results.push(await runRealAgentTick({
          account: row,
          token: session.token,
          appId: CLIENT,
          symbol: params.get('symbol'),
          granularity: Number(params.get('granularity')),
          automatic: params.get('mode') === 'automatic',
          exitsOnly: params.get('exitsOnly') === '1',
          marketScan: params.get('marketScan') === '1',
          env: process.env,
          fetchImpl: fetch,
        }));
      } catch (error) {
        results.push({
          accountId: row.account_id,
          status: 'error',
          reason: error.code || 'AGENT_RUN_FAILED',
        });
      }
    }
    return respond(res, 200, { accounts: results.map(row => publicAgentResult(row, accountRef)) });
  }

  if (path === 'portfolio/close' && req.method === 'POST') {
    if (!account) return respond(res, 400, { error: 'Select a connected Deriv account.' });
    if (req.headers.origin !== ORIGIN || req.headers['x-playgo-request'] !== '1')
      return respond(res, 403, { error: 'Request origin rejected.' });
    const result = await closePortfolioContract({
      account, contractId: params.get('contract'), token: session.token, appId: CLIENT,
    });
    return respond(res, result.status, publicAccountBody(result.body, accountRef));
  }

  if (['portfolio', 'history'].includes(path) && req.method === 'GET') {
    if (!account) return respond(res, 400, { error: 'Select a connected Deriv account.' });
    const read = path === 'history' ? readHistory : readPortfolio;
    const result = await read({
      account,
      token: session.token,
      accountRef,
      includeEvidence: params.get('report') === '1',
      range: params.has('range') ? { mode: params.get('range'), from: params.get('from'), to: params.get('to') } : null,
      offset: params.has('offset') ? Number(params.get('offset')) : 0,
      limit: params.has('limit') ? Number(params.get('limit')) : 500,
      appId: CLIENT,
      env: process.env,
      fetchImpl: fetch,
    });
    return respond(res, result.status, publicAccountBody(result.body, accountRef));
  }

  if (path === 'mt5/status' && req.method === 'GET') return respond(res, 200, { status: 'not_linked', execution: false });
  if (path.startsWith('orders') || path.startsWith('bots')) return respond(res, 501, { error: 'Route not available.' });
  return respond(res, 404, { error: 'Route not found' });
}