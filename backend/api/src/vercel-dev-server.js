import {createServer} from 'node:http';
import handler from './vercel-handler.js';

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB cap to prevent memory exhaustion

async function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw Error('PAYLOAD_TOO_LARGE');
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw Error('PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return undefined;
  const body = Buffer.concat(chunks).toString('utf8');
  if (req.headers['content-type']?.includes('application/json')) {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  return body;
}

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a valid TCP port.');
}

const host = process.env.PLAYGO_DEV_HOST || '127.0.0.1';

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  req.query = Object.fromEntries(url.searchParams);
  try {
    req.body = await readBody(req);
  } catch {
    res.statusCode = 413;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Request body too large' }));
    return;
  }
  res.status = function status(code) {
    this.statusCode = code;
    return this;
  };
  res.json = function json(body) {
    this.setHeader('Content-Type', 'application/json; charset=utf-8');
    this.end(JSON.stringify(body));
  };

  try {
    await handler(req, res);
  } catch (err) {
    console.error('Vercel API dev handler failed:', err && err.message);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Request failed' }));
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

server.listen(port, host, () => {
  console.log(`PlayGo dev API listening on http://${host}:${port}`);
});
