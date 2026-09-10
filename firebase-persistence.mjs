import crypto from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';

const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
let serviceAccount = null;
let projectId = '';
let enabled = false;
let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

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
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(firestoreValue) } };
  }
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

function normalizeLocationData(value) {
  if (!value || typeof value !== 'object') return null;
  const lat = Number(value.lat);
  const lng = Number(value.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat,
    lng,
    eventType: typeof value.eventType === 'string' ? value.eventType : 'その他',
    summary: typeof value.summary === 'string' ? value.summary : '',
    locationName: typeof value.locationName === 'string' ? value.locationName : '',
    matchedLocation: typeof value.matchedLocation === 'string' ? value.matchedLocation : '',
    matchedQuery: typeof value.matchedQuery === 'string' ? value.matchedQuery : ''
  };
}

function normalizeMessage(data) {
  const createdAt = typeof data?.createdAt === 'string' && data.createdAt
    ? data.createdAt
    : new Date().toISOString();
  return {
    id: typeof data?.id === 'string' ? data.id : null,
    username: typeof data?.username === 'string' && data.username ? data.username : '投稿者',
    message: typeof data?.message === 'string' ? data.message.slice(0, 2000) : '',
    userId: typeof data?.userId === 'string' ? data.userId.slice(0, 200) : '',
    createdAt,
    locationData: normalizeLocationData(data?.locationData)
  };
}

try {
  if (rawServiceAccount) {
    serviceAccount = JSON.parse(rawServiceAccount);
    projectId = String(serviceAccount.project_id || '').trim();
    if (!serviceAccount.client_email || !serviceAccount.private_key || !projectId) {
      throw new Error('service account JSONにclient_email、private_key、project_idが必要です');
    }
    enabled = true;
    console.log(`Firebase Firestore persistence enabled: project=${projectId}`);
  } else {
    console.warn('FIREBASE_SERVICE_ACCOUNT_JSON is not set. Firestore persistence is disabled.');
  }
} catch (error) {
  console.error('Firebase service account initialization failed:', error.message);
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

async function saveMessage(data) {
  if (!enabled) return null;
  const message = normalizeMessage(data);
  if (!message.message) return null;

  const result = await firestoreRequest('/messages', {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        ...Object.fromEntries(
          Object.entries(message)
            .filter(([key]) => key !== 'id')
            .map(([key, value]) => [key, firestoreValue(value)])
        )
      }
    })
  });

  const name = String(result?.name || '');
  return name.split('/').pop() || null;
}

async function loadRecentMessages() {
  if (!enabled) return [];
  const query = '/messages?pageSize=100&orderBy=createdAt%20desc';
  const result = await firestoreRequest(query, { method: 'GET' });
  const documents = Array.isArray(result?.documents) ? result.documents : [];
  return documents
    .map(doc => ({
      ...fromFirestoreFields(doc.fields || {}),
      id: String(doc.name || '').split('/').pop() || null
    }))
    .filter(item => item.message)
    .map(normalizeMessage)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

const usernameBySocketId = new Map();

const originalServerEmit = SocketIOServer.prototype.emit;
SocketIOServer.prototype.emit = function(eventName, ...args) {
  if (eventName !== 'receive-message' || !enabled) {
    return originalServerEmit.call(this, eventName, ...args);
  }

  const incoming = normalizeMessage(args[0]);
  const username = usernameBySocketId.get(incoming.userId);
  if (username) incoming.username = username;
  incoming.createdAt = incoming.createdAt || new Date().toISOString();
  args[0] = incoming;

  void (async () => {
    try {
      const id = await saveMessage(incoming);
      const broadcastData = id ? { ...incoming, id } : incoming;
      originalServerEmit.call(this, eventName, broadcastData);
    } catch (error) {
      console.error('Firestore message save failed:', error);
      originalServerEmit.call(this, eventName, incoming);
    }
  })();

  return this;
};

const originalServerOn = SocketIOServer.prototype.on;
SocketIOServer.prototype.on = function(eventName, listener) {
  if (eventName !== 'connection') {
    return originalServerOn.call(this, eventName, listener);
  }

  const wrappedListener = (socket, ...rest) => {
    const originalSocketEmit = socket.emit.bind(socket);
    socket.emit = (socketEventName, ...args) => {
      if (socketEventName === 'username-accepted' && args[0]?.username) {
        usernameBySocketId.set(socket.id, String(args[0].username));
        const accepted = originalSocketEmit(socketEventName, ...args);
        void (async () => {
          try {
            const history = await loadRecentMessages();
            for (const message of history) {
              originalSocketEmit('receive-message', {
                ...message,
                timestamp: new Date(message.createdAt).toLocaleTimeString('ja-JP')
              });
            }
          } catch (error) {
            console.error('Firestore history load failed:', error);
          }
        })();
        return accepted;
      }

      if (socketEventName === 'disconnect') usernameBySocketId.delete(socket.id);
      return originalSocketEmit(socketEventName, ...args);
    };

    return listener(socket, ...rest);
  };

  return originalServerOn.call(this, eventName, wrappedListener);
};

export const firebasePersistenceEnabled = enabled;
