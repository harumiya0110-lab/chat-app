import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server as SocketIOServer } from 'socket.io';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 20 * 1024 * 1024
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const eventTypes = ['鳥獣目撃', '道路障害', '助け合い', 'イベント', 'その他'];
const PORT = Number(process.env.PORT) || 3000;
const HF_TOKEN = process.env.HF_TOKEN;
const HF_MODEL = process.env.HF_MODEL || 'Qwen/Qwen3-32B:fastest';
const NOMINATIM_USER_AGENT = process.env.NOMINATIM_USER_AGENT || 'inaka-power-chat-map/1.0';

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

function normalizeAnalysis(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('Hugging Faceの解析結果が不正です');
  }

  const hasLocation = value.hasLocation === true;
  const locationName = typeof value.locationName === 'string'
    ? value.locationName.trim().slice(0, 200)
    : '';
  const locationCandidates = Array.isArray(value.locationCandidates)
    ? value.locationCandidates
        .filter((item) => typeof item === 'string' && item.trim())
        .map((item) => item.trim().slice(0, 200))
        .slice(0, 5)
    : [];
  const eventType = eventTypes.includes(value.eventType)
    ? value.eventType
    : 'その他';
  const summary = typeof value.summary === 'string' && value.summary.trim()
    ? value.summary.trim().slice(0, 100)
    : '地域のお知らせ';

  return {
    hasLocation: hasLocation && Boolean(locationName),
    locationName,
    locationCandidates,
    eventType,
    summary
  };
}

function extractJson(text) {
  const cleaned = String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('JSONを抽出できませんでした');
  }
}

function normalizeLocationQuery(value) {
  return String(value || '')
    .replace(/[「」『』]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/(付近|周辺|あたり|辺り|近く|近辺|付近で|周辺で|あたりで|近くで)$/u, '')
    .trim()
    .slice(0, 200);
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
      if (value.length >= 2 && !candidates.includes(value)) {
        candidates.push(value);
      }
    }
  }

  return candidates.slice(0, 10);
}

function buildGeocodingCandidates(locationName, locationCandidates, originalText) {
  const candidates = [];
  const add = (value) => {
    const normalized = normalizeLocationQuery(value);
    if (normalized.length >= 2 && !candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  add(locationName);
  for (const candidate of locationCandidates || []) add(candidate);
  for (const candidate of extractLocationCandidatesFromText(originalText)) add(candidate);

  const adminAreas = extractLocationCandidatesFromText(originalText)
    .filter((value) => /(都|道|府|県|市|区|町|村)$/u.test(value));

  if (locationName && adminAreas.length) {
    for (const area of adminAreas.slice(0, 3)) add(`${area} ${locationName}`);
  }

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
      const response = await fetch(url, {
        headers: {
          'User-Agent': NOMINATIM_USER_AGENT,
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        console.error(`Nominatim query failed: ${response.status} query=${query}`);
        continue;
      }

      const results = await response.json();
      if (!Array.isArray(results) || !results.length) continue;

      const normalizedQuery = query.toLowerCase();
      const scored = results
        .map((result) => {
          const displayName = String(result.display_name || '').toLowerCase();
          const namedetails = Object.values(result.namedetails || {}).join(' ').toLowerCase();
          const combined = `${displayName} ${namedetails}`;
          let score = Number(result.importance || 0);
          if (combined.includes(normalizedQuery)) score += 1.5;
          for (const token of normalizedQuery.split(/\s+/u)) {
            if (token.length >= 2 && combined.includes(token)) score += 0.2;
          }
          return { result, score };
        })
        .sort((a, b) => b.score - a.score);

      const best = scored[0]?.result;
      if (!best) continue;

      const lat = Number(best.lat);
      const lng = Number(best.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      console.log(`Location matched: query="${query}" -> "${best.display_name}"`);
      return {
        lat,
        lng,
        matchedQuery: query,
        displayName: best.display_name || query
      };
    } catch (error) {
      console.error(`Nominatim query error: query=${query}`, error);
    }
  }

  return null;
}

async function analyzeMessage(text) {
  if (!HF_TOKEN) throw new Error('HF_TOKENが設定されていません');

  const systemPrompt = `あなたは地域情報チャットの解析AIです。
ユーザーのメッセージから、地図表示に必要な場所情報とイベント種別を抽出します。
JSON以外の文章は絶対に返さないでください。
場所は推測せず、メッセージに書かれている地名・施設名をできるだけそのまま保持してください。`;

  const userPrompt = `次のメッセージを解析してください。

JSONの形式:
{
  "hasLocation": trueまたはfalse,
  "locationName": "最も具体的な場所の名前",
  "locationCandidates": ["場所候補1", "場所候補2"],
  "eventType": "鳥獣目撃" または "道路障害" または "助け合い" または "イベント" または "その他",
  "summary": "10文字程度の短い日本語要約"
}

ルール:
- 場所を文章から明確に特定できる場合だけ hasLocation を true にする。
- 場所を推測・創作しない。
- locationName は、メッセージに明記された地名・施設名を優先する。
- 「○○付近」「○○の近く」「○○周辺」は、位置を表す部分の名前だけをlocationNameにする。
- locationCandidatesには、同じ場所を表す別表記や、検索に使えそうな短い候補を最大5個入れる。
- 都道府県・市区町村・町名・施設名など、メッセージ中に書かれている情報を省略しすぎない。
- 元メッセージだけでは行政区が分からない場合は、勝手に自治体を補わない。
- eventType は必ず5種類のいずれかにする。
- 場所がない場合は hasLocation=false、locationName=""、locationCandidates=[] にする。
- summary は短い日本語にする。

メッセージ:
${text}`;

  const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HF_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: HF_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 500,
      extra_body: { chat_template_kwargs: { enable_thinking: false } }
    }),
    signal: AbortSignal.timeout(30000)
  });

  const responseText = await response.text();
  if (!response.ok) {
    let detail = responseText.slice(0, 800);
    try {
      const errorJson = JSON.parse(responseText);
      detail = errorJson?.error?.message || errorJson?.error || detail;
    } catch {}
    const safeDetail = typeof detail === 'string' ? detail : JSON.stringify(detail);
    console.error(`Hugging Face request failed: status=${response.status}, model=${HF_MODEL}, detail=${safeDetail}`);
    throw new Error(`Hugging Face API error: ${response.status} ${safeDetail}`);
  }

  let data;
  try { data = JSON.parse(responseText); }
  catch { throw new Error('Hugging FaceのレスポンスがJSONではありません'); }

  const content = data?.choices?.[0]?.message?.content;
  const reasoning = data?.choices?.[0]?.message?.reasoning_content;
  const finishReason = data?.choices?.[0]?.finish_reason;
  console.log(`Hugging Face response: finish_reason=${finishReason}, content_length=${String(content || '').length}, reasoning_length=${String(reasoning || '').length}`);

  if (!content) throw new Error(`Hugging Faceから空の解析結果が返されました (finish_reason=${finishReason || 'unknown'})`);

  try { return normalizeAnalysis(extractJson(content)); }
  catch (error) { throw new Error(`Hugging FaceのJSON解析に失敗しました: ${error.message}`); }
}

app.post('/api/messages', async (req, res) => {
  const { text, userId } = req.body || {};
  if (typeof text !== 'string' || !text.trim() || text.length > 2000 || typeof userId !== 'string' || !userId.trim()) {
    return res.status(400).json({ error: 'text（1〜2000文字）とuserIdは必須です' });
  }
  const cleanText = text.trim();
  const cleanUserId = userId.trim().slice(0, 200);

  try {
    const analysis = await analyzeMessage(cleanText);
    let locationData = null;
    let geocodeError = null;
    if (analysis.hasLocation) {
      try {
        const coordinates = await geocodeLocation(analysis.locationName, analysis.locationCandidates, cleanText);
        if (coordinates) {
          locationData = {
            lat: coordinates.lat,
            lng: coordinates.lng,
            eventType: analysis.eventType,
            summary: analysis.summary,
            locationName: analysis.locationName,
            matchedLocation: coordinates.displayName,
            matchedQuery: coordinates.matchedQuery
          };
        } else geocodeError = '場所を地図上で特定できませんでした';
      } catch (error) {
        console.error('ジオコーディング失敗:', error);
        geocodeError = '地図検索サービスに接続できませんでした';
      }
    }

    const message = { text: cleanText, userId: cleanUserId, createdAt: new Date().toISOString(), locationData };
    io.emit('receive-message', {
      username: cleanUserId,
      message: cleanText,
      timestamp: new Date().toLocaleTimeString('ja-JP'),
      userId: cleanUserId,
      locationData
    });
    return res.json({ ...message, analysis, geocodeError });
  } catch (error) {
    console.error('メッセージ解析に失敗しました:', error);
    return res.status(502).json({ error: 'メッセージのAI解析に失敗しました。しばらくしてから再試行してください。' });
  }
});

const users = {};
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
    if (user && data?.image) {
      io.emit('receive-image', { username: user.username, image: data.image, filename: data.filename || null, timestamp: new Date().toLocaleTimeString('ja-JP'), userId: socket.id });
    }
  });

  socket.on('send-video', data => {
    const user = users[socket.id];
    if (user && data?.video) {
      io.emit('receive-video', { username: user.username, video: data.video, filename: data.filename || null, timestamp: new Date().toLocaleTimeString('ja-JP'), userId: socket.id });
    }
  });

  socket.on('send-message', data => {
    const user = users[socket.id];
    if (user && typeof data?.message === 'string' && data.message.trim()) {
      io.emit('receive-message', { username: user.username, message: data.message.trim(), timestamp: new Date().toLocaleTimeString('ja-JP'), userId: socket.id, locationData: null });
    }
  });

  socket.on('call-offer', payload => {
    const { targetId, offer } = payload || {};
    const caller = users[socket.id];
    if (targetId && offer && caller) io.to(targetId).emit('incoming-call', { from: socket.id, username: caller.username, offer });
  });
  socket.on('call-answer', payload => {
    const { targetId, answer } = payload || {};
    if (targetId && answer) io.to(targetId).emit('call-answered', { from: socket.id, answer });
  });
  socket.on('ice-candidate', payload => {
    const { targetId, candidate } = payload || {};
    if (targetId && candidate) io.to(targetId).emit('ice-candidate', { from: socket.id, candidate });
  });
  socket.on('end-call', payload => {
    const { targetId } = payload || {};
    if (targetId) io.to(targetId).emit('call-ended', { from: socket.id });
  });
  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (!user) return;
    console.log(`ユーザーが切断しました: ${user.username}`);
    io.emit('user-left', { username: user.username, message: `${user.username}さんがチャットから退出しました` });
    delete users[socket.id];
    io.emit('update-users', Object.values(users));
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`チャットサーバーがポート ${PORT} で起動しました`));
