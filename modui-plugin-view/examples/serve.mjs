// SPDX-FileCopyrightText: 2012-2026 MOD Audio UG
// SPDX-License-Identifier: AGPL-3.0-or-later

// A frontend that is NOT served by mod-ui: this folder on its own port, every other path (HTTP and the WebSocket) proxied to mod-ui.
// It is what a Vite `server.proxy` does for a React app; the backend sends no CORS headers, so the browser must see one origin.
//
//   node examples/serve.mjs [--target http://localhost:8888] [--port 9000]
//
// Then open http://localhost:9000/. Build the two libraries first (`npm run build` in modui-client/ and modui-plugin-view/).

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const target = new URL(option('target', 'http://localhost:8888'));
const port = Number(option('port', '9000'));
const here = fileURLToPath(new URL('.', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };

const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  // The example's own files.
  const local = join(here, path === '/' ? 'index.html' : path.slice(1));
  if (local.startsWith(here) && existsSync(local) && statSync(local).isFile()) {
    res.writeHead(200, { 'Content-Type': types[extname(local)] ?? 'application/octet-stream' });
    createReadStream(local).pipe(res);
    return;
  }
  // Everything else is mod-ui.
  const proxied = request(
    { host: target.hostname, port: target.port || 80, method: req.method, path: req.url, headers: { ...req.headers, host: target.host } },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    },
  );
  proxied.on('error', (error) => {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`mod-ui is not reachable at ${target.href}: ${error.message}`);
  });
  req.pipe(proxied);
});

// WebSocket: pass the upgrade request and then the raw bytes both ways.
server.on('upgrade', (req, socket, head) => {
  const upstream = connect(Number(target.port || 80), target.hostname, () => {
    // Tornado refuses a WebSocket whose Origin is not its own host (403): present the request as coming from mod-ui itself.
    const headers = Object.entries({ ...req.headers, host: target.host, origin: target.origin }).map(([key, value]) => `${key}: ${value}`);
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers.join('\r\n')}\r\n\r\n`);
    upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

server.on('error', (error) => {
  if (error.code !== 'EADDRINUSE') throw error;
  console.error(`Port ${port} is already in use: pick another one with --port (e.g. --port ${port + 1}).`);
  process.exit(1);
});
server.listen(port, () => console.log(`Example on http://localhost:${port}/ (mod-ui: ${target.href})`));
