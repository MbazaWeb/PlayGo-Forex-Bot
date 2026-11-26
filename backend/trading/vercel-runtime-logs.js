const RETENTION_WINDOW_MS = 72 * 60 * 60 * 1000;
const MAX_DEPLOYMENTS = 20;
const MAX_LOGS = 500;
const MAX_RESPONSE_BYTES = 300_000;

function redact(value) {
  return String(value ?? '')
    .replace(/((?:authorization|auth[_-]?header)\s*[:=]\s*)Bearer\s+[^\s,;&]+/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(
      /((?:access[_-]?token|refresh[_-]?token|client[_-]?secret|service[_-]?role|password|authorization[_-]?code|auth[_-]?code|authorization|cookie|api[_-]?key|credential|token|session|secret|otp)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi,
      '$1[REDACTED]'
    )
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\b/g, '[REDACTED]')
    .slice(0, 1200);
}

function parseLogRows(text) {
  const trimmed = text.trim();
  if (!trimmed) return { rows: [], complete: true };
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return { rows: parsed, complete: true };
    if (parsed && typeof parsed === 'object' && typeof parsed.message === 'string')
      return { rows: [parsed], complete: true };
  } catch {}

  const rows = [];
  let complete = true;
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) rows.push(parsed);
      else complete = false;
    } catch {
      complete = false;
    }
  }
  return { rows, complete };
}

async function readLimitedText(response) {
  if (!response.body) {
    const text = await response.text();
    return { text: text.slice(0, MAX_RESPONSE_BYTES), complete: text.length <= MAX_RESPONSE_BYTES };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  let complete = true;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const available = MAX_RESPONSE_BYTES - bytes;
    const chunk = value.subarray(0, Math.max(0, available));
    bytes += chunk.byteLength;
    text += decoder.decode(chunk, { stream: true });
    if (chunk.byteLength !== value.byteLength) {
      complete = false;
      await reader.cancel();
      break;
    }
  }
  text += decoder.decode();
  return { text, complete };
}

function parseMessage(message) {
  if (typeof message !== 'string') return null;
  try {
    const parsed = JSON.parse(message);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function safePath(value) {
  if (typeof value !== 'string') return 'Unavailable';
  const path = value.split('?')[0].split('#')[0];
  return /^\/[A-Za-z0-9/_-]{0,160}$/.test(path) ? path : 'Unavailable';
}

function normalizeLog(row, deploymentId) {
  const timestamp = Number(row.timestampInMs);
  const message = redact(row.message);
  const messageData = parseMessage(row.message);
  const requestId =
    typeof row.requestId === 'string'
      ? row.requestId.slice(0, 128)
      : typeof messageData?.requestId === 'string'
        ? messageData.requestId.slice(0, 128)
        : null;
  return {
    recordedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
    level: typeof row.level === 'string' ? row.level.slice(0, 20) : 'unknown',
    message,
    requestId,
    method: typeof row.requestMethod === 'string' ? row.requestMethod.slice(0, 10) : null,
    path: safePath(row.requestPath || messageData?.route),
    statusCode: Number.isFinite(Number(row.responseStatusCode)) ? Number(row.responseStatusCode) : null,
    deploymentId,
  };
}

async function fetchRuntimeLogs({ projectId, deploymentId, teamId, token, fetchImpl }) {
  const url = new URL(
    'https://api.vercel.com/v1/projects/' +
      encodeURIComponent(projectId) +
      '/deployments/' +
      encodeURIComponent(deploymentId) +
      '/runtime-logs'
  );
  if (teamId) url.searchParams.set('teamId', teamId);
  const response = await fetchImpl(url, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/stream+json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return { rows: [], complete: false, error: 'VERCEL_RUNTIME_LOGS_HTTP_' + response.status };
  const body = await readLimitedText(response);
  const parsed = parseLogRows(body.text);
  return {
    rows: parsed.rows,
    complete: body.complete && parsed.complete,
    error: body.complete && parsed.complete ? null : 'VERCEL_RUNTIME_LOGS_TRUNCATED',
  };
}

export async function readVercelRuntimeLogs({
  accountReference,
  from,
  to,
  env = process.env,
  fetchImpl = fetch,
  now = Date.now(),
}) {
  if (
    !/^[A-Za-z0-9_-]{20,30}$/.test(accountReference || '') ||
    !Number.isSafeInteger(from) ||
    from <= 0 ||
    !Number.isSafeInteger(to) ||
    to < from ||
    to >= 1e11
  )
    throw Error('INVALID_VERCEL_LOG_RANGE');

  const token = env.VERCEL_ACCESS_TOKEN;
  const projectId = env.VERCEL_PROJECT_ID;
  const teamId = env.VERCEL_TEAM_ID;
  if (!token || !projectId) {
    return {
      logs: [],
      status: 'not_configured',
      complete: false,
      note: 'Vercel runtime logs require server-only VERCEL_ACCESS_TOKEN and VERCEL_PROJECT_ID settings.',
      coverageFrom: null,
      coverageTo: null,
    };
  }

  const requestedFrom = from * 1000;
  const requestedTo = Math.min(to * 1000, now);
  const coverageFrom = Math.max(requestedFrom, now - RETENTION_WINDOW_MS);
  let deploymentLimitReached = false;
  let invalidDeploymentRows = false;
  let logLimitReached = false;
  if (coverageFrom > requestedTo) {
    return {
      logs: [],
      status: 'outside_retention',
      complete: false,
      note: 'No Vercel runtime logs are available in the provider retention window for these dates.',
      coverageFrom: new Date(Math.max(0, now - RETENTION_WINDOW_MS)).toISOString(),
      coverageTo: new Date(now).toISOString(),
    };
  }

  let complete = requestedFrom >= now - RETENTION_WINDOW_MS && to * 1000 <= now;
  const url = new URL('https://api.vercel.com/v7/deployments');
  url.searchParams.set('projectId', projectId);
  url.searchParams.set('target', 'production');
  url.searchParams.set('since', String(coverageFrom));
  url.searchParams.set('until', String(requestedTo));
  url.searchParams.set('limit', String(MAX_DEPLOYMENTS));
  if (teamId) url.searchParams.set('teamId', teamId);

  let deployments;
  try {
    const response = await fetchImpl(url, {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return {
        logs: [],
        status: 'error',
        complete: false,
        note:
          'Vercel deployment lookup failed (HTTP ' +
          response.status +
          '). Check the server-side token scope and project ID.',
        coverageFrom: new Date(coverageFrom).toISOString(),
        coverageTo: new Date(requestedTo).toISOString(),
      };
    }
    const body = await response.json();
    deployments = body?.deployments;
    if (!Array.isArray(deployments)) throw Error('INVALID_VERCEL_DEPLOYMENT_RESPONSE');
    deploymentLimitReached = Boolean(body.pagination?.next) || deployments.length >= MAX_DEPLOYMENTS;
    if (deploymentLimitReached) complete = false;
  } catch {
    return {
      logs: [],
      status: 'error',
      complete: false,
      note: 'Vercel deployment lookup failed or returned invalid data.',
      coverageFrom: new Date(coverageFrom).toISOString(),
      coverageTo: new Date(requestedTo).toISOString(),
    };
  }

  const validDeployments = deployments
    .map((row) => row?.uid)
    .filter((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(id))
    .slice(0, MAX_DEPLOYMENTS);
  invalidDeploymentRows = validDeployments.length !== deployments.length;
  if (invalidDeploymentRows) complete = false;
  const results = [];
  for (let offset = 0; offset < validDeployments.length; offset += 4) {
    const batch = await Promise.all(
      validDeployments.slice(offset, offset + 4).map(async (deploymentId) => {
        try {
          const result = await fetchRuntimeLogs({ projectId, deploymentId, teamId, token, fetchImpl });
          return {
            ...result,
            rows: result.rows.map((row) => ({ ...row, deploymentId })),
          };
        } catch {
          return { rows: [], complete: false, error: 'VERCEL_RUNTIME_LOGS_REQUEST_FAILED' };
        }
      })
    );
    results.push(...batch);
  }
  if (results.some((result) => !result.complete)) complete = false;

  const rows = results.flatMap((result) => result.rows);
  const correlatedRequestIds = new Set();
  for (const row of rows) {
    const message = parseMessage(row.message);
    if (
      message?.event === 'playgo.api.request' &&
      message.accountReference === accountReference &&
      typeof message.requestId === 'string'
    )
      correlatedRequestIds.add(message.requestId);
  }

  const filtered = rows
    .filter((row) => {
      const message = parseMessage(row.message);
      return (
        message?.accountReference === accountReference ||
        (typeof row.requestId === 'string' && correlatedRequestIds.has(row.requestId))
      );
    })
    .map((row) => normalizeLog(row, row.deploymentId || null))
    .filter((row) => {
      if (!row.recordedAt) return false;
      const time = Date.parse(row.recordedAt);
      return time >= coverageFrom && time <= requestedTo;
    })
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));

  if (filtered.length > MAX_LOGS) {
    filtered.length = MAX_LOGS;
    complete = false;
    logLimitReached = true;
  }
  const notes = [];
  if (deploymentLimitReached) notes.push('The deployment result limit was reached; some runtime logs may be missing.');
  if (invalidDeploymentRows) notes.push('Some deployment records could not be read.');
  if (logLimitReached) notes.push('The runtime log result limit was reached; some matching entries were omitted.');
  if (requestedFrom < now - RETENTION_WINDOW_MS)
    notes.push('Provider logs older than its current 72-hour coverage window may be unavailable.');
  if (to * 1000 > now) notes.push('The requested end time is in the future; coverage ends at the current time.');
  if (results.some((result) => result.error)) notes.push('Some deployment runtime logs could not be read completely.');
  if (!complete && !notes.length)
    notes.push('The deployment or log result limit was reached; some runtime logs may be missing.');
  return {
    logs: filtered,
    status: complete ? 'complete' : 'partial',
    complete,
    note: notes.join(' ') || 'Vercel runtime logs were loaded for correlated account requests.',
    coverageFrom: new Date(coverageFrom).toISOString(),
    coverageTo: new Date(requestedTo).toISOString(),
  };
}
