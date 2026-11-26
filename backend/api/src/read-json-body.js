const MAX_BODY_BYTES = 24 * 1024;

export async function readJsonBody(req) {
  const body = req.body;
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) throw Error('REQUEST_BODY_TOO_LARGE');
    return body;
  }
  if (typeof body === 'string') {
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw Error('REQUEST_BODY_TOO_LARGE');
    try {
      return JSON.parse(body);
    } catch {
      throw Error('INVALID_JSON_BODY');
    }
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(body)) return parseBuffer(body);
  if (typeof req[Symbol.asyncIterator] !== 'function') throw Error('INVALID_JSON_BODY');

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw Error('REQUEST_BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  return parseBuffer(Buffer.concat(chunks));
}

function parseBuffer(buffer) {
  if (buffer.length > MAX_BODY_BYTES) throw Error('REQUEST_BODY_TOO_LARGE');
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw Error('INVALID_JSON_BODY');
  }
}
