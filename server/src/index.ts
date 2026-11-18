import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import express from 'express';
import { createServer } from 'http';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { monitor } from '@colyseus/monitor';

import { DuelRoom, accounts, records } from './rooms/DuelRoom.js';
import { AuthError } from './accounts.js';

const port = Number(process.env.PORT) || 2567;
const production = process.env.NODE_ENV === 'production';
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '4kb' }));

// The dev client runs on another port, so the API answers cross-origin. Sessions travel in an
// Authorization header, never a cookie, so there is nothing for another site to ride on.
app.use(['/duels', '/auth'], (req, res, next) => {
  res.set('Access-Control-Allow-Origin', process.env.RONIN_ORIGIN ?? '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

// Open duels waiting for an opponent (public, not full). Read by the multiplayer screen.
app.get('/duels', async (_req, res) => {
  const rooms = await matchMaker.query({ name: 'duel', private: false, locked: false });
  res.json(rooms.filter(r => r.clients === 1).map(r => ({ code: r.roomId, host: r.metadata?.host ?? 'Wanderer', record: r.metadata?.record ?? null, verified: !!r.metadata?.verified })));
});

// Accounts. A small per-address limit on top of the per-name lockout in accounts.ts.
const attempts = new Map<string, number[]>();
const limited = (ip: string) => {
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter(t => now - t < 60_000);
  recent.push(now);
  attempts.set(ip, recent);
  return recent.length > 20;
};
const bearer = (h: string | undefined) => (h?.startsWith('Bearer ') ? h.slice(7) : undefined);
const answer = (res: express.Response, fn: () => unknown) => {
  try { res.json(fn()); } catch (e) {
    if (e instanceof AuthError) res.status(e.status).json({ error: e.message });
    else { console.error(e); res.status(500).json({ error: 'Something went wrong on the server.' }); }
  }
};
app.post('/auth/register', (req, res) => {
  if (limited(req.ip ?? '')) { res.status(429).json({ error: 'Too many attempts. Wait a minute.' }); return; }
  answer(res, () => { const r = accounts.register(req.body?.name, req.body?.password); return { ...r, record: records.get(`acct:${r.account.id}`) }; });
});
app.post('/auth/login', (req, res) => {
  if (limited(req.ip ?? '')) { res.status(429).json({ error: 'Too many attempts. Wait a minute.' }); return; }
  answer(res, () => { const r = accounts.login(req.body?.name, req.body?.password); return { ...r, record: records.get(`acct:${r.account.id}`) }; });
});
app.get('/auth/me', (req, res) => {
  const account = accounts.verify(bearer(req.headers.authorization));
  if (!account) { res.status(401).json({ error: 'Not signed in.' }); return; }
  res.json({ account, record: records.get(`acct:${account.id}`) });
});
app.post('/auth/logout', (req, res) => {
  accounts.logout(bearer(req.headers.authorization));
  res.json({ ok: true });
});

// The room inspector can end rooms; only in development.
if (!production) app.use('/colyseus', monitor());

// When the client has been built, this one process serves the whole game.
const clientDist = resolve(process.env.RONIN_CLIENT_DIST ?? '../client/dist');
if (existsSync(resolve(clientDist, 'index.html'))) {
  app.use(express.static(clientDist, { index: 'index.html', maxAge: '1h' }));
  console.log(`[RONIN] Serving the client from ${clientDist}`);
}

const server = createServer(app);
const gameServer = new Server({ transport: new WebSocketTransport({ server }) });

// Server-authoritative 1v1 duels (shared deterministic sim). Quick match and private rooms.
gameServer.define('duel', DuelRoom);

gameServer.listen(port).then(() => {
  console.log(`[RONIN] Game server listening on port ${port}`);
}).catch((err: unknown) => {
  console.error('Error starting server:', err);
});

const shutdown = (signal: string) => {
  console.info(`${signal} received. Shutting down gracefully...`);
  records.flush();
  accounts.flush();
  gameServer.gracefullyShutdown().then(() => process.exit(0));
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
