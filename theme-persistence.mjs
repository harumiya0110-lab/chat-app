import crypto from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';

const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
let serviceAccount = null;
let projectId = '';
let enabled = false;
let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

export const THEME_CATALOG = {
  forest: { name: '🟢 グリーン', cost: 0 },
  sakura: { name: '🌸 ピンク', cost: 50 },
  ocean: { name: '🔵 ブルー', cost: 80 },
  night: { name: '🔷 ネイビー', cost: 100 },
  matsuri: { name: '🟠 オレンジ', cost: 150 }
};

export const CHAT_COLOR_CATALOG = {
  forest: { name: '🌿 里山グリーン', color: '#2f7d4a', cost: 0 },
  blue: { name: '🌊 青空ブルー', color: '#2d78b8', cost: 30 },
  sakura: { name: '🌸 さくらピンク', color: '#d85c86', cost: 40 },
  violet: { name: '🔮 バイオレット', color: '#7657b8', cost: 50 },
  sunset: { name: '🌇 夕焼けオレンジ', color: '#d97932', cost: 60 },
  ink: { name: '🌑 墨ブラック', color: '#333333', cost: 80 }
};

function base64Url(value) { return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function firestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: 'NULL_VALUE' };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  if (typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, firestoreValue(v)])) } };
  return { stringValue: String(value) };
}
function fromFirestoreValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k, v]) => [k, fromFirestoreValue(v)]));
  return null;
}
function fromFields(fields) { return Object.fromEntries(Object.entries(fields || {}).map(([k, v]) => [k, fromFirestoreValue(v)])); }

try {
  if (rawServiceAccount) {
    serviceAccount = JSON.parse(rawServiceAccount);
    projectId = String(serviceAccount.project_id || '').trim();
    if (!serviceAccount.client_email || !serviceAccount.private_key || !projectId) throw new Error('service account JSON is incomplete');
    enabled = true;
    console.log(`Theme persistence enabled: project=${projectId}`);
  } else console.warn('FIREBASE_SERVICE_ACCOUNT_JSON is not set. Theme and chat-color purchases are disabled.');
} catch (error) { console.error('Theme persistence initialization failed:', error.message); }

async function getAccessToken() {
  if (!enabled) return null;
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessTokenExpiresAt - now > 60) return cachedAccessToken;
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iss: serviceAccount.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signer = crypto.createSign('RSA-SHA256'); signer.update(unsigned); signer.end();
  const assertion = `${unsigned}.${base64Url(signer.sign(serviceAccount.private_key))}`;
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  if (!response.ok) throw new Error(`Google OAuth token request failed: ${response.status}`);
  const result = await response.json(); cachedAccessToken = result.access_token; cachedAccessTokenExpiresAt = now + Number(result.expires_in || 3600); return cachedAccessToken;
}
function documentsUrl(path = '') { return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents${path}`; }
async function firestoreRequest(path, options = {}) {
  const token = await getAccessToken(); if (!token) return null;
  const response = await fetch(documentsUrl(path), { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  if (!response.ok) { const body = await response.text().catch(() => ''); const error = new Error(`Firestore request failed: ${response.status} ${body.slice(0, 300)}`); error.status = response.status; throw error; }
  if (response.status === 204) return null; return response.json();
}
async function loadThemeState(username) {
  const safeUsername = encodeURIComponent(String(username));
  try {
    const result = await firestoreRequest(`/regionalPoints/${safeUsername}`, { method: 'GET' });
    const fields = fromFields(result?.fields || {});
    const points = Math.max(0, Math.floor(Number(fields.points || 0)));
    const themes = [...new Set(['forest', ...(Array.isArray(fields.themes) ? fields.themes : [])])].filter(id => THEME_CATALOG[id]);
    const currentTheme = THEME_CATALOG[fields.currentTheme] ? fields.currentTheme : 'forest';
    const chatColors = [...new Set(['forest', ...(Array.isArray(fields.chatColors) ? fields.chatColors : [])])].filter(id => CHAT_COLOR_CATALOG[id]);
    const currentChatColor = CHAT_COLOR_CATALOG[fields.currentChatColor] ? fields.currentChatColor : 'forest';
    return { points, themes, currentTheme, chatColors, currentChatColor };
  } catch (error) { if (error.status === 404) return { points: 0, themes: ['forest'], currentTheme: 'forest', chatColors: ['forest'], currentChatColor: 'forest' }; throw error; }
}
async function patchThemeState(username, points, themes, currentTheme, chatColors, currentChatColor) {
  const safeUsername = encodeURIComponent(String(username));
  await firestoreRequest(`/regionalPoints/${safeUsername}?updateMask.fieldPaths=points&updateMask.fieldPaths=themes&updateMask.fieldPaths=currentTheme&updateMask.fieldPaths=chatColors&updateMask.fieldPaths=currentChatColor`, { method: 'PATCH', body: JSON.stringify({ fields: { points: firestoreValue(Math.max(0, Math.floor(points))), themes: firestoreValue([...new Set(['forest', ...themes])].filter(id => THEME_CATALOG[id])), currentTheme: firestoreValue(THEME_CATALOG[currentTheme] ? currentTheme : 'forest'), chatColors: firestoreValue([...new Set(['forest', ...chatColors])].filter(id => CHAT_COLOR_CATALOG[id])), currentChatColor: firestoreValue(CHAT_COLOR_CATALOG[currentChatColor] ? currentChatColor : 'forest') } }) });
}
function emitState(socket, username, state) { socket.emit('theme-state', { username, ...state, catalog: THEME_CATALOG, chatColorCatalog: CHAT_COLOR_CATALOG }); socket.emit('region-points-updated', { username, points: state.points, earned: 0 }); }
async function exchangeTheme(socket, payload = {}, ack) {
  const username = socket.__themeUsername || ''; const themeId = typeof payload.themeId === 'string' ? payload.themeId.trim() : '';
  if (!username || !THEME_CATALOG[themeId]) return typeof ack === 'function' && ack({ ok: false, reason: 'invalid' });
  try {
    const state = await loadThemeState(username);
    if (state.themes.includes(themeId)) { state.currentTheme = themeId; await patchThemeState(username, state.points, state.themes, state.currentTheme, state.chatColors, state.currentChatColor); emitState(socket, username, state); return typeof ack === 'function' && ack({ ok: true, alreadyOwned: true, ...state }); }
    const cost = THEME_CATALOG[themeId].cost;
    if (state.points < cost) return typeof ack === 'function' && ack({ ok: false, reason: 'insufficient-points', points: state.points, cost });
    const newPoints = state.points - cost; const newThemes = [...state.themes, themeId];
    await patchThemeState(username, newPoints, newThemes, themeId, state.chatColors, state.currentChatColor);
    const nextState = { ...state, points: newPoints, themes: newThemes, currentTheme: themeId }; emitState(socket, username, nextState); if (typeof ack === 'function') ack({ ok: true, purchased: true, cost, ...nextState });
  } catch (error) { console.error('Theme exchange failed:', error); if (typeof ack === 'function') ack({ ok: false, reason: 'server-error' }); }
}
async function selectTheme(socket, payload = {}, ack) {
  const username = socket.__themeUsername || ''; const themeId = typeof payload.themeId === 'string' ? payload.themeId.trim() : '';
  if (!username || !THEME_CATALOG[themeId]) return typeof ack === 'function' && ack({ ok: false, reason: 'invalid' });
  try { const state = await loadThemeState(username); if (!state.themes.includes(themeId)) return typeof ack === 'function' && ack({ ok: false, reason: 'not-owned' }); state.currentTheme = themeId; await patchThemeState(username, state.points, state.themes, state.currentTheme, state.chatColors, state.currentChatColor); emitState(socket, username, state); if (typeof ack === 'function') ack({ ok: true, ...state }); } catch (error) { console.error('Theme selection failed:', error); if (typeof ack === 'function') ack({ ok: false, reason: 'server-error' }); }
}
async function exchangeChatColor(socket, payload = {}, ack) {
  const username = socket.__themeUsername || ''; const colorId = typeof payload.colorId === 'string' ? payload.colorId.trim() : '';
  if (!username || !CHAT_COLOR_CATALOG[colorId]) return typeof ack === 'function' && ack({ ok: false, reason: 'invalid' });
  try { const state = await loadThemeState(username); if (state.chatColors.includes(colorId)) { state.currentChatColor = colorId; await patchThemeState(username, state.points, state.themes, state.currentTheme, state.chatColors, state.currentChatColor); emitState(socket, username, state); return typeof ack === 'function' && ack({ ok: true, alreadyOwned: true, ...state }); } const cost = CHAT_COLOR_CATALOG[colorId].cost; if (state.points < cost) return typeof ack === 'function' && ack({ ok: false, reason: 'insufficient-points', points: state.points, cost }); const newPoints = state.points - cost; const newChatColors = [...state.chatColors, colorId]; await patchThemeState(username, newPoints, state.themes, state.currentTheme, newChatColors, colorId); const nextState = { ...state, points: newPoints, chatColors: newChatColors, currentChatColor: colorId }; emitState(socket, username, nextState); if (typeof ack === 'function') ack({ ok: true, purchased: true, cost, ...nextState }); } catch (error) { console.error('Chat color exchange failed:', error); if (typeof ack === 'function') ack({ ok: false, reason: 'server-error' }); }
}
async function selectChatColor(socket, payload = {}, ack) {
  const username = socket.__themeUsername || ''; const colorId = typeof payload.colorId === 'string' ? payload.colorId.trim() : '';
  if (!username || !CHAT_COLOR_CATALOG[colorId]) return typeof ack === 'function' && ack({ ok: false, reason: 'invalid' });
  try { const state = await loadThemeState(username); if (!state.chatColors.includes(colorId)) return typeof ack === 'function' && ack({ ok: false, reason: 'not-owned' }); state.currentChatColor = colorId; await patchThemeState(username, state.points, state.themes, state.currentTheme, state.chatColors, state.currentChatColor); emitState(socket, username, state); if (typeof ack === 'function') ack({ ok: true, ...state }); } catch (error) { console.error('Chat color selection failed:', error); if (typeof ack === 'function') ack({ ok: false, reason: 'server-error' }); }
}
const originalServerOn = SocketIOServer.prototype.on;
SocketIOServer.prototype.on = function(eventName, listener) {
  if (eventName !== 'connection') return originalServerOn.call(this, eventName, listener);
  const wrappedListener = (socket, ...rest) => {
    const originalSocketOn = socket.on.bind(socket);
    socket.on = (socketEventName, handler) => {
      if (socketEventName === 'exchange-theme') return originalSocketOn(socketEventName, (payload, ack) => void exchangeTheme(socket, payload, ack));
      if (socketEventName === 'select-theme') return originalSocketOn(socketEventName, (payload, ack) => void selectTheme(socket, payload, ack));
      if (socketEventName === 'exchange-chat-color') return originalSocketOn(socketEventName, (payload, ack) => void exchangeChatColor(socket, payload, ack));
      if (socketEventName === 'select-chat-color') return originalSocketOn(socketEventName, (payload, ack) => void selectChatColor(socket, payload, ack));
      return originalSocketOn(socketEventName, handler);
    };
    const previousEmit = socket.emit.bind(socket);
    socket.emit = (socketEventName, ...args) => {
      if (socketEventName === 'username-accepted' && args[0]?.username) {
        const username = String(args[0].username); socket.__themeUsername = username; const accepted = previousEmit(socketEventName, ...args);
        if (enabled) void loadThemeState(username).then(state => emitState(socket, username, state)).catch(error => console.error('Theme state load failed:', error));
        else previousEmit('theme-state', { username, points: 0, themes: ['forest'], currentTheme: 'forest', chatColors: ['forest'], currentChatColor: 'forest', catalog: THEME_CATALOG, chatColorCatalog: CHAT_COLOR_CATALOG });
        return accepted;
      }
      return previousEmit(socketEventName, ...args);
    };
    return listener(socket, ...rest);
  };
  return originalServerOn.call(this, eventName, wrappedListener);
};
export const themePersistenceEnabled = enabled;
