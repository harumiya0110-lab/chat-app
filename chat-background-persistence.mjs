import crypto from 'node:crypto';

const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
let serviceAccount = null;
let projectId = '';
let enabled = false;
let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

export const CHAT_BACKGROUND_CATALOG = {
  default: { name: '🌿 里山', description: '見やすい標準のチャット背景', cost: 0, css: 'default' },
  paper: { name: '📜 和紙', description: 'やわらかな和紙風の背景', cost: 40, css: 'paper' },
  sky: { name: '☁️ 青空', description: '明るく爽やかな空色', cost: 60, css: 'sky' },
  sakura: { name: '🌸 桜', description: '春らしい淡い桜色', cost: 80, css: 'sakura' },
  night: { name: '🌌 星空', description: '落ち着いた夜空イメージ', cost: 100, css: 'night' },
  sunset: { name: '🌇 夕焼け', description: 'あたたかい夕暮れ色', cost: 120, css: 'sunset' }
};

const DEFAULT_STATE = { points: 0, backgrounds: ['default'], currentBackground: 'default' };
const locks = new Map();

function cloneState(state = DEFAULT_STATE) {
  return {
    points: Math.max(0, Math.floor(Number(state.points || 0))),
    backgrounds: [...new Set(['default', ...(Array.isArray(state.backgrounds) ? state.backgrounds : [])])].filter(id => CHAT_BACKGROUND_CATALOG[id]),
    currentBackground: CHAT_BACKGROUND_CATALOG[state.currentBackground] ? state.currentBackground : 'default'
  };
}
function withLock(username, task) {
  const key = String(username);
  const previous = locks.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(task).finally(() => { if (locks.get(key) === next) locks.delete(key); });
  locks.set(key, next);
  return next;
}
function base64Url(value) { return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function firestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: 'NULL_VALUE' };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  if (typeof value === 'object') { const fields = {}; for (const [key, item] of Object.entries(value)) fields[key] = firestoreValue(item); return { mapValue: { fields } }; }
  return { stringValue: String(value) };
}
function fromFirestoreValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in value) return fromFirestoreFields(value.mapValue.fields || {});
  return null;
}
function fromFirestoreFields(fields) { const result = {}; for (const [key, value] of Object.entries(fields || {})) result[key] = fromFirestoreValue(value); return result; }

try {
  if (rawServiceAccount) {
    serviceAccount = JSON.parse(rawServiceAccount);
    projectId = String(serviceAccount.project_id || '').trim();
    if (!serviceAccount.client_email || !serviceAccount.private_key || !projectId) throw new Error('service account JSON is incomplete');
    enabled = true;
    console.log(`Chat background persistence enabled: project=${projectId}`);
  } else console.warn('FIREBASE_SERVICE_ACCOUNT_JSON is not set. Chat background purchases are disabled.');
} catch (error) { console.error('Chat background persistence initialization failed:', error.message); }

async function getAccessToken() {
  if (!enabled) return null;
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessTokenExpiresAt - now > 60) return cachedAccessToken;
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iss: serviceAccount.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signer = crypto.createSign('RSA-SHA256'); signer.update(unsigned); signer.end();
  const assertion = `${unsigned}.${base64Url(signer.sign(serviceAccount.private_key))}`;
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }), signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Google OAuth token request failed: ${response.status}`);
  const result = await response.json(); cachedAccessToken = result.access_token; cachedAccessTokenExpiresAt = now + Number(result.expires_in || 3600); return cachedAccessToken;
}
function documentsUrl(path = '') { return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents${path}`; }
async function firestoreRequest(label, path, options = {}) {
  const token = await getAccessToken();
  if (!token) throw new Error('chat background persistence is disabled');
  const response = await fetch(documentsUrl(path), { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }, signal: options.signal || AbortSignal.timeout(8000) });
  const text = await response.text().catch(() => '');
  if (!response.ok) { const error = new Error(`Firestore request failed: ${response.status} ${text.slice(0, 400)}`); error.status = response.status; throw error; }
  return text ? JSON.parse(text) : null;
}
async function loadState(username) {
  const safeUsername = encodeURIComponent(String(username));
  try {
    const result = await firestoreRequest('load', `/regionalPoints/${safeUsername}`, { method: 'GET' });
    const raw = fromFirestoreFields(result?.fields || {});
    return cloneState({ points: raw.points || 0, backgrounds: raw.chatBackgrounds || [], currentBackground: raw.currentChatBackground });
  } catch (error) { if (error.status === 404) return cloneState(); throw error; }
}
async function saveBackgroundState(username, state) {
  if (!enabled) return;
  const safeUsername = encodeURIComponent(String(username));
  const clean = cloneState(state);
  const params = ['chatBackgrounds', 'currentChatBackground'].map(path => `updateMask.fieldPaths=${encodeURIComponent(path)}`).join('&');
  await firestoreRequest('save-background', `/regionalPoints/${safeUsername}?${params}`, { method: 'PATCH', body: JSON.stringify({ fields: { chatBackgrounds: firestoreValue(clean.backgrounds), currentChatBackground: firestoreValue(clean.currentBackground) } }) });
}
function emitState(socket, username, state) { const clean = cloneState(state); socket.emit('chat-background-state', { username, backgrounds: clean.backgrounds, currentBackground: clean.currentBackground, backgroundCatalog: CHAT_BACKGROUND_CATALOG }); }
function fail(ack, reason, extra = {}) { if (typeof ack === 'function') ack({ ok: false, reason, ...extra }); }

async function exchangeBackground(socket, id, ack) {
  const username = String(socket.__chatBackgroundUsername || '').trim();
  if (!username || !CHAT_BACKGROUND_CATALOG[id]) return fail(ack, 'invalid');
  return withLock(username, async () => {
    try {
      const state = await loadState(username);
      if (state.backgrounds.includes(id)) {
        state.currentBackground = id;
        await saveBackgroundState(username, state);
        emitState(socket, username, state);
        if (typeof ack === 'function') ack({ ok: true, alreadyOwned: true, points: state.points, backgrounds: state.backgrounds, currentBackground: state.currentBackground });
        return;
      }
      const cost = Math.max(0, Number(CHAT_BACKGROUND_CATALOG[id].cost || 0));
      if (state.points < cost) return fail(ack, 'insufficient-points', { points: state.points, cost });
      state.points -= cost;
      state.backgrounds.push(id);
      state.currentBackground = id;
      // 背景情報だけを保存し、ポイント処理を古い値で上書きしないようにする。
      await saveBackgroundState(username, state);
      emitState(socket, username, state);
      if (typeof ack === 'function') ack({ ok: true, purchased: true, cost, points: state.points, backgrounds: state.backgrounds, currentBackground: state.currentBackground });
    } catch (error) {
      console.error(`[chat-background] purchase failed user=${username}:`, error.message);
      fail(ack, 'server-error', { message: '背景の交換処理に失敗しました。' });
    }
  });
}

async function selectBackground(socket, id, ack) {
  const username = String(socket.__chatBackgroundUsername || '').trim();
  if (!username || !CHAT_BACKGROUND_CATALOG[id]) return fail(ack, 'invalid');
  return withLock(username, async () => {
    try {
      const state = await loadState(username);
      if (!state.backgrounds.includes(id)) return fail(ack, 'not-owned');
      state.currentBackground = id;
      await saveBackgroundState(username, state);
      emitState(socket, username, state);
      if (typeof ack === 'function') ack({ ok: true, points: state.points, backgrounds: state.backgrounds, currentBackground: state.currentBackground });
    } catch (error) {
      console.error(`[chat-background] select failed user=${username}:`, error.message);
      fail(ack, 'server-error', { message: '背景の切り替えに失敗しました。' });
    }
  });
}

export function registerChatBackgroundPersistence(io) {
  if (!io || io.__chatBackgroundRegistered) return;
  io.__chatBackgroundRegistered = true;
  io.on('connection', socket => {
    socket.on('set-username', async username => {
      const cleanUsername = String(username || '').trim().slice(0, 20);
      if (!cleanUsername) return;
      socket.__chatBackgroundUsername = cleanUsername;
      try { emitState(socket, cleanUsername, await loadState(cleanUsername)); }
      catch (error) { console.error(`[chat-background] initial load failed user=${cleanUsername}:`, error.message); }
    });
    socket.on('exchange-chat-background', (payload, ack) => exchangeBackground(socket, typeof payload === 'string' ? payload : payload?.id, ack));
    socket.on('select-chat-background', (payload, ack) => selectBackground(socket, typeof payload === 'string' ? payload : payload?.id, ack));
  });
}
