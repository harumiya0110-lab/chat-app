import crypto from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';

const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
let serviceAccount = null;
let projectId = '';
let storageBucket = '';
let enabled = false;
let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

const MEDIA_MAX_BYTES = 15 * 1024 * 1024;
const MEDIA_TYPES = new Set(['image', 'video']);

function base64Url(value) {
  return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

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
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k, v]) => [k, fromFirestoreValue(v)]));
  return null;
}

function fromFirestoreFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([k, v]) => [k, fromFirestoreValue(v)]));
}

function firestoreDocumentsUrl(path = '') {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents${path}`;
}

function storageObjectsUrl(path = '') {
  return `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(storageBucket)}/o${path}`;
}

try {
  if (rawServiceAccount) {
    serviceAccount = JSON.parse(rawServiceAccount);
    projectId = String(serviceAccount.project_id || '').trim();
    storageBucket = String(process.env.FIREBASE_STORAGE_BUCKET || '').trim() || `${projectId}.firebasestorage.app`;
    if (!serviceAccount.client_email || !serviceAccount.private_key || !projectId) {
      throw new Error('service account JSONにclient_email、private_key、project_idが必要です');
    }
    enabled = true;
    console.log(`Firebase media persistence enabled: project=${projectId}, bucket=${storageBucket}`);
  } else {
    console.warn('FIREBASE_SERVICE_ACCOUNT_JSON is not set. Media persistence is disabled.');
  }
} catch (error) {
  console.error('Firebase media persistence initialization failed:', error.message);
}

async function getAccessToken() {
  if (!enabled) return null;
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessTokenExpiresAt - now > 60) return cachedAccessToken;

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/devstorage.read_write',
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
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  if (!response.ok) throw new Error(`Google OAuth token request failed: ${response.status}`);
  const result = await response.json();
  cachedAccessToken = result.access_token;
  cachedAccessTokenExpiresAt = now + Number(result.expires_in || 3600);
  return cachedAccessToken;
}

async function firestoreRequest(path, options = {}) {
  const token = await getAccessToken();
  if (!token) return null;
  const response = await fetch(firestoreDocumentsUrl(path), {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const error = new Error(`Firestore request failed: ${response.status} ${body.slice(0, 300)}`);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!match) return null;
  const mimeType = String(match[1]).toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) return null;
  return { mimeType, buffer };
}

function extensionForMime(mimeType, type) {
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/ogg': 'ogv',
    'video/quicktime': 'mov'
  };
  return map[mimeType] || (type === 'video' ? 'bin' : 'bin');
}

async function uploadToStorage(dataUrl, type) {
  if (!enabled) return null;
  if (!MEDIA_TYPES.has(type)) return null;
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error('動画または画像のデータ形式が正しくありません');
  if (parsed.buffer.length > MEDIA_MAX_BYTES) throw new Error('動画・画像は15MB以下にしてください');

  const prefix = type === 'video' ? 'videos' : 'images';
  const extension = extensionForMime(parsed.mimeType, type);
  const objectName = `chat-media/${prefix}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${extension}`;
  const token = crypto.randomUUID();
  const accessToken = await getAccessToken();

  const uploadUrl = `${storageObjectsUrl()}?uploadType=media&name=${encodeURIComponent(objectName)}`;
  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': parsed.mimeType,
      'Content-Length': String(parsed.buffer.length)
    },
    body: parsed.buffer
  });
  if (!uploadResponse.ok) {
    const body = await uploadResponse.text().catch(() => '');
    throw new Error(`Firebase Storage upload failed: ${uploadResponse.status} ${body.slice(0, 300)}`);
  }

  const patchUrl = storageObjectsUrl(`/${encodeURIComponent(objectName)}`);
  const metadataResponse = await fetch(patchUrl, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ metadata: { firebaseStorageDownloadTokens: token } })
  });
  if (!metadataResponse.ok) {
    const body = await metadataResponse.text().catch(() => '');
    throw new Error(`Firebase Storage metadata update failed: ${metadataResponse.status} ${body.slice(0, 300)}`);
  }

  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket)}/o/${encodeURIComponent(objectName)}?alt=media&token=${encodeURIComponent(token)}`;
  return { url: downloadUrl, mimeType: parsed.mimeType, bytes: parsed.buffer.length };
}

async function saveMediaDocument({ type, url, filename, username, userId, createdAt, mimeType }) {
  if (!enabled || !url) return null;
  const fields = {
    id: firestoreValue(null),
    username: firestoreValue(String(username || '投稿者').slice(0, 50)),
    message: firestoreValue(''),
    userId: firestoreValue(String(userId || '').slice(0, 200)),
    createdAt: firestoreValue(createdAt || new Date().toISOString()),
    locationData: firestoreValue(null),
    helpUsers: firestoreValue([]),
    helpConfirmedUsers: firestoreValue([]),
    mediaType: firestoreValue(type),
    mediaUrl: firestoreValue(url),
    filename: firestoreValue(String(filename || '').slice(0, 200)),
    mimeType: firestoreValue(String(mimeType || '').slice(0, 100))
  };
  const result = await firestoreRequest('/messages', {
    method: 'POST',
    body: JSON.stringify({ fields })
  });
  return String(result?.name || '').split('/').pop() || null;
}

async function loadRecentMedia() {
  if (!enabled) return [];
  const result = await firestoreRequest('/messages?pageSize=100&orderBy=createdAt%20desc', { method: 'GET' });
  return (Array.isArray(result?.documents) ? result.documents : [])
    .map(doc => ({ ...fromFirestoreFields(doc.fields || {}), id: String(doc.name || '').split('/').pop() || null }))
    .filter(item => MEDIA_TYPES.has(item.mediaType) && typeof item.mediaUrl === 'string' && item.mediaUrl)
    .map(item => ({
      id: item.id,
      username: typeof item.username === 'string' ? item.username : '投稿者',
      userId: typeof item.userId === 'string' ? item.userId : '',
      createdAt: typeof item.createdAt === 'string' && item.createdAt ? item.createdAt : new Date().toISOString(),
      mediaType: item.mediaType,
      mediaUrl: item.mediaUrl,
      filename: typeof item.filename === 'string' ? item.filename : null,
      mimeType: typeof item.mimeType === 'string' ? item.mimeType : ''
    }))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

const usernameBySocketId = new Map();

const originalServerOn = SocketIOServer.prototype.on;
SocketIOServer.prototype.on = function(eventName, listener) {
  if (eventName !== 'connection') return originalServerOn.call(this, eventName, listener);

  const wrappedListener = (socket, ...rest) => {
    const originalSocketOn = socket.on.bind(socket);
    const originalSocketEmit = socket.emit.bind(socket);

    socket.on = (socketEventName, socketListener) => {
      if (socketEventName === 'send-image') {
        return originalSocketOn('send-image', async data => {
          const userId = socket.id;
          const username = usernameBySocketId.get(userId) || '投稿者';
          const createdAt = new Date().toISOString();
          try {
            const uploaded = await uploadToStorage(data?.image, 'image');
            if (uploaded) {
              const media = { username, userId, image: uploaded.url, filename: data?.filename || null, timestamp: new Date(createdAt).toLocaleTimeString('ja-JP'), createdAt, mediaType: 'image', mediaUrl: uploaded.url, mimeType: uploaded.mimeType };
              await saveMediaDocument({ type: 'image', url: uploaded.url, filename: data?.filename, username, userId, createdAt, mimeType: uploaded.mimeType });
              socket.server.emit('receive-image', media);
              return;
            }
          } catch (error) {
            console.error('Persistent image upload failed:', error);
          }
          // Firebase Storageが使えない場合も、既存のリアルタイム送信を維持します。
          if (typeof socketListener === 'function') socketListener(data);
        });
      }

      if (socketEventName === 'send-video') {
        return originalSocketOn('send-video', async data => {
          const userId = socket.id;
          const username = usernameBySocketId.get(userId) || '投稿者';
          const createdAt = new Date().toISOString();
          try {
            const uploaded = await uploadToStorage(data?.video, 'video');
            if (uploaded) {
              const media = { username, userId, video: uploaded.url, filename: data?.filename || null, timestamp: new Date(createdAt).toLocaleTimeString('ja-JP'), createdAt, mediaType: 'video', mediaUrl: uploaded.url, mimeType: uploaded.mimeType };
              await saveMediaDocument({ type: 'video', url: uploaded.url, filename: data?.filename, username, userId, createdAt, mimeType: uploaded.mimeType });
              socket.server.emit('receive-video', media);
              return;
            }
          } catch (error) {
            console.error('Persistent video upload failed:', error);
          }
          if (typeof socketListener === 'function') socketListener(data);
        });
      }

      return originalSocketOn(socketEventName, socketListener);
    };

    socket.emit = (socketEventName, ...args) => {
      if (socketEventName === 'username-accepted' && args[0]?.username) {
        usernameBySocketId.set(socket.id, String(args[0].username));
        const result = originalSocketEmit(socketEventName, ...args);
        void (async () => {
          try {
            for (const media of await loadRecentMedia()) {
              if (media.mediaType === 'image') originalSocketEmit('receive-image', { username: media.username, image: media.mediaUrl, filename: media.filename, timestamp: new Date(media.createdAt).toLocaleTimeString('ja-JP'), userId: media.userId, createdAt: media.createdAt, id: media.id });
              else if (media.mediaType === 'video') originalSocketEmit('receive-video', { username: media.username, video: media.mediaUrl, filename: media.filename, timestamp: new Date(media.createdAt).toLocaleTimeString('ja-JP'), userId: media.userId, createdAt: media.createdAt, id: media.id });
            }
          } catch (error) {
            console.error('Firestore media history load failed:', error);
          }
        })();
        return result;
      }

      if (socketEventName === 'disconnect') usernameBySocketId.delete(socket.id);
      return originalSocketEmit(socketEventName, ...args);
    };

    return listener(socket, ...rest);
  };

  return originalServerOn.call(this, eventName, wrappedListener);
};

export const firebaseMediaPersistenceEnabled = enabled;
