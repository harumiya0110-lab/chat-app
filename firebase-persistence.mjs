import crypto from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';

const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
let serviceAccount = null;
let projectId = '';
let enabled = false;
let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

// ログインのたびにFirestoreへ同じ履歴を取得しないよう、直近履歴をサーバー側で短時間キャッシュします。
let recentMessageHistoryCache = null;
let recentMessageHistoryPromise = null;
const RECENT_HISTORY_PAGE_SIZE = 50;

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

function normalizeMedia(value) {
  if (!value || typeof value !== 'object') return null;
  const id = typeof value.id === 'string' ? value.id.trim().slice(0, 120) : '';
  const type = value.type === 'video' ? 'video' : value.type === 'image' ? 'image' : '';
  if (!id || !type) return null;
  return {
    id,
    type,
    filename: typeof value.filename === 'string' ? value.filename.slice(0, 200) : '',
    mimeType: typeof value.mimeType === 'string' ? value.mimeType.slice(0, 80) : '',
    mediaUrl: typeof value.mediaUrl === 'string' ? value.mediaUrl.slice(0, 300) : '',
    thumbnailUrl: typeof value.thumbnailUrl === 'string' ? value.thumbnailUrl.slice(0, 300) : '',
    size: Math.max(0, Math.min(15 * 1024 * 1024, Number(value.size) || 0)),
    durationSec: Math.max(0, Math.min(30, Number(value.durationSec) || 0))
  };
}

function normalizeLocationData(value) {
  if (!value || typeof value !== 'object') return null;
  const lat = Number(value.lat);
  const lng = Number(value.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const eventStartAt = typeof value.eventStartAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value.eventStartAt.trim())
    ? value.eventStartAt.trim()
    : '';
  return {
    lat,
    lng,
    eventType: typeof value.eventType === 'string' ? value.eventType : 'その他',
    eventStartAt,
    summary: typeof value.summary === 'string' ? value.summary : '',
    locationName: typeof value.locationName === 'string' ? value.locationName : '',
    matchedLocation: typeof value.matchedLocation === 'string' ? value.matchedLocation : '',
    matchedQuery: typeof value.matchedQuery === 'string' ? value.matchedQuery : ''
  };
}

function normalizeMessage(data) {
  const createdAt = typeof data?.createdAt === 'string' && data.createdAt ? data.createdAt : new Date().toISOString();
  const cleanList = (value) => Array.isArray(value)
    ? [...new Set(value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim().slice(0, 50)))].slice(0, 100)
    : [];
  const cleanReactionUsers = value => value && typeof value === 'object'
    ? Object.fromEntries(['like', 'helpful', 'thanks'].map(key => [key, cleanList(value[key])]))
    : { like: [], helpful: [], thanks: [] };
  const replyToId = typeof data?.replyToId === 'string' ? data.replyToId.trim().slice(0, 120) : '';
  const replyToUsername = typeof data?.replyToUsername === 'string' ? data.replyToUsername.trim().slice(0, 50) : '';
  const replyToText = typeof data?.replyToText === 'string' ? data.replyToText.trim().slice(0, 200) : '';
  const status = data?.status === 'resolved' ? 'resolved' : 'open';
  return {
    id: typeof data?.id === 'string' && data.id.trim() ? data.id.trim() : crypto.randomUUID(),
    username: typeof data?.username === 'string' && data.username ? data.username : '投稿者',
    message: typeof data?.message === 'string' ? data.message.slice(0, 2000) : '',
    userId: typeof data?.userId === 'string' ? data.userId.slice(0, 200) : '',
    createdAt,
    locationData: normalizeLocationData(data?.locationData),
    media: normalizeMedia(data?.media),
    helpUsers: cleanList(data?.helpUsers),
    helpConfirmedUsers: cleanList(data?.helpConfirmedUsers),
    reactions: cleanReactionUsers(data?.reactions),
    replyToId,
    replyToUsername,
    replyToText,
    status,
    resolvedBy: typeof data?.resolvedBy === 'string' ? data.resolvedBy.trim().slice(0, 50) : '',
    resolvedAt: typeof data?.resolvedAt === 'string' ? data.resolvedAt : ''
  };
}

try {
  if (rawServiceAccount) {
    serviceAccount = JSON.parse(rawServiceAccount);
    projectId = String(serviceAccount.project_id || '').trim();
    if (!serviceAccount.client_email || !serviceAccount.private_key || !projectId) throw new Error('service account JSONにclient_email、private_key、project_idが必要です');
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
  const payload = { iss: serviceAccount.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
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

function documentsUrl(path = '') {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents${path}`;
}

async function firestoreRequest(path, options = {}) {
  const token = await getAccessToken();
  if (!token) return null;
  const response = await fetch(documentsUrl(path), {
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



const FIRESTORE_MEDIA_CHUNK_BYTES = 500 * 1024;

function mediaAssetDocumentPath(id) {
  return '/mediaAssets/' + encodeURIComponent(String(id || '').trim());
}

function mediaChunkCollectionPath(id) {
  return mediaAssetDocumentPath(id) + '/chunks';
}

function bufferFromValue(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

async function saveMediaAsset(entry) {
  if (!enabled || !entry?.id) return false;

  const buffer = bufferFromValue(entry.buffer);
  if (!buffer?.length) return false;

  const id = String(entry.id).trim().slice(0, 120);
  const chunkCount = Math.ceil(buffer.length / FIRESTORE_MEDIA_CHUNK_BYTES);
  const thumbnailBuffer = bufferFromValue(entry.thumbnailBytes);
  const metadata = {
    messageId: String(entry.messageId || '').trim().slice(0, 120),
    ownerUsername: String(entry.ownerUsername || '').trim().slice(0, 50),
    type: entry.type === 'video' ? 'video' : 'image',
    filename: String(entry.filename || '').slice(0, 200),
    mimeType: String(entry.mimeType || '').slice(0, 80),
    size: buffer.length,
    durationSec: Math.max(0, Math.min(30, Number(entry.durationSec) || 0)),
    chunkCount,
    thumbnailBase64: thumbnailBuffer?.length ? thumbnailBuffer.toString('base64') : '',
    thumbnailMime: String(entry.thumbnailMime || 'image/jpeg').slice(0, 80),
    createdAt: new Date(Number(entry.createdAt) || Date.now()).toISOString()
  };

  const fields = Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, firestoreValue(value)]));
  await firestoreRequest(mediaAssetDocumentPath(id), {
    method: 'PATCH',
    body: JSON.stringify({ fields })
  });

  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * FIRESTORE_MEDIA_CHUNK_BYTES;
    const chunk = buffer.subarray(start, Math.min(buffer.length, start + FIRESTORE_MEDIA_CHUNK_BYTES));
    const chunkId = String(index).padStart(6, '0');
    await firestoreRequest(mediaChunkCollectionPath(id) + '/' + chunkId, {
      method: 'PATCH',
      body: JSON.stringify({
        fields: {
          index: firestoreValue(index),
          dataBase64: firestoreValue(chunk.toString('base64'))
        }
      })
    });
  }

  return true;
}

async function loadMediaAsset(id) {
  if (!enabled || !id) return null;
  const safeId = String(id).trim();
  try {
    const metadataDoc = await firestoreRequest(mediaAssetDocumentPath(safeId), { method: 'GET' });
    if (!metadataDoc?.fields) return null;

    const metadata = fromFirestoreFields(metadataDoc.fields);
    const chunkCount = Math.max(0, Math.min(100, Number(metadata.chunkCount) || 0));
    if (!chunkCount) return null;

    const chunks = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({ pageSize: '100' });
      if (pageToken) params.set('pageToken', pageToken);
      const result = await firestoreRequest(mediaChunkCollectionPath(safeId) + '?' + params.toString(), { method: 'GET' });
      for (const document of Array.isArray(result?.documents) ? result.documents : []) {
        const fields = fromFirestoreFields(document.fields || {});
        const index = Number(fields.index);
        const dataBase64 = typeof fields.dataBase64 === 'string' ? fields.dataBase64 : '';
        if (Number.isInteger(index) && index >= 0 && dataBase64) chunks.push({ index, dataBase64 });
      }
      pageToken = String(result?.nextPageToken || '');
    } while (pageToken);

    chunks.sort((a, b) => a.index - b.index);
    if (chunks.length !== chunkCount || chunks.some((chunk, index) => chunk.index !== index)) {
      throw new Error('Firestoreメディアチャンクが不足しています');
    }

    const buffer = Buffer.concat(chunks.map(chunk => Buffer.from(chunk.dataBase64, 'base64')));
    const expectedSize = Math.max(0, Number(metadata.size) || 0);
    if (!expectedSize || buffer.length !== expectedSize) {
      throw new Error('Firestoreメディアサイズが一致しません');
    }

    let thumbnailBytes = null;
    if (typeof metadata.thumbnailBase64 === 'string' && metadata.thumbnailBase64) {
      thumbnailBytes = Buffer.from(metadata.thumbnailBase64, 'base64');
    }

    return {
      id: safeId,
      messageId: String(metadata.messageId || '').trim(),
      ownerUsername: String(metadata.ownerUsername || '').trim(),
      type: metadata.type === 'video' ? 'video' : 'image',
      filename: String(metadata.filename || ''),
      mimeType: String(metadata.mimeType || (metadata.type === 'video' ? 'video/mp4' : 'image/jpeg')),
      buffer,
      thumbnailBytes,
      thumbnailMime: String(metadata.thumbnailMime || 'image/jpeg'),
      durationSec: Math.max(0, Math.min(30, Number(metadata.durationSec) || 0)),
      createdAt: Date.parse(String(metadata.createdAt || '')) || Date.now(),
      bytes: buffer.length,
      persistent: true
    };
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function deleteMediaAsset(id) {
  if (!enabled || !id) return false;
  const safeId = String(id).trim();

  while (true) {
    const result = await firestoreRequest(mediaChunkCollectionPath(safeId) + '?pageSize=100', { method: 'GET' });
    const documents = Array.isArray(result?.documents) ? result.documents : [];
    if (!documents.length) break;
    for (const document of documents) {
      const name = String(document?.name || '');
      if (!name) continue;
      const idPath = name.split('/documents/').pop();
      if (!idPath) continue;
      await firestoreRequest('/' + idPath.split('/').map(encodeURIComponent).join('/'), { method: 'DELETE' });
    }
  }

  try {
    await firestoreRequest(mediaAssetDocumentPath(safeId), { method: 'DELETE' });
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  return true;
}

async function clearAllMediaAssets() {
  if (!enabled) return 0;
  let deleted = 0;

  while (true) {
    const result = await firestoreRequest('/mediaAssets?pageSize=100', { method: 'GET' });
    const documents = Array.isArray(result?.documents) ? result.documents : [];
    if (!documents.length) break;

    for (const document of documents) {
      const name = String(document?.name || '');
      const id = name.split('/').pop();
      if (!id) continue;
      await deleteMediaAsset(decodeURIComponent(id));
      deleted += 1;
    }
  }

  return deleted;
}

async function saveReport(data) {
  if (!enabled) return null;
  const id = typeof data?.id === 'string' && data.id.trim() ? data.id.trim() : crypto.randomUUID();
  const report = { id, messageId: String(data?.messageId || '').slice(0, 120), reason: String(data?.reason || '').trim().slice(0, 100), message: String(data?.message || '').trim().slice(0, 2000), targetUsername: String(data?.targetUsername || '').trim().slice(0, 50), reporterUsername: String(data?.reporterUsername || '').trim().slice(0, 50), createdAt: typeof data?.createdAt === 'string' ? data.createdAt : new Date().toISOString(), status: 'open' };
  const fields = Object.fromEntries(Object.entries(report).filter(([key]) => key !== 'id').map(([key, value]) => [key, firestoreValue(value)]));
  await firestoreRequest('/reports/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ fields }) });
  return report;
}
async function loadReports(limit = 100) {
  if (!enabled) return [];
  const params = new URLSearchParams({ pageSize: String(Math.min(100, Math.max(1, limit))), orderBy: 'createdAt desc' });
  const result = await firestoreRequest('/reports?' + params.toString(), { method: 'GET' });
  const seen = new Set();
  return (Array.isArray(result?.documents) ? result.documents : [])
    .map(doc => ({ ...fromFirestoreFields(doc.fields || {}), id: String(doc.name || '').split('/').pop() || null }))
    .filter(item => item.message)
    .filter(item => {
      // 同じ通報が複数回保存されてしまった場合でも、管理画面では1件だけ表示する。
      const key = [item.messageId, item.reporterUsername, item.reason, item.message].map(value => String(value || '').trim()).join('\u001f');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(item => ({ ...item, status: item.status === 'closed' ? 'closed' : 'open' }))
    .slice(0, limit);
}

async function saveMessage(data) {
  if (!enabled) return null;
  const message = normalizeMessage(data);
  if (!message.message) return null;
  const fields = Object.fromEntries(Object.entries(message).filter(([key]) => key !== 'id').map(([key, value]) => [key, firestoreValue(value)]));
  const safeId = encodeURIComponent(message.id);
  await firestoreRequest('/messages/' + safeId, {
    method: 'PATCH',
    body: JSON.stringify({ fields })
  });
  recentMessageHistoryCache = null;
  recentMessageHistoryPromise = null;
  return message.id;
}

async function getSavedMessage(id) {
  if (!enabled || !id) return null;
  const safeId = encodeURIComponent(String(id));
  try {
    const existing = await firestoreRequest(`/messages/${safeId}`, { method: 'GET' });
    if (!existing?.fields) return null;
    return normalizeMessage({ ...fromFirestoreFields(existing.fields), id: String(existing.name || '').split('/').pop() || String(id) });
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function deleteMessage(id, username, isAdmin = false) {
  const cleanUsername = String(username || '').trim().slice(0, 50);
  if (!enabled || !id || !cleanUsername) return { ok: false, reason: 'invalid' };
  const saved = await getSavedMessage(id);
  if (!saved) return { ok: false, reason: 'not-found' };
  // ゲスト方式ではログアウト・再ログインのたびにSocket IDが変わるため、
  // 投稿者のニックネームを所有者として判定します。
  if (!isAdmin && String(saved.username || '').normalize('NFC') !== cleanUsername.normalize('NFC')) {
    return { ok: false, reason: 'not-owner' };
  }
  if (saved.media?.id) {
    try { await deleteMediaAsset(saved.media.id); }
    catch (error) { console.error('Firestore media delete failed:', error); }
  }
  await firestoreRequest(`/messages/${encodeURIComponent(String(id))}`, { method: 'DELETE' });
  recentMessageHistoryCache = null;
  recentMessageHistoryPromise = null;
  return { ok: true };
}

async function toggleHelper(id, username) {
  if (!enabled || !id || !username) return { ok: false, reason: 'invalid' };
  const cleanUsername = String(username).trim().slice(0, 50);
  const saved = await getSavedMessage(id);
  if (!saved) return { ok: false, reason: 'not-found' };
  const helpUsers = [...saved.helpUsers];
  const index = helpUsers.indexOf(cleanUsername);
  let helping;
  if (index >= 0) { helpUsers.splice(index, 1); helping = false; }
  else { helpUsers.push(cleanUsername); helpUsers.splice(0, Math.max(0, helpUsers.length - 100)); helping = true; }
  await firestoreRequest(`/messages/${encodeURIComponent(String(id))}?updateMask.fieldPaths=helpUsers`, {
    method: 'PATCH', body: JSON.stringify({ fields: { helpUsers: firestoreValue(helpUsers) } })
  });
  return { ok: true, helping, helpUsers, count: helpUsers.length, helpConfirmedUsers: saved.helpConfirmedUsers };
}

async function loadMessagePage(pageToken = '', pageSize = 50) {
  if (!enabled) return { messages: [], nextPageToken: '' };

  const requestedPageSize = Math.min(50, Math.max(1, pageSize));
  // 初回ページだけをキャッシュ。ページング用のトークンも一緒に保持します。
  if (!pageToken && requestedPageSize === RECENT_HISTORY_PAGE_SIZE && recentMessageHistoryCache) {
    return {
      messages: recentMessageHistoryCache.messages.map(message => ({ ...message })),
      nextPageToken: recentMessageHistoryCache.nextPageToken
    };
  }

  if (!pageToken && requestedPageSize === RECENT_HISTORY_PAGE_SIZE && recentMessageHistoryPromise) {
    const cached = await recentMessageHistoryPromise;
    return {
      messages: cached.messages.map(message => ({ ...message })),
      nextPageToken: cached.nextPageToken
    };
  }

  const fetchPage = async () => {
    const params = new URLSearchParams({
      pageSize: String(requestedPageSize),
      orderBy: 'createdAt desc'
    });
    if (pageToken) params.set('pageToken', pageToken);
    const result = await firestoreRequest('/messages?' + params.toString(), { method: 'GET' });
    const messages = (Array.isArray(result?.documents) ? result.documents : [])
      .map(doc => ({ ...fromFirestoreFields(doc.fields || {}), id: String(doc.name || '').split('/').pop() || null }))
      .filter(item => item.message)
      .map(normalizeMessage)
      .reverse();
    return { messages, nextPageToken: String(result?.nextPageToken || '') };
  };

  if (!pageToken && requestedPageSize === RECENT_HISTORY_PAGE_SIZE) {
    recentMessageHistoryPromise = fetchPage();
    try {
      const result = await recentMessageHistoryPromise;
      recentMessageHistoryCache = {
        messages: result.messages.map(message => ({ ...message })),
        nextPageToken: result.nextPageToken,
        cachedAt: Date.now()
      };
      return result;
    } finally {
      recentMessageHistoryPromise = null;
    }
  }

  return fetchPage();
}

async function warmRecentMessageHistory() {
  if (!enabled || recentMessageHistoryCache || recentMessageHistoryPromise) return;
  try {
    await loadMessagePage('', RECENT_HISTORY_PAGE_SIZE);
    console.log('[firebase] recent chat history cache warmed');
  } catch (error) {
    console.warn('[firebase] recent chat history warm-up failed:', error.message);
  }
}

const usernameBySocketId = new Map();
const historyCursorBySocketId = new Map();
const adminBySocketId = new Map();
const originalServerEmit = SocketIOServer.prototype.emit;
SocketIOServer.prototype.emit = function(eventName, ...args) {
  if (eventName === 'message-media-attached' && enabled) {
    const payload = args[0];
    const messageId = typeof payload?.messageId === 'string' ? payload.messageId.trim() : '';
    const media = normalizeMedia(payload?.media);
    if (!messageId || !media) return originalServerEmit.call(this, eventName, ...args);

    void (async () => {
      try {
        let saved = null;
        for (let attempt = 0; attempt < 4 && !saved; attempt += 1) {
          saved = await getSavedMessage(messageId);
          if (!saved && attempt < 3) await new Promise(resolve => setTimeout(resolve, 250));
        }
        if (saved) {
          await firestoreRequest(`/messages/${encodeURIComponent(messageId)}?updateMask.fieldPaths=media`, {
            method: 'PATCH',
            body: JSON.stringify({ fields: { media: firestoreValue(media) } })
          });
        }
      } catch (error) {
        console.error('Firestore media metadata save failed:', error);
      }
      originalServerEmit.call(this, eventName, { ...payload, media });
    })();
    return this;
  }

  if (eventName !== 'receive-message' || !enabled) return originalServerEmit.call(this, eventName, ...args);
  const incoming = normalizeMessage(args[0]);
  const username = usernameBySocketId.get(incoming.userId);
  if (username) incoming.username = username;
  incoming.createdAt = incoming.createdAt || new Date().toISOString();
  void (async () => {
    try {
      const id = await saveMessage(incoming);
      originalServerEmit.call(this, eventName, id ? { ...incoming, id } : incoming);
    } catch (error) {
      console.error('Firestore message save failed:', error);
      originalServerEmit.call(this, eventName, incoming);
    }
  })();
  return this;
};

const originalServerOn = SocketIOServer.prototype.on;
SocketIOServer.prototype.on = function(eventName, listener) {
  if (eventName !== 'connection') return originalServerOn.call(this, eventName, listener);
  const wrappedListener = (socket, ...rest) => {
    socket.on('submit-report', async (payload = {}, ack) => {
      const reporter = usernameBySocketId.get(socket.id);
      const id = typeof payload.id === 'string' ? payload.id.trim() : '';
      const reason = typeof payload.reason === 'string' ? payload.reason.trim().slice(0, 100) : '';
      const message = typeof payload.message === 'string' ? payload.message.trim().slice(0, 2000) : '';
      const targetUsername = typeof payload.targetUsername === 'string' ? payload.targetUsername.trim().slice(0, 50) : '';
      if (!reporter || !id || !reason || !message) return typeof ack === 'function' && ack({ ok: false, reason: 'invalid' });
      try {
        // クライアント側だけでなくサーバー側でも自分の投稿への通報を禁止します。
        const saved = await getSavedMessage(id);
        if (!saved) return typeof ack === 'function' && ack({ ok: false, reason: 'not-found' });
        const savedUsername = String(saved.username || '').trim().normalize('NFC');
        const reporterUsername = String(reporter || '').trim().normalize('NFC');
        if (savedUsername && savedUsername === reporterUsername) {
          return typeof ack === 'function' && ack({ ok: false, reason: 'own-post' });
        }

        const report = await saveReport({ id: crypto.randomUUID(), messageId: id, reason, message, targetUsername: String(saved.username || targetUsername).slice(0, 50), reporterUsername: reporter, createdAt: new Date().toISOString() });
        if (report) for (const [socketId, admin] of adminBySocketId.entries()) if (admin) io.to(socketId).emit('chat-report-created', report);
        if (typeof ack === 'function') ack({ ok: true });
      } catch (error) {
        console.error('Firestore report save failed:', error);
        if (typeof ack === 'function') ack({ ok: false, reason: 'server-error' });
      }
    });
    socket.on('get-reports', async (_payload, ack) => {
      if (!adminBySocketId.get(socket.id)) return typeof ack === 'function' && ack({ ok: false, reason: 'forbidden' });
      try {
        const reports = await loadReports(100);
        if (typeof ack === 'function') ack({ ok: true, reports });
      } catch (error) {
        console.error('Firestore report load failed:', error);
        if (typeof ack === 'function') ack({ ok: false, reason: 'server-error' });
      }
    });

    socket.on('get-message-by-id', async (payload = {}, ack) => {
      if (!adminBySocketId.get(socket.id)) return typeof ack === 'function' && ack({ ok: false, reason: 'forbidden' });
      const id = typeof payload.id === 'string' ? payload.id.trim() : '';
      if (!id) return typeof ack === 'function' && ack({ ok: false, reason: 'invalid' });
      try {
        const message = await getSavedMessage(id);
        if (!message) return typeof ack === 'function' && ack({ ok: false, reason: 'not-found' });
        if (typeof ack === 'function') {
          ack({
            ok: true,
            message: {
              ...message,
              timestamp: new Date(message.createdAt).toLocaleTimeString('ja-JP')
            }
          });
        }
      } catch (error) {
        console.error('Firestore message fetch by id failed:', error);
        if (typeof ack === 'function') ack({ ok: false, reason: 'server-error' });
      }
    });

    socket.on('admin-clear-all-chat', async (_payload = {}, ack) => {
      if (!adminBySocketId.get(socket.id)) return typeof ack === 'function' && ack({ ok: false, reason: 'forbidden' });
      try {
        const result = await clearAllMessages();
        if (!result.ok) {
          if (typeof ack === 'function') ack(result);
          return;
        }
        socket.server.emit('chat-posts-cleared', { admin: true, deleted: result.deleted });
        if (typeof ack === 'function') ack(result);
      } catch (error) {
        console.error('Firestore admin clear-all failed:', error);
        if (typeof ack === 'function') ack({ ok: false, reason: 'server-error' });
      }
    });

    socket.on('delete-map-pin', async (payload = {}, ack) => {
      const username = usernameBySocketId.get(socket.id);
      const id = typeof payload.id === 'string' ? payload.id.trim() : '';
      const isAdmin = adminBySocketId.get(socket.id) === true;
      if (!username || !id) return typeof ack === 'function' && ack({ ok: false, reason: 'unauthorized' });
      try {
        const result = await deleteMessage(id, username, isAdmin);
        if (result.ok) {
          socket.server.emit('map-pin-deleted', { id, username, admin: isAdmin });
          socket.server.emit('chat-message-deleted', { id, username, admin: isAdmin });
        }
        if (typeof ack === 'function') ack(result);
      } catch (error) {
        console.error('Firestore message delete failed:', error);
        if (typeof ack === 'function') ack({ ok: false, reason: 'server-error' });
      }
    });

    socket.on('delete-chat-message', async (payload = {}, ack) => {
      const username = usernameBySocketId.get(socket.id);
      const id = typeof payload.id === 'string' ? payload.id.trim() : '';
      const isAdmin = adminBySocketId.get(socket.id) === true;
      if (!username || !id) return typeof ack === 'function' && ack({ ok: false, reason: 'unauthorized' });
      try {
        const saved = await getSavedMessage(id);
        if (!saved) return typeof ack === 'function' && ack({ ok: false, reason: 'not-found' });
        if (!isAdmin && String(saved.username || '').normalize('NFC') !== String(username || '').normalize('NFC')) {
          return typeof ack === 'function' && ack({ ok: false, reason: 'not-owner' });
        }
        const result = await deleteMessage(id, username, isAdmin);
        if (result.ok) socket.server.emit('chat-message-deleted', { id, username, admin: isAdmin });
        if (typeof ack === 'function') ack(result);
      } catch (error) {
        console.error('Firestore chat message delete failed:', error);
        if (typeof ack === 'function') ack({ ok: false, reason: 'server-error' });
      }
    });

    socket.on('load-more-chat-history', async (_payload, ack) => {
      const username = usernameBySocketId.get(socket.id);
      const token = historyCursorBySocketId.get(socket.id) || '';
      if (!username) return typeof ack === 'function' && ack({ ok: false, reason: 'unauthorized' });
      if (!token) return typeof ack === 'function' && ack({ ok: true, messages: [], hasMore: false });
      try {
        const page = await loadMessagePage(token, 50);
        historyCursorBySocketId.set(socket.id, page.nextPageToken);
        const messages = page.messages.map(message => ({ ...message, timestamp: new Date(message.createdAt).toLocaleTimeString('ja-JP') }));
        if (typeof ack === 'function') ack({ ok: true, messages, hasMore: Boolean(page.nextPageToken) });
      } catch (error) {
        console.error('Firestore older history load failed:', error);
        if (typeof ack === 'function') ack({ ok: false, reason: 'server-error' });
      }
    });

    socket.on('toggle-reaction', async (payload = {}, ack) => {
      const username = usernameBySocketId.get(socket.id);
      const id = typeof payload.id === 'string' ? payload.id.trim() : '';
      const reaction = ['like', 'helpful', 'thanks'].includes(payload.reaction) ? payload.reaction : '';
      if (!username || !id || !reaction) return typeof ack === 'function' && ack({ ok: false, reason: 'unauthorized' });
      try {
        const saved = await getSavedMessage(id);
        if (!saved) return typeof ack === 'function' && ack({ ok: false, reason: 'not-found' });
        const reactions = saved.reactions && typeof saved.reactions === 'object' ? saved.reactions : { like: [], helpful: [], thanks: [] };
        const users = Array.isArray(reactions[reaction]) ? [...reactions[reaction]] : [];
        const index = users.indexOf(username);
        if (index >= 0) users.splice(index, 1);
        else { users.push(username); if (users.length > 100) users.splice(0, users.length - 100); }
        reactions[reaction] = users;
        await firestoreRequest('/messages/' + encodeURIComponent(id) + '?updateMask.fieldPaths=reactions', {
          method: 'PATCH',
          body: JSON.stringify({ fields: { reactions: firestoreValue(reactions) } })
        });
        socket.server.emit('message-reactions-updated', { id, reactions });
        if (typeof ack === 'function') ack({ ok: true, reactions });
      } catch (error) {
        console.error('Firestore reaction update failed:', error);
        if (typeof ack === 'function') ack({ ok: false, reason: 'server-error' });
      }
    });

    socket.on('toggle-resolved', async (payload = {}, ack) => {
      const username = usernameBySocketId.get(socket.id);
      const id = typeof payload.id === 'string' ? payload.id.trim() : '';
      if (!username || !id) return typeof ack === 'function' && ack({ ok: false, reason: 'unauthorized' });
      try {
        const saved = await getSavedMessage(id);
        if (!saved) return typeof ack === 'function' && ack({ ok: false, reason: 'not-found' });
        if (saved.username !== username) return typeof ack === 'function' && ack({ ok: false, reason: 'not-owner' });
        const nextStatus = saved.status === 'resolved' ? 'open' : 'resolved';
        const fields = nextStatus === 'resolved'
          ? { status: firestoreValue('resolved'), resolvedBy: firestoreValue(username), resolvedAt: firestoreValue(new Date().toISOString()) }
          : { status: firestoreValue('open'), resolvedBy: firestoreValue(''), resolvedAt: firestoreValue('') };
        await firestoreRequest('/messages/' + encodeURIComponent(id) + '?updateMask.fieldPaths=status&updateMask.fieldPaths=resolvedBy&updateMask.fieldPaths=resolvedAt', {
          method: 'PATCH',
          body: JSON.stringify({ fields })
        });
        socket.server.emit('message-resolved-updated', {
          id, status: nextStatus, resolvedBy: nextStatus === 'resolved' ? username : '', resolvedAt: nextStatus === 'resolved' ? fields.resolvedAt.stringValue : ''
        });
        if (typeof ack === 'function') ack({ ok: true, status: nextStatus });
      } catch (error) {
        console.error('Firestore resolve update failed:', error);
        if (typeof ack === 'function') ack({ ok: false, reason: 'server-error' });
      }
    });

    socket.on('toggle-help', async (payload = {}, ack) => {
      const username = usernameBySocketId.get(socket.id);
      const id = typeof payload.id === 'string' ? payload.id.trim() : '';
      if (!username || !id) return typeof ack === 'function' && ack({ ok: false, reason: 'unauthorized' });
      try { const result = await toggleHelper(id, username); if (result.ok) socket.server.emit('map-pin-help-updated', { id, helpUsers: result.helpUsers, count: result.count, helpConfirmedUsers: result.helpConfirmedUsers || [] }); if (typeof ack === 'function') ack(result); }
      catch (error) { console.error('Firestore helper update failed:', error); if (typeof ack === 'function') ack({ ok: false, reason: 'server-error' }); }
    });

    const originalSocketEmit = socket.emit.bind(socket);
    socket.emit = (socketEventName, ...args) => {
      if (socketEventName === 'username-accepted' && args[0]?.username) {
        usernameBySocketId.set(socket.id, String(args[0].username));
        if (args[0]?.isAdmin === true) adminBySocketId.set(socket.id, true); else adminBySocketId.delete(socket.id);
        const accepted = originalSocketEmit(socketEventName, ...args);
        historyCursorBySocketId.set(socket.id, '');
        originalSocketEmit('chat-history-start');
        void (async () => {
          try {
            const page = await loadMessagePage('', RECENT_HISTORY_PAGE_SIZE);
            historyCursorBySocketId.set(socket.id, page.nextPageToken);
            originalSocketEmit('chat-history', page.messages.map(message => ({
              ...message,
              timestamp: new Date(message.createdAt).toLocaleTimeString('ja-JP')
            })));
            originalSocketEmit('chat-history-meta', { hasMore: Boolean(page.nextPageToken) });
          } catch (error) {
            console.error('Firestore history load failed:', error);
            originalSocketEmit('chat-history-meta', { hasMore: false });
          } finally {
            originalSocketEmit('chat-history-end');
          }
        })();
        return accepted;
      }
      if (socketEventName === 'disconnect') {
        usernameBySocketId.delete(socket.id);
        historyCursorBySocketId.delete(socket.id);
        adminBySocketId.delete(socket.id);
      }
      return originalSocketEmit(socketEventName, ...args);
    };
    return listener(socket, ...rest);
  };
  return originalServerOn.call(this, eventName, wrappedListener);
};




export async function clearAllMessages() {
  if (!enabled) return { ok: false, reason: 'disabled', deleted: 0 };
  let deleted = 0;

  // ページを削除しながらページトークンを進めると、削除によって
  // 次ページの位置がずれて一部の投稿が残る可能性があるため、
  // 常に先頭ページを取り直して全件がなくなるまで削除します。
  while (true) {
    const params = new URLSearchParams({ pageSize: '300' });
    const result = await firestoreRequest('/messages?' + params.toString(), { method: 'GET' });
    const documents = Array.isArray(result?.documents) ? result.documents : [];
    if (!documents.length) break;

    for (const document of documents) {
      const name = String(document?.name || '');
      if (!name) continue;
      const idPath = name.split('/documents/').pop();
      if (!idPath) continue;
      await firestoreRequest('/' + idPath.split('/').map(encodeURIComponent).join('/'), { method: 'DELETE' });
      deleted += 1;
    }
  }

  recentMessageHistoryCache = null;
  recentMessageHistoryPromise = null;
  let deletedMedia = 0;
  try {
    deletedMedia = await clearAllMediaAssets();
  } catch (error) {
    console.error('[firebase] clear all media assets failed:', error);
  }
  console.log(`[firebase] cleared all saved messages: ${deleted}, media assets: ${deletedMedia}`);
  return { ok: true, deleted };
}

// サーバー起動直後から直近履歴を準備して、ログイン時の待ち時間を減らします。
void warmRecentMessageHistory();

export const firebasePersistenceEnabled = enabled;
export { loadMediaAsset, saveMediaAsset, deleteMediaAsset, clearAllMediaAssets };
