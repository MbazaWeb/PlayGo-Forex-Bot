import {createServer} from 'node:http';
import handler from '../../web/api/handler.js';

async function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  req.query = Object.fromEntries(url.searchParams);
  req.body = await readBody(req);
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
  } catch {
    console.error('Vercel API dev handler failed.');
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({error: 'Request failed'}));
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

server.listen(port, '0.0.0.0');
