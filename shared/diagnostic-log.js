const SECRET_PATTERN =
  /((?:access[_-]?token|refresh[_-]?token|client[_-]?secret|service[_-]?role|password|authorization[_-]?code|auth[_-]?code|authorization|cookie|api[_-]?key|credential|token|session|secret|otp)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi;
const AUTH_BEARER_PATTERN = /((?:authorization|auth[_-]?header)\s*[:=]\s*)Bearer\s+[^\s,;&]+/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\b/g;
const SAFE_OBJECT_KEYS = new Set([
  'code',
  'message',
  'name',
  'status',
  'statusCode',
  'statusText',
  'route',
  'method',
  'type',
  'reason',
  'event',
  'symbol',
  'contractId',
  'requestId',
]);

export function redactDiagnosticText(value, maxLength = 1200) {
  return String(value ?? '')
    .replace(AUTH_BEARER_PATTERN, '$1[REDACTED]')
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(SECRET_PATTERN, '$1[REDACTED]')
    .replace(JWT_PATTERN, '[REDACTED]')
    .slice(0, maxLength);
}

function safeConsoleValue(value) {
  if (value instanceof Error) return value.name + ': ' + value.message;
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return String(value);
  if (Array.isArray(value)) return '[Array(' + value.length + ')]';
  if (typeof value !== 'object') return '[' + typeof value + ']';
  const safe = Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, item]) =>
          SAFE_OBJECT_KEYS.has(key) && (item === null || ['string', 'number', 'boolean'].includes(typeof item))
      )
      .slice(0, 8)
  );
  return Object.keys(safe).length ? JSON.stringify(safe) : '[Object]';
}

export function formatBrowserConsoleMessage(args) {
  return redactDiagnosticText(Array.from(args, safeConsoleValue).join(' '), 1000);
}
