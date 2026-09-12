import crypto from 'node:crypto';

const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
let serviceAccount = null;
let projectId = '';
let enabled = false;
let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

export const THEME_CATALOG = {
  forest: { name: '🟢 グリーン', description: '自然をイメージした緑色のテーマ', cost: 0 },
  sakura: { name: '🌸 ピンク', description: '春らしいやさしいピンク色のテーマ', cost: 50 },
  ocean: { name: '🔵 ブルー', description: '海と空をイメージした青色のテーマ', cost: 80 },
  night: { name: '🔷 ネイビー', description: '夜空をイメージした落ち着いた紺色のテーマ', cost: 100 },
  matsuri: { name: '🟠 オレンジ', description: 'お祭りをイメージした元気なオレンジ色のテーマ', cost: 150 }
};

export const CHAT_COLOR_CATALOG = {
  forest: { name: '🌿 里山グリーン', description: '自然をイメージした標準カラー', color: '#2f7d4a', cost: 0 },
  blue: { name: '🌊 青空ブルー', description: '明るく爽やかな青', color: '#2d78b8', cost: 30 },
  sakura: { name: '🌸 さくらピンク', description: 'やわらかく親しみやすいピンク', color: '#d85c86', cost: 40 },
  violet: { name: '🔮 バイオレット', description: '少し落ち着いた紫', color: '#7657b8', cost: 50 },
  sunset: { name: '🌇 夕焼けオレンジ', description: 'あたたかい夕焼け色', color: '#d97932', cost: 60 },
  ink: { name: '🌑 墨ブラック', description: '引き締まったシックな黒', color: '#333333', cost: 80 }
};

const DEFAULT_STATE = Object.freeze({
  points: 0,
  themes: ['forest'],
  currentTheme: 'forest',
  chatColors: ['forest'],
  currentChatColor: 'forest'
});

const userLocks = new Map();

try {
  if (rawServiceAccount) {
    serviceAccount = JSON.parse(rawServiceAccount);
    projectId = String(serviceAccount.project_id || '').trim();
    if (!serviceAccount.client_email || !serviceAccount.private_key || !projectId) {
      throw new Error('service account JSON is incomplete');
    }
    enabled = true;
    console.log(`Theme exchange persistence enabled: project=${projectId}`);
  } else {
    console.warn('FIREBASE_SERVICE_ACCOUNT_JSON is not set. Theme exchange persistence is disabled.');
  }
} catch (error) {
  console.error('Theme exchange initialization failed:', error.message);
}

function cloneDefaultState() {
  return {
    points: DEFAULT_STATE.points,
    themes: [...DEFAULT_STATE.themes],
    currentTheme: DEFAULT_STATE.currentTheme,
    chatColors: [...DEFAULT_STATE.chatColors],
    currentChatColor: DEFAULT_STATE.currentChatColor
  };
}

function withUserLock(username, task) {
  const key = String(username);
  const previous = userLocks.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(task).finally(() => {
    if (userLocks.get(key) === next) userLocks.delete(key);
  });
  userLocks.set(key, next);
  return next;
}

function base64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function firestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: 'NULL_VALUE' };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  if (typeof value === 'object') {
    const fields = {};
    for (const [key, item] of Object.entries(value)) fields[key] = firestoreValue(item);
    return { mapValue: { fields } };
  }
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
  if ('nullValue' in value) return null;
  return null;
}

function fromFirestoreFields(fields) {
  const result = {};
  for (const [key, value] of Object.entries(fields || {})) result[key] = fromFirestoreValue(value);
  return result;
}

function normalizeState(raw = {}) {
  const themes = [...new Set(['forest', ...(Array.isArray(raw.themes) ? raw.themes : [])])]
    .filter(id => Boolean(THEME_CATALOG[id]));
  const chatColors = [...new Set(['forest', ...(Array.isArray(raw.chatColors) ? raw.chatColors : [])])]
    .filter(id => Boolean(CHAT_COLOR_CATALOG[id]));
  return {
    points: Math.max(0, Math.floor(Number(raw.points || 0))),
    themes,
    currentTheme: THEME_CATALOG[raw.currentTheme] ? raw.currentTheme : 'forest',
    chatColors,
    currentChatColor: CHAT_COLOR_CATALOG[raw.currentChatColor] ? raw.currentChatColor : 'forest'
  };
}

async function getAccessToken() {
  if (!enabled) return null;
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessTokenExpiresAt - now > 60) return cachedAccessToken;

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${base64Url(signer.sign(serviceAccount.private_key))}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    }),
    signal: AbortSignal.timeout(8000)
  });

  if (!response.ok) {
    throw new Error(`Google OAuth token request failed: ${response.status}`);
  }
  const result = await response.json();
  cachedAccessToken = result.access_token;
  cachedAccessTokenExpiresAt = now + Number(result.expires_in || 3600);
  return cachedAccessToken;
}

function documentsUrl(path = '') {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents${path}`;
}

async function firestoreRequest(label, path, options = {}) {
  const token = await getAccessToken();
  if (!token) throw new Error('theme persistence is disabled');

  console.log(`[theme-exchange] firestore ${label}: ${options.method || 'GET'} ${path}`);
  const response = await fetch(documentsUrl(path), {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    signal: options.signal || AbortSignal.timeout(10000)
  });

  const bodyText = await response.text().catch(() => '');
  if (!response.ok) {
    const error = new Error(`Firestore request failed: ${response.status} ${bodyText.slice(0, 500)}`);
    error.status = response.status;
    throw error;
  }
  return bodyText ? JSON.parse(bodyText) : null;
}

async function loadState(username) {
  if (!enabled) return cloneDefaultState();
  const safeUsername = encodeURIComponent(String(username));
  try {
    const result = await firestoreRequest('load', `/regionalPoints/${safeUsername}`, { method: 'GET' });
    return normalizeState(fromFirestoreFields(result?.fields || {}));
  } catch (error) {
    if (error.status === 404) return cloneDefaultState();
    throw error;
  }
}

async function saveState(username, state) {
  if (!enabled) return;
  const safeUsername = encodeURIComponent(String(username));
  const clean = normalizeState(state);
  await firestoreRequest('save', `/regionalPoints/${safeUsername}?updateMask.fieldPaths=points&updateMask.fieldPaths=themes&updateMask.fieldPaths=currentTheme&updateMask.fieldPaths=chatColors&updateMask.fieldPaths=currentChatColor`, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: {
        points: firestoreValue(clean.points),
        themes: firestoreValue(clean.themes),
        currentTheme: firestoreValue(clean.currentTheme),
        chatColors: firestoreValue(clean.chatColors),
        currentChatColor: firestoreValue(clean.currentChatColor)
      }
    })
  });
}

function emitState(socket, username, state) {
  const clean = normalizeState(state);
  socket.emit('theme-state', {
    username,
    ...clean,
    catalog: THEME_CATALOG,
    chatColorCatalog: CHAT_COLOR_CATALOG
  });
  socket.emit('region-points-updated', {
    username,
    points: clean.points,
    earned: 0
  });
}

function ackFail(ack, reason, extra = {}) {
  if (typeof ack === 'function') ack({ ok: false, reason, ...extra });
}

async function exchangeTheme(socket, themeId, ack) {
  const username = socket.__themeUsername || '';
  if (!username || !THEME_CATALOG[themeId]) return ackFail(ack, 'invalid');

  return withUserLock(username, async () => {
    console.log(`[theme-exchange] exchange-theme start user=${username} theme=${themeId}`);
    try {
      const state = await loadState(username);
      if (state.themes.includes(themeId)) {
        state.currentTheme = themeId;
        await saveState(username, state);
        emitState(socket, username, state);
        if (typeof ack === 'function') ack({ ok: true, alreadyOwned: true, ...state });
        return;
      }

      const cost = Number(THEME_CATALOG[themeId].cost || 0);
      if (state.points < cost) return ackFail(ack, 'insufficient-points', { points: state.points, cost });

      const nextState = {
        ...state,
        points: state.points - cost,
        themes: [...state.themes, themeId],
        currentTheme: themeId
      };
      await saveState(username, nextState);
      emitState(socket, username, nextState);
      if (typeof ack === 'function') ack({ ok: true, purchased: true, cost, ...nextState });
      console.log(`[theme-exchange] exchange-theme success user=${username} theme=${themeId}`);
    } catch (error) {
      console.error(`[theme-exchange] exchange-theme failed user=${username}:`, error);
      ackFail(ack, 'server-error', { message: '交換処理中にサーバーエラーが発生しました。' });
    }
  });
}

async function selectTheme(socket, themeId, ack) {
  const username = socket.__themeUsername || '';
  if (!username || !THEME_CATALOG[themeId]) return ackFail(ack, 'invalid');

  return withUserLock(username, async () => {
    try {
      const state = await loadState(username);
      if (!state.themes.includes(themeId)) return ackFail(ack, 'not-owned');
      state.currentTheme = themeId;
      await saveState(username, state);
      emitState(socket, username, state);
      if (typeof ack === 'function') ack({ ok: true, ...state });
    } catch (error) {
      console.error(`[theme-exchange] select-theme failed user=${username}:`, error);
      ackFail(ack, 'server-error', { message: '見た目の切り替えに失敗しました。' });
    }
  });
}

async function exchangeChatColor(socket, colorId, ack) {
  const username = socket.__themeUsername || '';
  if (!username || !CHAT_COLOR_CATALOG[colorId]) return ackFail(ack, 'invalid');

  return withUserLock(username, async () => {
    console.log(`[theme-exchange] exchange-chat-color start user=${username} color=${colorId}`);
    try {
      const state = await loadState(username);
      if (state.chatColors.includes(colorId)) {
        state.currentChatColor = colorId;
        await saveState(username, state);
        emitState(socket, username, state);
        if (typeof ack === 'function') ack({ ok: true, alreadyOwned: true, ...state });
        return;
      }

      const cost = Number(CHAT_COLOR_CATALOG[colorId].cost || 0);
      if (state.points < cost) return ackFail(ack, 'insufficient-points', { points: state.points, cost });

      const nextState = {
        ...state,
        points: state.points - cost,
        chatColors: [...state.chatColors, colorId],
        currentChatColor: colorId
      };
      await saveState(username, nextState);
      emitState(socket, username, nextState);
      if (typeof ack === 'function') ack({ ok: true, purchased: true, cost, ...nextState });
      console.log(`[theme-exchange] exchange-chat-color success user=${username} color=${colorId}`);
    } catch (error) {
      console.error(`[theme-exchange] exchange-chat-color failed user=${username}:`, error);
      ackFail(ack, 'server-error', { message: '色の交換処理に失敗しました。' });
    }
  });
}

async function selectChatColor(socket, colorId, ack) {
  const username = socket.__themeUsername || '';
  if (!username || !CHAT_COLOR_CATALOG[colorId]) return ackFail(ack, 'invalid');

  return withUserLock(username, async () => {
    try {
      const state = await loadState(username);
      if (!state.chatColors.includes(colorId)) return ackFail(ack, 'not-owned');
      state.currentChatColor = colorId;
      await saveState(username, state);
      emitState(socket, username, state);
      if (typeof ack === 'function') ack({ ok: true, ...state });
    } catch (error) {
      console.error(`[theme-exchange] select-chat-color failed user=${username}:`, error);
      ackFail(ack, 'server-error', { message: 'チャットの色の切り替えに失敗しました。' });
    }
  });
}

export async function initializeThemeForSocket(socket, username) {
  socket.__themeUsername = String(username || '').trim();
  if (!socket.__themeUsername) return;
  try {
    const state = await loadState(socket.__themeUsername);
    emitState(socket, socket.__themeUsername, state);
    console.log(`[theme-exchange] state initialized user=${socket.__themeUsername} points=${state.points}`);
  } catch (error) {
    console.error(`[theme-exchange] initial state load failed user=${socket.__themeUsername}:`, error);
    emitState(socket, socket.__themeUsername, cloneDefaultState());
  }
}

export function registerThemeSocket(socket) {
  socket.on('exchange-theme', (payload = {}, ack) => {
    const themeId = typeof payload.themeId === 'string' ? payload.themeId.trim() : '';
    void exchangeTheme(socket, themeId, ack);
  });
  socket.on('select-theme', (payload = {}, ack) => {
    const themeId = typeof payload.themeId === 'string' ? payload.themeId.trim() : '';
    void selectTheme(socket, themeId, ack);
  });
  socket.on('exchange-chat-color', (payload = {}, ack) => {
    const colorId = typeof payload.colorId === 'string' ? payload.colorId.trim() : '';
    void exchangeChatColor(socket, colorId, ack);
  });
  socket.on('select-chat-color', (payload = {}, ack) => {
    const colorId = typeof payload.colorId === 'string' ? payload.colorId.trim() : '';
    void selectChatColor(socket, colorId, ack);
  });
}

export const themePersistenceEnabled = enabled;
