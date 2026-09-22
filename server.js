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
import { registerChatBackgroundPersistence } from './chat-background-persistence.mjs';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 40 * 1024 * 1024
});
registerThemePersistence(io);
registerChatBackgroundPersistence(io);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const eventTypes = ['鳥獣目撃', '道路障害', '交通障害', '助け合い', 'イベント', 'その他'];
const PORT = Number(process.env.PORT) || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.7-flash';
const NOMINATIM_USER_AGENT = process.env.NOMINATIM_USER_AGENT || 'inaka-power-chat-map/1.0';
const geocodeCache = new Map();
const GEOCODE_CACHE_TTL = 10 * 60 * 1000;

const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
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

app.post('/api/messages', async (req, res) => {
  const { text, userId, replyToId, replyToUsername } = req.body || {};
  if (typeof text !== 'string' || !text.trim() || text.length > 2000 || typeof userId !== 'string' || !userId.trim()) return res.status(400).json({ error: 'text（1〜2000文字）とuserIdは必須です' });
  const cleanText = text.trim();
  const cleanUserId = userId.trim().slice(0, 200);
  try {
    let analysis;
    let aiError = null;
    try {
      analysis = await analyzeMessage(cleanText);
    } catch (error) {
      aiError = error;
      console.error('AI解析に失敗したため簡易解析へ切り替えます:', error);
      analysis = fallbackAnalyzeMessage(cleanText);
    }
    let locationData = null;
    let geocodeError = null;
    if (analysis.hasLocation) {
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
      replyToId: typeof replyToId === 'string' ? replyToId.trim().slice(0, 120) : '',
      replyToUsername: typeof replyToUsername === 'string' ? replyToUsername.trim().slice(0, 50) : ''
    };
    io.emit('receive-message', {
      id: message.id,
      username: cleanUserId,
      message: cleanText,
      timestamp: new Date().toLocaleTimeString('ja-JP'),
      userId: cleanUserId,
      locationData,
      replyToId: message.replyToId,
      replyToUsername: message.replyToUsername
    });
    return res.json({ ...message, analysis, geocodeError, aiFallback: Boolean(aiError) });
  } catch (error) {
    console.error('メッセージ処理に失敗しました:', error);
    return res.status(500).json({ error: '投稿処理に失敗しました。しばらくしてから再試行してください。' });
  }
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
  // 名前だけで参加するゲスト方式です。メールアドレス認証は使用しません。
  socket.on('set-username', async username => {
    if (typeof username !== 'string' || !username.trim()) return;
    const cleanUsername = username.normalize('NFC').trim().slice(0, 50);

    // 「ハル」だけはアップデート移行時の名前競合による参加制限を解除します。
    // メールアカウントとゲスト参加は別管理のため、他の名前の制限や認証方式には影響しません。
    const isHaru = cleanUsername === 'ハル';
    const isTaken = Object.values(users).some(u =>
      u.authType === 'guest' &&
      u.username?.normalize('NFC').toLowerCase() === cleanUsername.toLowerCase()
    );
    if (isTaken && !isHaru) {
      socket.emit('username-error', { message: 'この名前は既にゲストとして使用されています。別の名前を選んでください。' });
      return;
    }

    users[socket.id] = {
      id: socket.id,
      username: cleanUsername,
      timestamp: new Date(),
      authType: 'guest'
    };
    socket.emit('username-accepted', { username: cleanUsername });
    void initializeThemeForSocket(socket, cleanUsername);
    io.emit('user-joined', { username: cleanUsername, message: `${cleanUsername}さんがチャットに参加しました` });
    io.emit('update-users', Object.values(users));
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

    const locationData = {
      lat,
      lng,
      eventType,
      summary: message.slice(0, 100),
      locationName: '地図で選択した地点',
      matchedLocation: 'ユーザーが地図上で選択',
      matchedQuery: 'manual-map-selection'
    };

    socket.server.emit('receive-message', {
      id: randomUUID(),
      username: user.username,
      message,
      timestamp: new Date().toLocaleTimeString('ja-JP'),
      userId: socket.id,
      locationData,
      replyToId,
      replyToUsername
    });

    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('send-image', data => {
    const user = users[socket.id];
    if (user && data?.image) io.emit('receive-image', { username: user.username, image: data.image, filename: data.filename || null, timestamp: new Date().toLocaleTimeString('ja-JP'), userId: socket.id });
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
    io.emit('receive-message', {
      id: randomUUID(),
      username: user.username,
      message,
      timestamp: new Date().toLocaleTimeString('ja-JP'),
      userId: socket.id,
      locationData: null,
      replyToId,
      replyToUsername
    });
  });

  socket.on('call-offer', payload => {
    const { targetId, offer } = payload || {};
    const caller = users[socket.id];
    if (targetId && offer && caller) io.to(targetId).emit('incoming-call', { from: socket.id, username: caller.username, offer });
  });
  socket.on('call-answer', payload => {
    const { targetId, answer } = payload || {};
    if (targetId && answer && users[socket.id]) io.to(targetId).emit('call-answered', { from: socket.id, answer });
  });
  socket.on('ice-candidate', payload => {
    const { targetId, candidate } = payload || {};
    if (targetId && candidate && users[socket.id]) io.to(targetId).emit('ice-candidate', { from: socket.id, candidate });
  });
  socket.on('call-reject', payload => { const targetId = payload?.targetId; if (targetId) io.to(targetId).emit('call-rejected', { from: socket.id }); });
  socket.on('end-call', payload => { const targetId = payload?.targetId; if (targetId) io.to(targetId).emit('call-ended', { from: socket.id }); });

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
