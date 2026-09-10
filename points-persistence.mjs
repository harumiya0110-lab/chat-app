import crypto from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';

const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
let serviceAccount = null;
let projectId = '';
let enabled = false;
let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

const POINTS_PER_HELP = 10;

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
    helpUsers: Array.isArray(fields.helpUsers) ? fields.helpUsers : [],
    helpConfirmedUsers: Array.isArray(fields.helpConfirmedUsers) ? fields.helpConfirmedUsers : []
  };
}

async function getPoints(username) {
  if (!enabled || !username) return 0;
  const safeUsername = encodeURIComponent(String(username));
  const result = await firestoreRequest(`/regionalPoints/${safeUsername}`, { method: 'GET' });
  if (!result?.fields) return 0;
  const fields = fromFirestoreFields(result.fields);
  return Number(fields.points || 0);
}

async function setPoints(username, points) {
  const safeUsername = encodeURIComponent(String(username));
  await firestoreRequest(`/regionalPoints/${safeUsername}`, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: {
        username: firestoreValue(username),
        points: firestoreValue(Math.max(0, Math.floor(points)))
      }
    })
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
      reason: 'help-confirmed'
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

            // 自分の投稿には「手伝える」を登録できません。
            if (saved.username === username) {
              if (typeof ack === 'function') ack({ ok: false, reason: 'own-post' });
              return;
            }

            // 「手伝える」を押しただけでは地域ポイントは付与しません。
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

    // 「来た！」の確認は、このモジュール自身でイベントを登録します。
    originalSocketOn('confirm-help', (payload = {}, ack) => {
      void confirmHelp(socket, payload, ack);
    });

    const previousEmit = socket.emit.bind(socket);
    socket.emit = (socketEventName, ...args) => {
      if (socketEventName === 'username-accepted' && args[0]?.username) {
        socket.__regionalPointsUsername = String(args[0].username);
        const accepted = previousEmit(socketEventName, ...args);
        void (async () => {
          try {
            const points = await getPoints(socket.__regionalPointsUsername);
            previousEmit('region-points-updated', {
              username: socket.__regionalPointsUsername,
              points,
              earned: 0
            });
          } catch (error) {
            console.error('Regional points load failed:', error);
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

export const regionalPointsPersistenceEnabled = enabled;
