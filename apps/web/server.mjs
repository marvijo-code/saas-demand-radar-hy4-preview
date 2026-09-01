#!/usr/bin/env node
/**
 * Static file server for the built web app, with a pass-through proxy for the API.
 *
 * Serving `/api` from the same origin as the page keeps the browser's session cookie
 * first-party, so the HTTP-only cookie works identically in development and in production
 * and no CORS preflight is ever needed. Express is deliberately not used here: the bundle
 * only needs static files plus one streaming proxy, and keeping this standalone means the
 * web port starts instantly and has no dependency on the API package.
 */
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(import.meta.dirname, 'dist');
const port = Number(process.env.WEB_PORT ?? 4173);
const host = process.env.WEB_HOST ?? '127.0.0.1';
const apiOrigin = process.env.API_ORIGIN ?? 'http://127.0.0.1:4174';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

const server = createServer(async (req, res) => {
  try {
    if ((req.url ?? '').startsWith('/api/') || req.url === '/api') {
      await proxyToApi(req, res);
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Static server error: ${message}`);
  }
});

async function serveStatic(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const requested = decodeURIComponent(url.pathname);
  const candidate = join(root, normalize(requested).replace(/^(\.\.[/\\])+/, ''));
  let filePath = candidate;
  let info = await stat(filePath).catch(() => null);
  if (info?.isDirectory()) {
    filePath = join(filePath, 'index.html');
    info = await stat(filePath).catch(() => null);
  }
  // Unknown paths fall back to the SPA shell so deep links such as /needs/12 work.
  if (!info) {
    filePath = join(root, 'index.html');
    info = await stat(filePath).catch(() => null);
  }
  if (!info) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Web bundle is not built. Run `npm run build` first.');
    return;
  }
  const body = await readFile(filePath);
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

/** Forwards the request to the API, preserving method, body, cookies and response headers. */
async function proxyToApi(req, res) {
  const target = new URL(req.url ?? '/api', apiOrigin);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
  }
  headers.set('x-forwarded-host', req.headers.host ?? `${host}:${port}`);

  const init = { method: req.method ?? 'GET', headers, redirect: 'manual' };
  if (!['GET', 'HEAD'].includes(init.method)) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    init.body = Buffer.concat(chunks);
  }

  let upstream;
  try {
    upstream = await fetch(target, init);
  } catch (error) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        error: {
          code: 'api_unreachable',
          message: `The API at ${apiOrigin} did not respond. Start it with \`npm start\`.`,
          details: { reason: error instanceof Error ? error.message : String(error) },
        },
      }),
    );
    return;
  }

  const body = Buffer.from(await upstream.arrayBuffer());
  const outHeaders = {};
  upstream.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase()) || key.toLowerCase() === 'content-encoding') return;
    outHeaders[key] = value;
  });
  const setCookies = typeof upstream.headers.getSetCookie === 'function'
    ? upstream.headers.getSetCookie()
    : [];
  if (setCookies.length) outHeaders['set-cookie'] = setCookies;
  outHeaders['content-length'] = String(body.length);

  res.writeHead(upstream.status, outHeaders);
  res.end(init.method === 'HEAD' ? undefined : body);
}

server.listen(port, host, () => {
  console.log(`[web] serving ${root} on http://${host}:${port} (api → ${apiOrigin})`);
});
