import crypto from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';

const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
let serviceAccount = null;
let projectId = '';
let enabled = false;
let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

function base64Url(value) {
  return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function firestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: 'NULL_VALUE' };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  return { stringValue: String(value) };
}
function fromFirestoreValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  return null;
}
function fromFields(fields = {}) {
  const result = {};
  for (const [key, value] of Object.entries(fields)) result[key] = fromFirestoreValue(value);
  return result;
}

try {
  if (rawServiceAccount) {
    serviceAccount = JSON.parse(rawServiceAccount);
    projectId = String(serviceAccount.project_id || '').trim();
    if (!serviceAccount.client_email || !serviceAccount.private_key || !projectId) throw new Error('service account JSON is incomplete');
    enabled = true;
    console.log(`Points history persistence enabled: project=${projectId}`);
  }
} catch (error) {
  console.error('Points history persistence initialization failed:', error.message);
}

async function getAccessToken() {
  if (!enabled) return null;
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessTokenExpiresAt - now > 60) return cachedAccessToken;
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iss: serviceAccount.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${base64Url(signer.sign(serviceAccount.private_key))}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`Google OAuth token request failed: ${response.status}`);
  const result = await response.json();
  cachedAccessToken = result.access_token;
  cachedAccessTokenExpiresAt = now + Number(result.expires_in || 3600);
  return cachedAccessToken;
}
function documentsUrl(path = '') {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents${path}`;
}
async function firestoreRequest(path, options = {}) {
  const token = await getAccessToken();
  if (!token) return null;
  const response = await fetch(documentsUrl(path), {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
    signal: options.signal || AbortSignal.timeout(8000)
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) throw new Error(`Firestore request failed: ${response.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function addHistory(username, points, messageId, reason = 'help-confirmed') {
  if (!enabled || !username || !Number.isFinite(Number(points)) || Number(points) <= 0) return;
  const safeUsername = encodeURIComponent(String(username));
  try {
    await firestoreRequest(`/regionalPoints/${safeUsername}/pointHistory`, {
      method: 'POST',
      body: JSON.stringify({
        fields: {
          points: firestoreValue(Math.floor(Number(points))),
          reason: firestoreValue(reason === 'help-confirmed' ? '🤝 助け合いに参加' : '地域活動への協力'),
          messageId: firestoreValue(messageId || ''),
          createdAt: firestoreValue(new Date().toISOString())
        }
      })
    });
  } catch (error) {
    console.error(`[points-history] save failed user=${username}:`, error.message);
  }
}

async function loadHistory(username) {
  if (!enabled || !username) return [];
  const safeUsername = encodeURIComponent(String(username));
  try {
    const result = await firestoreRequest(`/regionalPoints/${safeUsername}/pointHistory?pageSize=50` , { method: 'GET' });
    const documents = Array.isArray(result?.documents) ? result.documents : [];
    return documents.map(document => {
      const fields = fromFields(document.fields || {});
      return { points: Number(fields.points || 0), reason: String(fields.reason || '地域活動への協力'), messageId: String(fields.messageId || ''), createdAt: String(fields.createdAt || '') };
    }).filter(item => item.points > 0).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch (error) {
    if (String(error?.message || '').startsWith('Firestore request failed: 404')) return [];
    throw error;
  }
}

export function registerPointsHistory(io) {
  if (!io || io.__pointsHistoryRegistered) return;
  io.__pointsHistoryRegistered = true;

  io.on('connection', socket => {
    socket.on('request-points-history', async (_payload, ack) => {
      const username = String(socket.__regionalPointsUsername || '').trim();
      if (!username) {
        if (typeof ack === 'function') ack({ ok: false, reason: 'unauthorized' });
        return;
      }
      try {
        const history = await loadHistory(username);
        const recent = history.slice(0, 50);
        if (typeof ack === 'function') ack({ ok: true, history: recent });
      } catch (error) {
        console.error(`[points-history] load failed user=${username}:`, error.message);
        if (typeof ack === 'function') ack({ ok: false, reason: 'server-error' });
      }
    });
  });

  // 地域ポイント付与イベントを検知し、獲得理由を履歴として保存します。
  if (!SocketIOServer.prototype.__pointsHistoryEmitPatched) {
    const originalEmit = SocketIOServer.prototype.emit;
    SocketIOServer.prototype.emit = function(eventName, ...args) {
      if (eventName === 'region-points-updated') {
        const data = args[0] || {};
        const earned = Number(data.earned || 0);
        const username = String(data.username || '').trim();
        if (earned > 0 && username) void addHistory(username, earned, data.messageId, data.reason);
      }
      return originalEmit.call(this, eventName, ...args);
    };
    SocketIOServer.prototype.__pointsHistoryEmitPatched = true;
  }
}
