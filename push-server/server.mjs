import http from 'node:http';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';

const root = dirname(fileURLToPath(import.meta.url));
const statePath = process.env.PUSH_STATE_PATH || join(root, 'subscriptions.json');
const port = Number(process.env.PORT || 8787);
const origin = process.env.ALLOWED_ORIGIN || 'https://pyw31337.github.io';
const dispatchToken = process.env.WEB_PUSH_DISPATCH_TOKEN || '';
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:owner@example.com';
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';

if (!vapidPublicKey || !vapidPrivateKey) throw new Error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are required');
webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

async function readState() {
  try { return JSON.parse(await readFile(statePath, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeState(subscriptions) {
  const temp = `${statePath}.tmp`;
  await writeFile(temp, JSON.stringify(subscriptions, null, 2));
  await rename(temp, statePath);
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

async function bodyOf(request) {
  let body = '';
  for await (const chunk of request) body += chunk;
  if (body.length > 100_000) throw new Error('request too large');
  return JSON.parse(body || '{}');
}

async function handleSubscribe(request, response) {
  const payload = await bodyOf(request);
  const subscription = payload.subscription;
  if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    return sendJson(response, 400, { error: 'invalid subscription' });
  }
  const subscriptions = await readState();
  const next = subscriptions.filter((item) => item.subscription.endpoint !== subscription.endpoint);
  next.push({ subscription, preferences: payload.preferences || { porkAtOrBelow: 1700, beefAtOrBelow: 7000 }, updatedAt: new Date().toISOString() });
  await writeState(next);
  return sendJson(response, 201, { ok: true });
}

async function handleDispatch(request, response) {
  if (!dispatchToken || request.headers.authorization !== `Bearer ${dispatchToken}`) return sendJson(response, 401, { error: 'unauthorized' });
  const payload = await bodyOf(request);
  const subscriptions = await readState();
  const stale = new Set();
  await Promise.all(subscriptions.map(async (item) => {
    try { await webpush.sendNotification(item.subscription, JSON.stringify(payload)); }
    catch (error) { if (error.statusCode === 404 || error.statusCode === 410) stale.add(item.subscription.endpoint); }
  }));
  if (stale.size) await writeState(subscriptions.filter((item) => !stale.has(item.subscription.endpoint)));
  return sendJson(response, 200, { ok: true, delivered: subscriptions.length - stale.size, removed: stale.size });
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return sendJson(response, 204, {});
  try {
    if (request.method === 'POST' && request.url === '/push/subscriptions') return await handleSubscribe(request, response);
    if (request.method === 'POST' && request.url === '/push/dispatch') return await handleDispatch(request, response);
    return sendJson(response, 404, { error: 'not found' });
  } catch (error) {
    console.error(error);
    return sendJson(response, 500, { error: 'internal error' });
  }
});

server.listen(port, () => console.log(`Meat Tracker push server listening on :${port}`));
