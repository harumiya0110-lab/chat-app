import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server as SocketIOServer } from 'socket.io';
import { GoogleGenAI, Type } from '@google/genai';
import { claimAccountName, releaseAccountName, isAccountNameAvailable } from './firebase-persistence.mjs';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 40 * 1024 * 1024
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const eventTypes = ['鳥獣目撃', '道路障害', '助け合い', 'イベント', 'その他'];
const PORT = Number(process.env.PORT) || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.7-flash';
const NOMINATIM_USER_AGENT = process.env.NOMINATIM_USER_AGENT || 'inaka-power-chat-map/1.0';

const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/account-name/claim', async (req, res) => {
  const { accountName, uid, email } = req.body || {};
  const cleanName = typeof accountName === 'string' ? accountName.trim().slice(0, 20) : '';
  const cleanUid = typeof uid === 'string' ? uid.trim() : '';
  const cleanEmail = typeof email === 'string' ? email.trim().slice(0, 320) : '';
  if (!cleanName || !cleanUid) return res.status(400).json({ ok: false, reason: 'invalid' });
  try {
    const result = await claimAccountName(cleanName, cleanUid, cleanEmail);
    if (!result.ok && result.reason === 'name-taken') return res.status(409).json(result);
    if (!result.ok) return res.status(503).json(result);
    return res.json(result);
  } catch (error) {
    console.error('Account-name claim failed:', error);
    return res.status(500).json({ ok: false, reason: 'server-error' });
  }
});

app.get('/api/account-name/check', async (req, res) => {
  const accountName = typeof req.query.name === 'string' ? req.query.name.trim().slice(0, 20) : '';
  if (!accountName) return res.status(400).json({ ok: false, available: false, reason: 'invalid' });
  try {
    return res.json(await isAccountNameAvailable(accountName));
  } catch (error) {
    console.error('Account-name availability check failed:', error);
    return res.status(500).json({ ok: false, available: false, reason: 'server-error' });
  }
});

app.post('/api/account-name/release', async (req, res) => {
  const { accountName, uid } = req.body || {};
  const cleanName = typeof accountName === 'string' ? accountName.trim().slice(0, 20) : '';
  const cleanUid = typeof uid === 'string' ? uid.trim() : '';
  if (!cleanName || !cleanUid) return res.status(400).json({ ok: false, reason: 'invalid' });
  try {
    return res.json(await releaseAccountName(cleanName, cleanUid));
  } catch (error) {
    console.error('Account-name release failed:', error);
    return res.status(500).json({ ok: false, reason: 'server-error' });
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
  return String(value || '').replace(/[「」『』]/g, '').replace(/\s+/g, ' ').replace(/(付近|周辺|あたり|辺り|近く|近辺|付近で|周辺で|あたりで|近くで)$/u, '').trim().slice(0, 200);
}

function extractLocationCandidatesFromText(text) {
  const candidates = [];
  const patterns = [
    /([一-龯ぁ-んァ-ヶA-Za-z0-9０-９]+(?:都|道|府|県|市|区|町|村|郡))/gu,
    /([一-龯ぁ-んァ-ヶA-Za-z0-9０-９]+(?:駅|公園|橋|学校|公民館|役所|市役所|区役所|町役場|村役場|病院|神社|寺|港|川|山|峠|交差点))/gu
  ];
  for (const pattern of patterns) {
    for (const match of String(text || '').matchAll(pattern)) {
      const value = normalizeLocationQuery(match[1]);
      if (value.length >= 2 && !candidates.includes(value)) candidates.push(value);
    }
  }
  return candidates.slice(0, 10);
}

function buildGeocodingCandidates(locationName, locationCandidates, originalText) {
  const candidates = [];
  const add = value => {
    const normalized = normalizeLocationQuery(value);
    if (normalized.length >= 2 && !candidates.includes(normalized)) candidates.push(normalized);
  };
  add(locationName);
  for (const candidate of locationCandidates || []) add(candidate);
  for (const candidate of extractLocationCandidatesFromText(originalText)) add(candidate);
  const adminAreas = extractLocationCandidatesFromText(originalText).filter(value => /(都|道|府|県|市|区|町|村)$/u.test(value));
  if (locationName && adminAreas.length) for (const area of adminAreas.slice(0, 3)) add(`${area} ${locationName}`);
  return candidates.slice(0, 12);
}

async function geocodeLocation(locationName, locationCandidates = [], originalText = '') {
  const queries = buildGeocodingCandidates(locationName, locationCandidates, originalText);
  if (!queries.length) return null;
  for (const query of queries) {
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
      console.log(`Location matched: query="${query}" -> "${best.display_name}"`);
      return { lat, lng, matchedQuery: query, displayName: best.display_name || query };
    } catch (error) { console.error(`Nominatim query error: query=${query}`, error); }
  }
  return null;
}

async function analyzeMessage(text) {
  if (!GEMINI_API_KEY || !ai) throw new Error('GEMINI_API_KEYが設定されていません');
  const systemPrompt = `あなたは地域情報チャットの解析AIです。\nユーザーのメッセージから、地図表示に必要な場所情報とイベント種別を抽出します。\n必ず指定されたJSON形式で返してください。\n場所は推測せず、メッセージに書かれている地名・施設名をできるだけそのまま保持してください。`;
  const userPrompt = `次のメッセージを解析してください。\n\nルール:\n- 場所を文章から明確に特定できる場合だけ hasLocation を true にする。\n- 場所を推測・創作しない。\n- locationName は、メッセージに明記された地名・施設名を優先する。\n- 「○○付近」「○○の近く」「○○周辺」は、位置を表す部分の名前だけをlocationNameにする。\n- locationCandidatesには、同じ場所を表す別表記や、検索に使えそうな短い候補を最大5個入れる。\n- 都道府県・市区町村・町名・施設名など、メッセージ中に書かれている情報を省略しすぎない。\n- 元メッセージだけでは行政区が分からない場合は、勝手に自治体を補わない。\n- eventType は「鳥獣目撃」「道路障害」「助け合い」「イベント」「その他」のいずれかにする。\n- 場所がない場合は hasLocation=false、locationName=""、locationCandidates=[] にする。\n- summary は短い日本語にする。\n\nメッセージ:\n${text}`;
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
  const { text, userId } = req.body || {};
  if (typeof text !== 'string' || !text.trim() || text.length > 2000 || typeof userId !== 'string' || !userId.trim()) return res.status(400).json({ error: 'text（1〜2000文字）とuserIdは必須です' });
  const cleanText = text.trim();
  const cleanUserId = userId.trim().slice(0, 200);
  try {
    const analysis = await analyzeMessage(cleanText);
    let locationData = null;
    let geocodeError = null;
    if (analysis.hasLocation) {
      try {
        const coordinates = await geocodeLocation(analysis.locationName, analysis.locationCandidates, cleanText);
        if (coordinates) locationData = { lat: coordinates.lat, lng: coordinates.lng, eventType: analysis.eventType, summary: analysis.summary, locationName: analysis.locationName, matchedLocation: coordinates.displayName, matchedQuery: coordinates.matchedQuery };
        else geocodeError = '場所を地図上で特定できませんでした';
      } catch (error) { console.error('ジオコーディング失敗:', error); geocodeError = '地図検索サービスに接続できませんでした'; }
    }
    const message = { text: cleanText, userId: cleanUserId, createdAt: new Date().toISOString(), locationData };
    io.emit('receive-message', { username: cleanUserId, message: cleanText, timestamp: new Date().toLocaleTimeString('ja-JP'), userId: cleanUserId, locationData });
    return res.json({ ...message, analysis, geocodeError });
  } catch (error) {
    console.error('メッセージ解析に失敗しました:', error);
    return res.status(502).json({ error: 'メッセージのAI解析に失敗しました。しばらくしてから再試行してください。' });
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
  socket.on('set-username', username => {
    if (typeof username !== 'string' || !username.trim()) return;
    const cleanUsername = username.trim().slice(0, 50);
    const isTaken = Object.values(users).some(u => u.username?.toLowerCase() === cleanUsername.toLowerCase());
    if (isTaken) {
      socket.emit('username-error', { message: 'この名前は既に使用されています。別の名前を選んでください。' });
      return;
    }
    users[socket.id] = { id: socket.id, username: cleanUsername, timestamp: new Date() };
    socket.emit('username-accepted', { username: cleanUsername });
    io.emit('user-joined', { username: cleanUsername, message: `${cleanUsername}さんがチャットに参加しました` });
    io.emit('update-users', Object.values(users));
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
    io.emit('receive-video', {
      username: user.username,
      video: bytes,
      videoType,
      filename: typeof data.filename === 'string' ? data.filename.slice(0, 200) : null,
      timestamp: new Date().toLocaleTimeString('ja-JP'),
      userId: socket.id
    });

    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('send-audio', (data, ack) => {
    const user = users[socket.id];
    if (!user) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'unauthorized' });
      return;
    }

    const bytes = toAudioBuffer(data?.audio);
    if (!bytes) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'invalid-format' });
      return;
    }

    const MAX_AUDIO_SIZE = 8 * 1024 * 1024;
    if (bytes.length > MAX_AUDIO_SIZE) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'too-large' });
      return;
    }

    const audioType = safeAudioMime(data?.audioType);
    io.emit('receive-audio', {
      username: user.username,
      audio: bytes,
      audioType,
      filename: typeof data.filename === 'string' ? data.filename.slice(0, 200) : 'voice-message.webm',
      durationMs: Number.isFinite(Number(data.durationMs)) ? Math.min(180000, Math.max(0, Number(data.durationMs))) : null,
      timestamp: new Date().toLocaleTimeString('ja-JP'),
      userId: socket.id
    });

    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('send-message', data => {
    const user = users[socket.id];
    if (user && typeof data?.message === 'string' && data.message.trim()) io.emit('receive-message', { username: user.username, message: data.message.trim(), timestamp: new Date().toLocaleTimeString('ja-JP'), userId: socket.id, locationData: null });
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