import crypto from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';

const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
let serviceAccount = null;
let projectId = '';
let enabled = false;
let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

const POINTS_PER_HELP = 20;

// 普段の利用でも少しずつ貯まり、地域に役立つ行動では大きく貯まる設定です。
const DAILY_LOGIN_POINTS = 3;
const CHAT_POST_POINTS = 1;
const MAP_POST_POINTS = 5;
const MAX_DAILY_CHAT_POSTS = 5;
const MAX_DAILY_MAP_POSTS = 3;
const HELPABLE_EVENT_TYPES = new Set(['助け合い']);

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
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in value) return fromFirestoreFields(value.mapValue.fields || {});
  return null;
}

function fromFirestoreFields(fields) {
  const result = {};
  for (const [key, value] of Object.entries(fields || {})) result[key] = fromFirestoreValue(value);
  return result;
}

try {
  if (rawServiceAccount) {
    serviceAccount = JSON.parse(rawServiceAccount);
    projectId = String(serviceAccount.project_id || '').trim();
    if (!serviceAccount.client_email || !serviceAccount.private_key || !projectId) {
      throw new Error('service account JSONにclient_email、private_key、project_idが必要です');
    }
    enabled = true;
    console.log(`Regional points persistence enabled: project=${projectId}`);
  } else {
    console.warn('FIREBASE_SERVICE_ACCOUNT_JSON is not set. Regional points are disabled.');
  }
} catch (error) {
  console.error('Regional points initialization failed:', error.message);
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
  const signature = signer.sign(serviceAccount.private_key);
  const assertion = `${unsigned}.${base64Url(signature)}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
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
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Firestore request failed: ${response.status} ${body.slice(0, 300)}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function getMessage(id) {
  if (!enabled || !id) return null;
  const safeId = encodeURIComponent(String(id));
  const result = await firestoreRequest(`/messages/${safeId}`, { method: 'GET' });
  if (!result?.fields) return null;
  const fields = fromFirestoreFields(result.fields);
  return {
    username: String(fields.username || ''),
    eventType: String(fields.locationData?.eventType || ''),
    helpUsers: Array.isArray(fields.helpUsers) ? fields.helpUsers : [],
    helpConfirmedUsers: Array.isArray(fields.helpConfirmedUsers) ? fields.helpConfirmedUsers : []
  };
}

async function loadPointsLeaderboard(limit = 10) {
  if (!enabled) return [];
  const pageSize = Math.min(50, Math.max(1, limit));
  const result = await firestoreRequest(`/regionalPoints?pageSize=${pageSize}`, { method: 'GET' });
  const entries = (Array.isArray(result?.documents) ? result.documents : []).map(doc => {
    const name = String(doc.name || '').split('/').pop() || '';
    const fields = fromFirestoreFields(doc.fields || {});
    return { username: decodeURIComponent(name), points: Math.max(0, Math.floor(Number(fields.points || 0))) };
  }).filter(item => item.username && item.username !== 'undefined');
  return entries.sort((a,b) => b.points - a.points || a.username.localeCompare(b.username, 'ja')).slice(0, 10);
}

async function getPointAccount(username) {
  if (!enabled || !username) return { points: 0 };
  const safeUsername = encodeURIComponent(String(username));
  try {
    const result = await firestoreRequest(`/regionalPoints/${safeUsername}`, { method: 'GET' });
    if (!result?.fields) return { points: 0 };
    return fromFirestoreFields(result.fields);
  } catch (error) {
    if (String(error?.message || '').startsWith('Firestore request failed: 404')) return { points: 0 };
    throw error;
  }
}

async function getPoints(username) {
  const account = await getPointAccount(username);
  return Number(account.points || 0);
}

async function setPoints(username, points, extraFields = {}) {
  const safeUsername = encodeURIComponent(String(username));
  const fields = {
    username: firestoreValue(username),
    points: firestoreValue(Math.max(0, Math.floor(points)))
  };
  for (const [key, value] of Object.entries(extraFields)) {
    fields[key] = firestoreValue(value);
  }

  // Firestore RESTのPATCHはupdateMaskがないと、送信したfields以外を
  // 既存ドキュメントから消してしまいます。
  // 地域ポイント更新のたびに、交換済みテーマまで消えないように
  // 今回変更するフィールドだけを更新します。
  const updateMask = Object.keys(fields)
    .map(key => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
    .join('&');

  await firestoreRequest(`/regionalPoints/${safeUsername}?${updateMask}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields })
  });
}

function getJapanDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

async function awardDailyLoginPoints(username) {
  const account = await getPointAccount(username);
  const today = getJapanDateKey();
  if (String(account.lastDailyLogin || '') === today) return { earned: 0, points: Number(account.points || 0) };

  const currentPoints = Number(account.points || 0);
  const newPoints = currentPoints + DAILY_LOGIN_POINTS;
  await setPoints(username, newPoints, { lastDailyLogin: today });

  return {
    earned: DAILY_LOGIN_POINTS,
    points: newPoints,
    reason: 'daily-login',
    historyId: `daily-login:${today}`
  };
}

async function awardUsagePoints(username, type, messageId = '') {
  if (!username) return { earned: 0, points: 0 };

  const today = getJapanDateKey();
  const account = await getPointAccount(username);
  const currentPoints = Number(account.points || 0);

  const isMapPost = type === 'map-post';
  const dateField = isMapPost ? 'dailyMapPostDate' : 'dailyChatPostDate';
  const countField = isMapPost ? 'dailyMapPostCount' : 'dailyChatPostCount';
  const maxPosts = isMapPost ? MAX_DAILY_MAP_POSTS : MAX_DAILY_CHAT_POSTS;
  const perPostPoints = isMapPost ? MAP_POST_POINTS : CHAT_POST_POINTS;
  const reason = isMapPost ? 'map-post' : 'chat-use';

  const used = String(account[dateField] || '') === today
    ? Math.max(0, Math.floor(Number(account[countField] || 0)))
    : 0;

  if (used >= maxPosts) {
    return { earned: 0, points: currentPoints };
  }

  const newCount = used + 1;
  const newPoints = currentPoints + perPostPoints;
  await setPoints(username, newPoints, {
    [dateField]: today,
    [countField]: newCount
  });

  return {
    earned: perPostPoints,
    points: newPoints,
    messageId,
    reason,
    historyId: messageId ? `${reason}:${messageId}` : `${reason}:${today}:${used + 1}`
  };
}

function emitPointAward(server, username, result) {
  if (!server || !username || !result || Number(result.earned || 0) <= 0) return;
  server.emit('region-points-updated', {
    username,
    points: result.points,
    earned: result.earned,
    messageId: result.messageId || '',
    reason: result.reason || 'community-use',
    historyId: result.historyId || ''
  });
}

async function markHelpConfirmed(messageId, helperUsername, confirmedUsers) {
  const safeId = encodeURIComponent(String(messageId));
  const safeUsers = [...new Set([...confirmedUsers, helperUsername])]
    .filter(item => typeof item === 'string' && item.trim())
    .map(item => item.trim().slice(0, 50))
    .slice(0, 100);

  await firestoreRequest(
    `/messages/${safeId}?updateMask.fieldPaths=helpConfirmedUsers`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        fields: { helpConfirmedUsers: firestoreValue(safeUsers) }
      })
    }
  );
  return safeUsers;
}

async function confirmHelp(socket, payload = {}, ack) {
  const ownerUsername = socket.__regionalPointsUsername || '';
  const id = typeof payload.id === 'string' ? payload.id.trim() : '';
  const helperUsername = typeof payload.helperUsername === 'string'
    ? payload.helperUsername.trim().slice(0, 50)
    : '';

  if (!ownerUsername || !id || !helperUsername) {
    if (typeof ack === 'function') ack({ ok: false, reason: 'unauthorized' });
    return;
  }

  try {
    const saved = await getMessage(id);
    if (!saved) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'not-found' });
      return;
    }

    if (!HELPABLE_EVENT_TYPES.has(saved.eventType)) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'not-helpable' });
      return;
    }

    if (saved.username !== ownerUsername) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'not-owner' });
      return;
    }

    if (!saved.helpUsers.includes(helperUsername)) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'not-helper' });
      return;
    }

    const confirmedUsers = Array.isArray(saved.helpConfirmedUsers)
      ? [...saved.helpConfirmedUsers]
      : [];

    if (confirmedUsers.includes(helperUsername)) {
      if (typeof ack === 'function') ack({
        ok: true,
        alreadyConfirmed: true,
        helperUsername,
        helpConfirmedUsers: confirmedUsers
      });
      return;
    }

    const currentPoints = await getPoints(helperUsername);
    const newPoints = currentPoints + POINTS_PER_HELP;
    await setPoints(helperUsername, newPoints);
    const updatedConfirmedUsers = await markHelpConfirmed(id, helperUsername, confirmedUsers);

    socket.server.emit('region-points-updated', {
      username: helperUsername,
      points: newPoints,
      earned: POINTS_PER_HELP,
      messageId: id,
      reason: 'help-confirmed',
      historyId: `help-confirmed:${id}:${helperUsername}`
    });
    socket.server.emit('map-pin-help-confirmed', {
      id,
      helperUsername,
      confirmedBy: ownerUsername,
      points: POINTS_PER_HELP,
      helpConfirmedUsers: updatedConfirmedUsers
    });

    if (typeof ack === 'function') ack({
      ok: true,
      helperUsername,
      points: POINTS_PER_HELP,
      helpConfirmedUsers: updatedConfirmedUsers
    });
  } catch (error) {
    console.error('Regional points confirmation failed:', error);
    if (typeof ack === 'function') ack({ ok: false, reason: 'server-error' });
  }
}


// receive-message は「普段の利用」のポイント対象です。
// Firebase履歴読み込みなどで再表示されるメッセージは receive-message を通らないため、
// 過去投稿の読み込みでポイントが二重加算されることはありません。
if (!SocketIOServer.prototype.__regionalPointsEmitPatched) {
  const originalServerEmit = SocketIOServer.prototype.emit;
  SocketIOServer.prototype.emit = function(eventName, ...args) {
    if (eventName === 'receive-message' && enabled) {
      const data = args[0] || {};
      const username = String(data.username || '').trim();
      const messageId = String(data.id || '').trim();
      const isMapPost = Boolean(data.locationData && Number.isFinite(Number(data.locationData.lat)) && Number.isFinite(Number(data.locationData.lng)));
      if (username) {
        void awardUsagePoints(username, isMapPost ? 'map-post' : 'chat-use', messageId)
          .then(result => emitPointAward(this, username, result))
          .catch(error => console.error('[regional points] usage award failed:', error));
      }
    }
    return originalServerEmit.call(this, eventName, ...args);
  };
  SocketIOServer.prototype.__regionalPointsEmitPatched = true;
}

const originalServerOn = SocketIOServer.prototype.on;
SocketIOServer.prototype.on = function(eventName, listener) {
  if (eventName !== 'connection') return originalServerOn.call(this, eventName, listener);

  const wrappedListener = (socket, ...rest) => {
    const originalSocketOn = socket.on.bind(socket);
    socket.on = (socketEventName, handler) => {
      if (socketEventName === 'toggle-help') {
        const wrappedHandler = async (payload = {}, ack) => {
          const username = socket.__regionalPointsUsername || '';
          const id = typeof payload.id === 'string' ? payload.id.trim() : '';
          if (!username || !id) {
            if (typeof ack === 'function') ack({ ok: false, reason: 'unauthorized' });
            return;
          }

          try {
            const saved = await getMessage(id);
            if (!saved) {
              if (typeof ack === 'function') ack({ ok: false, reason: 'not-found' });
              return;
            }

            if (!HELPABLE_EVENT_TYPES.has(saved.eventType)) {
              if (typeof ack === 'function') ack({ ok: false, reason: 'not-helpable' });
              return;
            }

            if (saved.username === username) {
              if (typeof ack === 'function') ack({ ok: false, reason: 'own-post' });
              return;
            }

            return handler(payload, ack);
          } catch (error) {
            console.error('Regional points toggle-help guard failed:', error);
            if (typeof ack === 'function') ack({ ok: false, reason: 'server-error' });
          }
        };

        return originalSocketOn(socketEventName, wrappedHandler);
      }

      return originalSocketOn(socketEventName, handler);
    };

    originalSocketOn('confirm-help', (payload = {}, ack) => {
      void confirmHelp(socket, payload, ack);
    });
    originalSocketOn('request-points-leaderboard', async (_payload, ack) => {
      if (!socket.__regionalPointsUsername) {
        if (typeof ack === 'function') ack({ ok: false, reason: 'unauthorized' });
        return;
      }
      try {
        const leaderboard = await loadPointsLeaderboard(10);
        if (typeof ack === 'function') ack({ ok: true, leaderboard });
      } catch (error) {
        console.error('Regional points leaderboard load failed:', error);
        if (typeof ack === 'function') ack({ ok: false, reason: 'server-error' });
      }
    });

    const previousEmit = socket.emit.bind(socket);
    socket.emit = (socketEventName, ...args) => {
      if (socketEventName === 'username-accepted' && args[0]?.username) {
        socket.__regionalPointsUsername = String(args[0].username);
        const accepted = previousEmit(socketEventName, ...args);
        void (async () => {
          try {
            const username = socket.__regionalPointsUsername;
            const initialPoints = await getPoints(username);
            // 履歴側のsocket.emitフックも通すことで、ログインポイントを
            // 「地域ポイント履歴」に確実に記録します。
            socket.emit('region-points-updated', {
              username,
              points: initialPoints,
              earned: 0
            });

            const loginAward = await awardDailyLoginPoints(username);
            emitPointAward(socket, username, {
              ...loginAward,
              reason: loginAward.earned > 0 ? 'daily-login' : ''
            });
          } catch (error) {
            console.error('Regional points load/login award failed:', error);
          }
        })();
        return accepted;
      }
      return previousEmit(socketEventName, ...args);
    };

    return listener(socket, ...rest);
  };

  return originalServerOn.call(this, eventName, wrappedListener);
};

export { getPoints };
export const regionalPointsPersistenceEnabled = enabled;
