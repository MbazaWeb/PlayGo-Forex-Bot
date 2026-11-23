#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const ENV_PATH = '.env';

function loadEnv() {
  try {
    const content = readFileSync(ENV_PATH, 'utf8');
    const env = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf(':');
      const eq2 = trimmed.indexOf('=');
      const idx = eq2 === -1 ? eq : (eq === -1 ? eq2 : Math.min(eq, eq2));
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
    return env;
  } catch {
    return null;
  }
}

const env = loadEnv();
if (!env) {
  console.error('FAIL: .env file not found.');
  process.exit(1);
}

const errors = [];
const warnings = [];

const required = ['DERIV_CLIENT_ID', 'DERIV_REDIRECT_URI', 'APP_ORIGIN', 'PLAYGO_COOKIE_SECRET'];
for (const k of required) {
  if (!env[k]) errors.push(`Missing required var: ${k}`);
}

if (env.PLAYGO_ENV === 'local') {
  if (!env.PLAYGO_LOCAL_REST_URL) errors.push('Missing PLAYGO_LOCAL_REST_URL for local mode');
  if (!env.PLAYGO_LOCAL_WORKER_JWT) errors.push('Missing PLAYGO_LOCAL_WORKER_JWT for local mode');
} else {
  if (!env.SUPABASE_URL) errors.push('Missing SUPABASE_URL for hosted mode');
  if (!env.SUPABASE_SERVICE_ROLE_KEY) errors.push('Missing SUPABASE_SERVICE_ROLE_KEY for hosted mode');
}

if (env.APP_ORIGIN && env.APP_ORIGIN.endsWith('/')) {
  errors.push(`APP_ORIGIN has trailing slash: "${env.APP_ORIGIN}" -> remove it`);
}

if (env.APP_ORIGIN && env.DERIV_REDIRECT_URI) {
  let appOrigin, redirectOrigin;
  try { appOrigin = new URL(env.APP_ORIGIN).origin; } catch { errors.push(`APP_ORIGIN invalid URL`); }
  try { redirectOrigin = new URL(env.DERIV_REDIRECT_URI).origin; } catch { errors.push(`DERIV_REDIRECT_URI invalid URL`); }
  if (appOrigin && redirectOrigin && appOrigin !== redirectOrigin) {
    errors.push(`ORIGIN MISMATCH: APP_ORIGIN (${appOrigin}) != DERIV_REDIRECT_URI (${redirectOrigin})`);
  }
  if (env.DERIV_REDIRECT_URI) {
    try {
      const path = new URL(env.DERIV_REDIRECT_URI).pathname;
      if (path !== '/api/auth/deriv/callback') {
        errors.push(`DERIV_REDIRECT_URI path must be /api/auth/deriv/callback, got: ${path}`);
      }
    } catch {}
  }
}

if (env.APP_ORIGIN) {
  try {
    const u = new URL(env.APP_ORIGIN);
    if (u.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(u.hostname)) {
      errors.push(`APP_ORIGIN must be HTTPS unless localhost`);
    }
  } catch {}
}

if (!env.PLAYGO_COOKIE_SECRET) {
  errors.push('Missing PLAYGO_COOKIE_SECRET (>=32 chars). Generate: -join ((48..57)+(97..122) | Get-Random -Count 48 | % {[char]$_})');
} else if (env.PLAYGO_COOKIE_SECRET.length < 32) {
  errors.push(`PLAYGO_COOKIE_SECRET too short (${env.PLAYGO_COOKIE_SECRET.length} chars)`);
}

if (env.PLAYGO_ENV === 'local' && env.SUPABASE_URL && /^https:\/\/[^/]+\.supabase\.co/.test(env.SUPABASE_URL)) {
  errors.push('PLAYGO_ENV=local with remote Supabase URL. Remove PLAYGO_ENV or use local PostgREST.');
}

if (env.PLAYGO_ENV === 'local' && env.PLAYGO_LOCAL_REST_URL && !/^http:\/\/127\.0\.0\.1:[1-9]/.test(env.PLAYGO_LOCAL_REST_URL)) {
  errors.push(`PLAYGO_LOCAL_REST_URL must be http://127.0.0.1:PORT`);
}

if (env.LIVE_TRADING_ENABLED !== 'true') warnings.push('Real order execution remains disabled until LIVE_TRADING_ENABLED=true');

if (env.PLAYGO_ENV !== 'local' && env.SUPABASE_URL && !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(env.SUPABASE_URL)) {
  errors.push(`SUPABASE_URL must match https://[project].supabase.co`);
}

if (env.SUPABASE_SERVICE_ROLE_KEY && !env.SUPABASE_SERVICE_ROLE_KEY.startsWith('eyJ')) {
  warnings.push('SUPABASE_SERVICE_ROLE_KEY should start with eyJ (JWT)');
}

console.log('=== PlayGo-Forex-Bot .env Validator ===\n');

if (warnings.length) {
  console.log('WARNINGS:');
  for (const w of warnings) console.log(`  ! ${w}`);
  console.log('');
}

if (errors.length) {
  console.log('ERRORS:');
  for (const e of errors) console.log(`  X ${e}`);
  console.log('');
  console.log(`Result: FAIL (${errors.length} error(s), ${warnings.length} warning(s))`);
  process.exit(1);
}

console.log(`Result: PASS (0 errors, ${warnings.length} warning(s))`);
process.exit(0);
