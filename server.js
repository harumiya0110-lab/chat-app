import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';
import { GoogleGenAI, Type } from '@google/genai';
import { registerThemePersistence, initializeThemeForSocket } from './theme-persistence.mjs';
import { registerPointsHistory } from './points-history-persistence.mjs';
import { loadMediaAsset, saveMediaAsset } from './firebase-persistence.mjs';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 40 * 1024 * 1024
});
registerThemePersistence(io);
registerPointsHistory(io);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const eventTypes = ['鳥獣目撃', '道路障害', '交通障害', '助け合い', 'イベント', 'その他'];

function normalizeEventStartAt(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || hour > 23 || minute > 59) return '';
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day || probe.getUTCHours() !== hour || probe.getUTCMinutes() !== minute) return '';
  return raw;
}
const PORT = Number(process.env.PORT) || 3000;
// 「ハル」専用管理者パスワード。未設定の場合、ハルという名前は管理者として利用できません。
const HARU_ADMIN_PASSWORD = String(process.env.HARU_ADMIN_PASSWORD || '').trim();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.7-flash';
const NOMINATIM_USER_AGENT = process.env.NOMINATIM_USER_AGENT || 'inaka-power-chat-map/1.0';
const geocodeCache = new Map();
const GEOCODE_CACHE_TTL = 10 * 60 * 1000;

const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/reverse-geocode', async (req, res) => {
  const lat = Number(req.query?.lat);
  const lng = Number(req.query?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: '緯度・経度が正しくありません。' });
  }

  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lng));
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('accept-language', 'ja');

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': NOMINATIM_USER_AGENT,
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      return res.status(502).json({ error: '場所の検索に失敗しました。' });
    }

    const result = await response.json();
    const address = result?.address || {};
    const prefecture = String(address.state || address.province || '').trim();
    const city = String(
      address.city ||
      address.town ||
      address.village ||
      address.municipality ||
      ''
    ).trim();

    if (!prefecture && !city) {
      return res.status(404).json({ error: '都道府県・市区町村を特定できませんでした。' });
    }

    return res.json({
      prefecture,
      city,
      displayName: String(result?.display_name || '').trim()
    });
  } catch (error) {
    console.error('逆ジオコーディング失敗:', error);
    return res.status(502).json({ error: '場所の検索サービスに接続できませんでした。' });
  }
});

function normalizeAnalysis(value) {
  if (!value || typeof value !== 'object') throw new Error('Geminiの解析結果が不正です');
  const hasLocation = value.hasLocation === true;
  const locationName = typeof value.locationName === 'string' ? value.locationName.trim().slice(0, 200) : '';
  const locationCandidates = Array.isArray(value.locationCandidates)
    ? value.locationCandidates.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim().slice(0, 200)).slice(0, 5)
    : [];
  const eventType = eventTypes.includes(value.eventType) ? value.eventType : 'その他';
  const summary = typeof value.summary === 'string' && value.summary.trim() ? value.summary.trim().slice(0, 100) : '地域のお知らせ';
  return { hasLocation: hasLocation && Boolean(locationName), locationName, locationCandidates, eventType, summary };
}

function extractJson(text) {
  const cleaned = String(text || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(cleaned); }
  catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('JSONを抽出できませんでした');
  }
}

function normalizeLocationQuery(value) {
  return String(value || '')
    .replace(/[「」『』]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^(?:〒|郵便番号)\s*/u, '')
    .replace(/(付近|周辺|あたり|辺り|近く|近辺|付近で|周辺で|あたりで|近くで)$/u, '')
    .trim()
    .slice(0, 200);
}

function extractPostalCodeCandidates(text) {
  const candidates = [];
  const source = String(text || '').replace(/郵便\s*番号/gu, '').replace(/〒/gu, '');
  const patterns = [
    /(\d{3})[\s　]*[-ー－—―]?[\s　]*(\d{4})/gu,
    /(\d{3})[\s　]+(?:の|ー|－|-)?[\s　]*(\d{4})/gu
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const code = match[1] + '-' + match[2];
      if (!candidates.includes(code)) candidates.push(code);
    }
  }
  const compact = source.match(/(?:^|[^0-9])(\d{7})(?!\d)/u);
  if (compact) {
    const code = compact[1].slice(0, 3) + '-' + compact[1].slice(3);
    if (!candidates.includes(code)) candidates.push(code);
  }
  return candidates.slice(0, 5);
}

function extractLocationCandidatesFromText(text) {
  const candidates = [...extractPostalCodeCandidates(text)];
  const patterns = [
    /([一-龯ぁ-んァ-ヶA-Za-z0-9０-９]+(?:都|道|府|県|市|区|町|村|郡))/gu,
    /([一-龯ぁ-んァ-ヶA-Za-z0-9０-９]+(?:駅|公園|橋|学校|公民館|役所|市役所|区役所|町役場|村役場|病院|神社|寺|港|川|山|峠|交差点|耕地))/gu,
    /([一-龯ぁ-んァ-ヶA-Za-z0-9０-９]+(?:耕地))/gu
  ];
  for (const pattern of patterns) {
    for (const match of String(text || '').matchAll(pattern)) {
      const value = normalizeLocationQuery(match[1]);
      if (value.length >= 2 && !candidates.includes(value)) candidates.push(value);
    }
  }
  return candidates.slice(0, 12);
}

function buildGeocodingCandidates(locationName, locationCandidates, originalText) {
  const candidates = [];
  const add = value => {
    const normalized = normalizeLocationQuery(value);
    if (normalized.length >= 2 && !candidates.includes(normalized)) candidates.push(normalized);
  };
  const addPostalVariants = postalCode => {
    const normalized = String(postalCode || '').replace(/[^0-9]/g, '');
    if (normalized.length !== 7) return;
    add(normalized.slice(0, 3) + '-' + normalized.slice(3));
    add(normalized);
    add('〒' + normalized.slice(0, 3) + '-' + normalized.slice(3));
  };
  for (const candidate of extractPostalCodeCandidates(originalText)) addPostalVariants(candidate);
  add(locationName);
  for (const candidate of locationCandidates || []) {
    if (/^\d{3}-\d{4}$/u.test(String(candidate).trim())) addPostalVariants(candidate);
    else add(candidate);
  }
  for (const candidate of extractLocationCandidatesFromText(originalText)) {
    if (/^\d{3}-\d{4}$/u.test(candidate)) addPostalVariants(candidate);
    else add(candidate);
  }
  const allTextCandidates = extractLocationCandidatesFromText(originalText);
  const adminAreas = allTextCandidates.filter(value => /(都|道|府|県|市|区|町|村)$/u.test(value));
  const postalCodes = extractPostalCodeCandidates(originalText);
  if (locationName && adminAreas.length) {
    for (const area of adminAreas.slice(0, 3)) add(area + ' ' + locationName);
  }
  if (postalCodes.length && locationName && !/^\d{3}-\d{4}$/u.test(locationName)) {
    for (const code of postalCodes) add(code + ' ' + locationName);
  }
  return candidates.slice(0, 15);
}

async function geocodeLocation(locationName, locationCandidates = [], originalText = '') {
  const queries = buildGeocodingCandidates(locationName, locationCandidates, originalText).slice(0, 7);
  if (!queries.length) return null;
  const now = Date.now();
  for (const query of queries) {
    const cacheKey = normalizeLocationQuery(query).toLowerCase();
    const cached = geocodeCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.value;
    if (cached) geocodeCache.delete(cacheKey);
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '3');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('accept-language', 'ja');
    try {
      const response = await fetch(url, { headers: { 'User-Agent': NOMINATIM_USER_AGENT, 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) { console.error(`Nominatim query failed: ${response.status} query=${query}`); continue; }
      const results = await response.json();
      if (!Array.isArray(results) || !results.length) continue;
      const normalizedQuery = query.toLowerCase();
      const scored = results.map(result => {
        const displayName = String(result.display_name || '').toLowerCase();
        const namedetails = Object.values(result.namedetails || {}).join(' ').toLowerCase();
        const combined = `${displayName} ${namedetails}`;
        let score = Number(result.importance || 0);
        if (combined.includes(normalizedQuery)) score += 1.5;
        for (const token of normalizedQuery.split(/\s+/u)) if (token.length >= 2 && combined.includes(token)) score += 0.2;
        return { result, score };
      }).sort((a, b) => b.score - a.score);
      const best = scored[0]?.result;
      if (!best) continue;
      const lat = Number(best.lat);
      const lng = Number(best.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const value = { lat, lng, matchedQuery: query, displayName: best.display_name || query };
      geocodeCache.set(cacheKey, { value, expiresAt: now + GEOCODE_CACHE_TTL });
      if (geocodeCache.size > 500) geocodeCache.delete(geocodeCache.keys().next().value);
      console.log(`Location matched: query="${query}" -> "${best.display_name}"`);
      return value;
    } catch (error) { console.error(`Nominatim query error: query=${query}`, error); }
  }
  return null;
}

function fallbackAnalyzeMessage(text) {
  const source = String(text || '');
  const locationCandidates = extractLocationCandidatesFromText(source);
  const hasLocation = locationCandidates.length > 0;
  const eventType = /助け|手伝|困って|必要|募集/u.test(source) ? '助け合い'
    : /イベント|祭|祭り|開催|集会/u.test(source) ? 'イベント'
    : /イノシシ|鹿|シカ|猿|サル|熊|クマ|動物|鳥|目撃/u.test(source) ? '鳥獣目撃'
    : /通行|道路|倒木|落石|事故|渋滞|通れ|通行止め/u.test(source) ? '交通障害'
    : 'その他';
  return {
    hasLocation,
    locationName: locationCandidates[0] || '',
    locationCandidates: locationCandidates.slice(0, 5),
    eventType,
    summary: source.replace(/\s+/gu, ' ').trim().slice(0, 100) || '地域のお知らせ'
  };
}

async function analyzeMessage(text) {
  if (!GEMINI_API_KEY || !ai) throw new Error('GEMINI_API_KEYが設定されていません');
  const systemPrompt = `あなたは地域情報チャットの解析AIです。\nユーザーのメッセージから、地図表示に必要な場所情報とイベント種別を抽出します。\n必ず指定されたJSON形式で返してください。\n場所は推測せず、メッセージに書かれている地名・施設名をできるだけそのまま保持してください。`;
  const userPrompt = `次のメッセージを解析してください。\n\nルール:\n- 場所を文章から明確に特定できる場合だけ hasLocation を true にする。\n- 郵便番号が含まれている場合は、その郵便番号を場所情報として扱い、hasLocation=trueにする。\n- 「○○耕地」「○○一番耕地」などの表記が含まれている場合は、住所の一部として locationName または locationCandidates に保持する。\n- 場所を推測・創作しない。\n- locationName は、メッセージに明記された地名・施設名を優先する。\n- 「○○付近」「○○の近く」「○○周辺」は、位置を表す部分の名前だけをlocationNameにする。\n- locationCandidatesには、同じ場所を表す別表記や、検索に使えそうな短い候補を最大5個入れる。\n- 郵便番号が書かれている場合は、locationCandidatesに郵便番号をそのまま含める。郵便番号は「〒123-4567」「123-4567」「1234567」のどの表記でもよい。\n- 「○○耕地」のような日本の住所・町域に使われる「耕地」という地名表現も、場所として正しく扱う。\n- 都道府県・市区町村・町名・施設名など、メッセージ中に書かれている情報を省略しすぎない。\n- 元メッセージだけでは行政区が分からない場合は、勝手に自治体を補わない。\n- eventType は「鳥獣目撃」「道路障害」「助け合い」「イベント」「その他」のいずれかにする。\n- 場所がない場合は hasLocation=false、locationName=""、locationCandidates=[] にする。\n- summary は短い日本語にする。\n\nメッセージ:\n${text}`;
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          hasLocation: { type: Type.BOOLEAN },
          locationName: { type: Type.STRING },
          locationCandidates: { type: Type.ARRAY, items: { type: Type.STRING } },
          eventType: { type: Type.STRING, enum: eventTypes },
          summary: { type: Type.STRING }
        },
        required: ['hasLocation', 'locationName', 'locationCandidates', 'eventType', 'summary']
      },
      temperature: 0.1,
      maxOutputTokens: 500
    }
  });
  const content = response.text;
  if (!content) throw new Error('Geminiから空の解析結果が返されました');
  return normalizeAnalysis(extractJson(content));
}

const messageOwners = new Map();

const mediaStore = new Map();
const MEDIA_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_MEDIA_ITEMS = 250;
const MAX_MEDIA_TOTAL_BYTES = 300 * 1024 * 1024;
let trackedMediaBytes = 0;

function decodeDataUrl(value) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/i.exec(String(value || ''));
  if (!match) return null;
  try {
    return { mime: match[1].toLowerCase(), buffer: Buffer.from(match[2], 'base64') };
  } catch {
    return null;
  }
}

function safeImageMime(value) {
  return typeof value === 'string' && /^image\/(?:jpeg|png|webp)$/i.test(value) ? value.toLowerCase() : '';
}

function removeStoredMedia(id) {
  const key = String(id || '').trim();
  const entry = mediaStore.get(key);
  if (!entry) return;
  trackedMediaBytes = Math.max(0, trackedMediaBytes - Number(entry.bytes || 0));
  mediaStore.delete(key);
}

function pruneMediaStore() {
  const cutoff = Date.now() - MEDIA_TTL_MS;
  for (const [mediaId, entry] of mediaStore.entries()) {
    if (Number(entry.createdAt || 0) < cutoff) removeStoredMedia(mediaId);
  }
  while (mediaStore.size > MAX_MEDIA_ITEMS || trackedMediaBytes > MAX_MEDIA_TOTAL_BYTES) {
    const oldestId = mediaStore.keys().next().value;
    if (!oldestId) break;
    removeStoredMedia(oldestId);
  }
}

function storeMedia(entry) {
  pruneMediaStore();
  removeStoredMedia(entry.id);
  const bytes = Number(entry.bytes || entry.buffer?.length || 0);
  mediaStore.set(entry.id, { ...entry, bytes });
  trackedMediaBytes += bytes;
  pruneMediaStore();
}

function buildMediaMeta(entry) {
  return {
    id: entry.id,
    type: entry.type,
    filename: entry.filename || null,
    mimeType: entry.mimeType,
    mediaUrl: `/api/media/${encodeURIComponent(entry.id)}`,
    thumbnailUrl: entry.thumbnailBytes?.length ? `/api/media/${encodeURIComponent(entry.id)}/thumbnail` : '',
    size: Number(entry.bytes || 0),
    durationSec: Number.isFinite(Number(entry.durationSec)) ? Number(entry.durationSec) : 0
  };
}

app.get('/api/media/:id/thumbnail', async (req, res) => {
  pruneMediaStore();
  const id = String(req.params?.id || '').trim();
  let entry = mediaStore.get(id);

  if (!entry?.thumbnailBytes?.length) {
    try {
      const persisted = await loadMediaAsset(id);
      if (persisted) {
        entry = persisted;
        storeMedia(entry);
      }
    } catch (error) {
      console.error('Firestore thumbnail load failed:', error);
    }
  }

  if (!entry || !entry.thumbnailBytes?.length) return res.status(404).json({ error: 'サムネイルが見つかりません。' });
  res.setHeader('Content-Type', entry.thumbnailMime || 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(entry.thumbnailBytes);
});

app.get('/api/media/:id', async (req, res) => {
  pruneMediaStore();
  const id = String(req.params?.id || '').trim();
  let entry = mediaStore.get(id);

  if (!entry?.buffer?.length) {
    try {
      const persisted = await loadMediaAsset(id);
      if (persisted) {
        entry = persisted;
        storeMedia(entry);
      }
    } catch (error) {
      console.error('Firestore media load failed:', error);
    }
  }

  if (!entry?.buffer?.length) return res.status(404).json({ error: 'メディアが見つかりません。Firestore上の保存データが存在しない可能性があります。' });
  res.setHeader('Content-Type', entry.mimeType);
  res.setHeader('Content-Length', String(entry.buffer.length));
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(entry.buffer);
});

app.post('/api/messages', async (req, res) => {
  const { text, userId, replyToId, replyToUsername, replyToText } = req.body || {};
  if (typeof text !== 'string' || !text.trim() || text.length > 2000 || typeof userId !== 'string' || !userId.trim()) return res.status(400).json({ error: 'text（1〜2000文字）とuserIdは必須です' });
  const cleanText = text.trim();
  const cleanUserId = userId.trim().slice(0, 200);
  const cleanReplyToId = typeof replyToId === 'string' ? replyToId.trim().slice(0, 120) : '';
  const cleanReplyToUsername = typeof replyToUsername === 'string' ? replyToUsername.trim().slice(0, 50) : '';
  const cleanReplyToText = typeof replyToText === 'string' ? replyToText.trim().slice(0, 200) : '';
  const isReply = Boolean(cleanReplyToId);
  try {
    let analysis = null;
    let aiError = null;

    // 返信は通常のコメント欄として扱い、場所らしい文字が含まれていても
    // AI解析・ジオコーディングを行わず、地図ピンを作らない。
    if (!isReply) {
      try {
        analysis = await analyzeMessage(cleanText);
      } catch (error) {
        aiError = error;
        console.error('AI解析に失敗したため簡易解析へ切り替えます:', error);
        analysis = fallbackAnalyzeMessage(cleanText);
      }
    }

    let locationData = null;
    let geocodeError = null;
    if (!isReply && analysis?.hasLocation) {
      try {
        const coordinates = await geocodeLocation(analysis.locationName, analysis.locationCandidates, cleanText);
        if (coordinates) locationData = { lat: coordinates.lat, lng: coordinates.lng, eventType: analysis.eventType, summary: analysis.summary, locationName: analysis.locationName, matchedLocation: coordinates.displayName, matchedQuery: coordinates.matchedQuery };
        else geocodeError = '場所を地図上で特定できませんでした';
      } catch (error) { console.error('ジオコーディング失敗:', error); geocodeError = '地図検索サービスに接続できませんでした'; }
    }
    const message = {
      text: cleanText,
      userId: cleanUserId,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      locationData,
      replyToId: cleanReplyToId,
      replyToUsername: cleanReplyToUsername,
      replyToText: cleanReplyToText
    };
    messageOwners.set(message.id, { socketId: cleanUserId });
    io.emit('receive-message', {
      id: message.id,
      username: cleanUserId,
      message: cleanText,
      timestamp: new Date().toLocaleTimeString('ja-JP'),
      userId: cleanUserId,
      locationData,
      replyToId: message.replyToId,
      replyToUsername: message.replyToUsername,
      replyToText: message.replyToText
    });
    return res.json({ ...message, analysis, geocodeError, aiFallback: Boolean(aiError), isReply });
  } catch (error) {
    console.error('メッセージ処理に失敗しました:', error);
    return res.status(500).json({ error: '投稿処理に失敗しました。しばらくしてから再試行してください。' });
  }
});


function findStoredMediaForMessage(messageId, ownerId) {
  const targetMessageId = String(messageId || '').trim();
  const targetOwnerId = String(ownerId || '').trim();
  if (!targetMessageId || !targetOwnerId) return null;

  for (const entry of mediaStore.values()) {
    if (
      String(entry?.messageId || '').trim() === targetMessageId &&
      String(entry?.ownerId || '').trim() === targetOwnerId
    ) {
      return entry;
    }
  }
  return null;
}

async function finalizeMediaUpload(entry, socketServer) {
  if (!entry) return null;

  // まずチャットへ共有し、Firestore保存はバックグラウンドで行います。
  entry.persistent = false;
  const media = buildMediaMeta(entry);
  media.persistent = false;
  socketServer.emit('message-media-attached', { messageId: entry.messageId, media });

  void saveMediaAsset(entry).then(persistent => {
    const latestEntry = mediaStore.get(entry.id);
    if (!latestEntry) return;
    latestEntry.persistent = persistent === true;
    const updatedMedia = buildMediaMeta(latestEntry);
    updatedMedia.persistent = latestEntry.persistent;
    socketServer.emit('message-media-attached', {
      messageId: latestEntry.messageId,
      media: updatedMedia
    });
    if (!latestEntry.persistent) {
      console.error('Firestore media save failed: persistence was not confirmed.');
    }
  }).catch(error => {
    console.error('Firestore media save failed:', error);
  });

  return media;
}

// Socket.IOの動画転送でブラウザやネットワーク側の制限に当たった場合でも、
// HTTP経由で動画を送れるようにします。
app.post('/api/messages/:messageId/media', async (req, res) => {
  const messageId = String(req.params?.messageId || '').trim();
  const ownerId = String(req.body?.userId || '').trim();
  const user = users[ownerId];
  const type = req.body?.type === 'video' ? 'video' : req.body?.type === 'image' ? 'image' : '';

  if (!user || !messageId || !ownerId || !type) {
    return res.status(401).json({ ok: false, reason: 'unauthorized' });
  }

  const owner = messageOwners.get(messageId);
  if (!owner || owner.socketId !== ownerId) {
    return res.status(403).json({ ok: false, reason: 'not-owner' });
  }

  const existing = findStoredMediaForMessage(messageId, ownerId);
  if (existing) {
    const media = buildMediaMeta(existing);
    media.persistent = existing.persistent === true;
    return res.json({ ok: true, messageId, media, alreadyStored: true });
  }

  const filename = typeof req.body?.filename === 'string'
    ? req.body.filename.trim().slice(0, 200)
    : '';
  const durationSec = Math.max(0, Math.min(30, Number(req.body?.durationSec) || 0));

  const thumb = decodeDataUrl(req.body?.thumbnailDataUrl);
  if (thumb?.buffer?.length) {
    if (!/^image\/(?:jpeg|png|webp)$/i.test(thumb.mime)) {
      return res.status(400).json({ ok: false, reason: 'invalid-thumbnail' });
    }
    if (thumb.buffer.length > 300 * 1024) {
      return res.status(413).json({ ok: false, reason: 'thumbnail-too-large' });
    }
  }

  let buffer = null;
  let mimeType = '';

  if (type === 'image') {
    const parsed = decodeDataUrl(req.body?.dataUrl);
    mimeType = safeImageMime(parsed?.mime);
    buffer = parsed?.buffer || null;
    if (!buffer || !mimeType) {
      return res.status(400).json({ ok: false, reason: 'invalid-format' });
    }
    if (buffer.length > 2 * 1024 * 1024) {
      return res.status(413).json({ ok: false, reason: 'too-large' });
    }
  } else {
    const base64 = typeof req.body?.videoBase64 === 'string'
      ? req.body.videoBase64.replace(/^data:video\/[^;]+;base64,/i, '')
      : '';
    try {
      buffer = base64 ? Buffer.from(base64, 'base64') : null;
    } catch {
      buffer = null;
    }
    mimeType = safeVideoMime(req.body?.videoType);
    if (!buffer?.length || !mimeType) {
      return res.status(400).json({ ok: false, reason: 'invalid-format' });
    }
    if (buffer.length > 15 * 1024 * 1024) {
      return res.status(413).json({ ok: false, reason: 'too-large' });
    }
    if (durationSec > 30) {
      return res.status(400).json({ ok: false, reason: 'too-long' });
    }
  }

  const mediaId = `media-${randomUUID()}`;
  storeMedia({
    id: mediaId,
    messageId,
    ownerId,
    ownerUsername: user.username,
    type,
    filename,
    mimeType,
    buffer,
    thumbnailBytes: thumb?.buffer || null,
    thumbnailMime: thumb?.mime?.toLowerCase() || 'image/jpeg',
    durationSec,
    createdAt: Date.now(),
    bytes: buffer.length
  });

  const entry = mediaStore.get(mediaId);
  const media = await finalizeMediaUpload(entry, io);
  return res.json({ ok: true, messageId, media });
});


const users = {};

function toVideoBuffer(video) {
  if (Buffer.isBuffer(video)) return video;
  if (video instanceof ArrayBuffer) return Buffer.from(new Uint8Array(video));
  if (ArrayBuffer.isView(video)) return Buffer.from(video.buffer, video.byteOffset, video.byteLength);
  return null;
}

function safeVideoMime(value) {
  return typeof value === 'string' && /^video\/[a-z0-9.+-]+$/i.test(value) ? value : 'video/mp4';
}

function toAudioBuffer(audio) {
  if (Buffer.isBuffer(audio)) return audio;
  if (audio instanceof ArrayBuffer) return Buffer.from(new Uint8Array(audio));
  if (ArrayBuffer.isView(audio)) return Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
  return null;
}

function safeAudioMime(value) {
  return typeof value === 'string' && /^audio\/[a-z0-9.+-]+(?:;\s*codecs=[^;]+)?$/i.test(value) ? value : 'audio/webm';
}

io.on('connection', socket => {
  console.log(`新しいユーザーが接続しました: ${socket.id}`);
  // デプロイ後に接続し直したクライアントへ、投稿履歴をリセットする通知を送ります。
  socket.emit('chat-posts-cleared');
  // 名前だけで参加するゲスト方式です。メールアドレス認証は使用しません。
  socket.on('set-username', async (payload, ack) => {
    const fail = (reason, message) => {
      if (typeof ack === 'function') ack({ ok: false, reason, message });
    };

    const requestedUsername = typeof payload === 'string' ? payload : payload?.username;
    const adminPassword = typeof payload === 'object' && payload ? String(payload.password || '') : '';
    if (typeof requestedUsername !== 'string' || !requestedUsername.trim()) {
      fail('invalid', 'ニックネームを入力してください。');
      return;
    }

    const cleanUsername = requestedUsername.normalize('NFC').trim().slice(0, 50);
    const isHaru = cleanUsername === 'ハル';
    const isAdmin = isHaru && Boolean(HARU_ADMIN_PASSWORD) && adminPassword === HARU_ADMIN_PASSWORD;
    if (isHaru && !isAdmin) {
      const message = HARU_ADMIN_PASSWORD ? '「ハル」は管理者専用の名前です。管理者パスワードを入力してください。' : '管理者設定が未完了です。HARU_ADMIN_PASSWORDをサーバー環境変数に設定してください。';
      socket.emit('username-error', { message });
      fail('admin-required', message);
      return;
    }
    const isTaken = Object.values(users).some(u =>
      u.authType === 'guest' &&
      u.username?.normalize('NFC').toLowerCase() === cleanUsername.toLowerCase()
    );
    if (isTaken && !isHaru) {
      const message = 'この名前は既にゲストとして使用されています。別の名前を選んでください。';
      socket.emit('username-error', { message });
      fail('taken', message);
      return;
    }

    users[socket.id] = {
      id: socket.id,
      username: cleanUsername,
      timestamp: new Date(),
      authType: isAdmin ? 'admin' : 'guest',
      isAdmin
    };

    const onlineUsers = Object.values(users).map(user => ({
      id: user.id,
      username: user.username
    }));

    socket.emit('username-accepted', { username: cleanUsername, users: onlineUsers, isAdmin });
    socket.emit('update-users', onlineUsers);
    if (typeof ack === 'function') {
      ack({ ok: true, username: cleanUsername, users: onlineUsers, isAdmin });
    }

    void initializeThemeForSocket(socket, cleanUsername);
    io.emit('user-joined', { username: cleanUsername, message: `${cleanUsername}さんがチャットに参加しました` });
    io.emit('update-users', Object.values(users));
  });

  socket.on('get-online-users', (_payload, ack) => {
    const onlineUsers = Object.values(users).map(user => ({
      id: user.id,
      username: user.username
    }));
    if (typeof ack === 'function') ack({ ok: true, users: onlineUsers });
    else socket.emit('update-users', onlineUsers);
  });

  socket.on('send-location-message', (data, ack) => {
    const user = users[socket.id];
    if (!user) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'unauthorized', message: 'チャットに参加してから投稿してください。' });
      return;
    }

    const lat = Number(data?.lat);
    const lng = Number(data?.lng);
    const eventType = eventTypes.includes(data?.eventType) ? data.eventType : 'その他';
    const eventStartAt = eventType === 'イベント' ? normalizeEventStartAt(data?.eventStartAt) : '';
    const message = typeof data?.message === 'string' ? data.message.trim().slice(0, 2000) : '';
    const replyToId = typeof data?.replyToId === 'string' ? data.replyToId.trim().slice(0, 120) : '';
    const replyToUsername = typeof data?.replyToUsername === 'string' ? data.replyToUsername.trim().slice(0, 50) : '';

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'invalid-location', message: '選択した場所が正しくありません。' });
      return;
    }
    if (!message) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'empty-message', message: 'その場所で起きたことを入力してください。' });
      return;
    }
    if (eventType === 'イベント' && !eventStartAt) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'invalid-event-time', message: 'イベントの開催日時を正しく入力してください。' });
      return;
    }

    const locationData = {
      lat,
      lng,
      eventType,
      eventStartAt,
      summary: message.slice(0, 100),
      locationName: '地図で選択した地点',
      matchedLocation: 'ユーザーが地図上で選択',
      matchedQuery: 'manual-map-selection'
    };

    const locationMessageId = randomUUID();
    messageOwners.set(locationMessageId, { socketId: socket.id });
    socket.server.emit('receive-message', {
      id: locationMessageId,
      username: user.username,
      message,
      timestamp: new Date().toLocaleTimeString('ja-JP'),
      userId: socket.id,
      locationData,
      replyToId,
      replyToUsername
    });

    if (typeof ack === 'function') ack({ ok: true, messageId: locationMessageId });
  });


  socket.on('attach-media', async (data, ack) => {
    const user = users[socket.id];
    const messageId = typeof data?.messageId === 'string' ? data.messageId.trim() : '';
    const type = data?.type === 'video' ? 'video' : data?.type === 'image' ? 'image' : '';
    const owner = messageOwners.get(messageId);
    if (!user || !messageId || !type) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'invalid' });
      return;
    }
    if (!owner || owner.socketId !== socket.id) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'not-owner' });
      return;
    }

    const filename = typeof data?.filename === 'string' ? data.filename.trim().slice(0, 200) : '';
    const durationSec = Math.max(0, Math.min(30, Number(data?.durationSec) || 0));
    let buffer = null;
    let mimeType = '';
    let thumbnailBytes = null;
    let thumbnailMime = 'image/jpeg';

    if (type === 'image') {
      const parsed = decodeDataUrl(data?.dataUrl);
      mimeType = safeImageMime(parsed?.mime);
      buffer = parsed?.buffer || null;
      if (!buffer || !mimeType) {
        if (typeof ack === 'function') ack({ ok: false, reason: 'invalid-format' });
        return;
      }
      if (buffer.length > 2 * 1024 * 1024) {
        if (typeof ack === 'function') ack({ ok: false, reason: 'too-large' });
        return;
      }
    } else {
      buffer = Buffer.isBuffer(data?.video)
        ? data.video
        : data?.video instanceof ArrayBuffer
          ? Buffer.from(new Uint8Array(data.video))
          : ArrayBuffer.isView(data?.video)
            ? Buffer.from(data.video.buffer, data.video.byteOffset, data.video.byteLength)
            : null;
      mimeType = safeVideoMime(data?.videoType);
      if (!buffer || !mimeType) {
        if (typeof ack === 'function') ack({ ok: false, reason: 'invalid-format' });
        return;
      }
      if (buffer.length > 15 * 1024 * 1024) {
        if (typeof ack === 'function') ack({ ok: false, reason: 'too-large' });
        return;
      }
      if (durationSec > 30) {
        if (typeof ack === 'function') ack({ ok: false, reason: 'too-long' });
        return;
      }
    }

    const thumb = decodeDataUrl(data?.thumbnailDataUrl);
    if (thumb?.buffer?.length) {
      if (!/^image\/(?:jpeg|png|webp)$/i.test(thumb.mime)) {
        if (typeof ack === 'function') ack({ ok: false, reason: 'invalid-thumbnail' });
        return;
      }
      if (thumb.buffer.length > 300 * 1024) {
        if (typeof ack === 'function') ack({ ok: false, reason: 'thumbnail-too-large' });
        return;
      }
      thumbnailBytes = thumb.buffer;
      thumbnailMime = thumb.mime.toLowerCase();
    }

    const mediaId = `media-${randomUUID()}`;
    storeMedia({
      id: mediaId,
      messageId,
      ownerId: socket.id,
      ownerUsername: user.username,
      type,
      filename,
      mimeType,
      buffer,
      thumbnailBytes,
      thumbnailMime,
      durationSec,
      createdAt: Date.now(),
      bytes: buffer.length
    });

    const storedEntry = mediaStore.get(mediaId);
    if (!storedEntry) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'store-failed' });
      return;
    }

    // 動画はFirestoreへの保存に時間がかかることがあるため、
    // コメントを含む投稿を先にチャットへ表示し、永続保存はバックグラウンドで行います。
    // これにより「サムネイルは作れるのに、コメントと一緒に送れない」状態を防ぎます。
    storedEntry.persistent = false;
    const media = buildMediaMeta(storedEntry);
    media.persistent = false;
    socket.server.emit('message-media-attached', { messageId, media });
    if (typeof ack === 'function') ack({ ok: true, messageId, media });

    void saveMediaAsset(storedEntry).then(persistent => {
      const latestEntry = mediaStore.get(mediaId);
      if (!latestEntry) return;
      latestEntry.persistent = persistent === true;
      const updatedMedia = buildMediaMeta(latestEntry);
      updatedMedia.persistent = latestEntry.persistent;
      socket.server.emit('message-media-attached', { messageId, media: updatedMedia });
      if (!latestEntry.persistent) {
        console.error('Firestore media save failed: persistence was not confirmed.');
      }
    }).catch(error => {
      console.error('Firestore media save failed:', error);
      const latestEntry = mediaStore.get(mediaId);
      if (!latestEntry) return;
      latestEntry.persistent = false;
    });
  });

  socket.on('send-image', (data, ack) => {
    const user = users[socket.id];
    if (!user) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'unauthorized' });
      return;
    }

    const image = typeof data?.image === 'string' ? data.image : '';
    if (!image || !image.toLowerCase().startsWith('data:image/')) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'invalid-format' });
      return;
    }

    if (image.length > 17 * 1024 * 1024) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'too-large' });
      return;
    }

    io.emit('receive-image', {
      username: user.username,
      image,
      imageType: typeof data?.imageType === 'string' ? data.imageType.slice(0, 80) : 'image/jpeg',
      filename: typeof data?.filename === 'string' ? data.filename.slice(0, 200) : null,
      timestamp: new Date().toLocaleTimeString('ja-JP'),
      userId: socket.id
    });
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('send-video', (data, ack) => {
    const user = users[socket.id];
    if (!user) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'unauthorized' });
      return;
    }
    const bytes = toVideoBuffer(data?.video);
    if (!bytes) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'invalid-format' });
      return;
    }
    const MAX_VIDEO_SIZE = 15 * 1024 * 1024;
    if (bytes.length > MAX_VIDEO_SIZE) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'too-large' });
      return;
    }
    const videoType = safeVideoMime(data?.videoType);
    io.emit('receive-video', { username: user.username, video: bytes, videoType, filename: typeof data.filename === 'string' ? data.filename.slice(0, 200) : null, timestamp: new Date().toLocaleTimeString('ja-JP'), userId: socket.id });
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('send-message', data => {
    const user = users[socket.id];
    const message = typeof data?.message === 'string' ? data.message.trim().slice(0, 2000) : '';
    if (!user || !message) return;
    const replyToId = typeof data?.replyToId === 'string' ? data.replyToId.trim().slice(0, 120) : '';
    const replyToUsername = typeof data?.replyToUsername === 'string' ? data.replyToUsername.trim().slice(0, 50) : '';
    const replyToText = typeof data?.replyToText === 'string' ? data.replyToText.trim().slice(0, 200) : '';
    const normalMessageId = randomUUID();
    messageOwners.set(normalMessageId, { socketId: socket.id });
    io.emit('receive-message', {
      id: normalMessageId,
      username: user.username,
      message,
      timestamp: new Date().toLocaleTimeString('ja-JP'),
      userId: socket.id,
      locationData: null,
      replyToId,
      replyToUsername,
      replyToText
    });
  });

  socket.on('call-offer', (payload, ack) => {
    const targetId = typeof payload?.targetId === 'string' ? payload.targetId.trim() : '';
    const offer = payload?.offer;
    const caller = users[socket.id];
    if (!caller || !targetId || !offer) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'invalid' });
      return;
    }
    if (!users[targetId]) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'offline' });
      return;
    }
    io.to(targetId).emit('incoming-call', { from: socket.id, username: caller.username, offer });
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('call-answer', (payload, ack) => {
    const targetId = typeof payload?.targetId === 'string' ? payload.targetId.trim() : '';
    const answer = payload?.answer;
    if (!users[socket.id] || !targetId || !answer || !users[targetId]) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'offline' });
      return;
    }
    io.to(targetId).emit('call-answered', { from: socket.id, answer });
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('ice-candidate', (payload, ack) => {
    const targetId = typeof payload?.targetId === 'string' ? payload.targetId.trim() : '';
    const candidate = payload?.candidate;
    if (!users[socket.id] || !targetId || !candidate || !users[targetId]) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'offline' });
      return;
    }
    io.to(targetId).emit('ice-candidate', { from: socket.id, candidate });
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('camera-state', (payload, ack) => {
    const targetId = typeof payload?.targetId === 'string' ? payload.targetId.trim() : '';
    const enabled = payload?.enabled !== false;
    if (!users[socket.id] || !targetId || !users[targetId]) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'offline' });
      return;
    }
    io.to(targetId).emit('camera-state', { from: socket.id, enabled });
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('call-reject', (payload, ack) => {
    const targetId = typeof payload?.targetId === 'string' ? payload.targetId.trim() : '';
    if (targetId && users[targetId]) io.to(targetId).emit('call-rejected', { from: socket.id });
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('end-call', (payload, ack) => {
    const targetId = typeof payload?.targetId === 'string' ? payload.targetId.trim() : '';
    if (targetId && users[targetId]) io.to(targetId).emit('call-ended', { from: socket.id });
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (user) {
      delete users[socket.id];
      io.emit('user-left', { username: user.username, message: `${user.username}さんがチャットを退出しました` });
      io.emit('update-users', Object.values(users));
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
