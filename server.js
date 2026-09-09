import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';
import { Server as SocketIOServer } from 'socket.io';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

const eventTypes = ['鳥獣目撃', '道路障害', '助け合い', 'イベント', 'その他'];
const PORT = Number(process.env.PORT) || 3000;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const NOMINATIM_USER_AGENT = process.env.NOMINATIM_USER_AGENT || 'inaka-power-chat-map/1.0';

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

function normalizeAnalysis(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('Geminiの解析結果が不正です');
  }

  const hasLocation = value.hasLocation === true;
  const locationName = typeof value.locationName === 'string'
    ? value.locationName.trim().slice(0, 200)
    : '';
  const eventType = eventTypes.includes(value.eventType)
    ? value.eventType
    : 'その他';
  const summary = typeof value.summary === 'string' && value.summary.trim()
    ? value.summary.trim().slice(0, 100)
    : '地域のお知らせ';

  return {
    hasLocation: hasLocation && Boolean(locationName),
    locationName,
    eventType,
    summary
  };
}

async function analyzeMessage(text) {
  if (!ai) {
    throw new Error('GEMINI_API_KEYが設定されていません');
  }

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: 'user',
        parts: [{
          text: `あなたは地域情報チャットの解析AIです。\n\n次のメッセージから、地図上に表示できる場所情報とイベント種別を抽出してください。\n- 場所を文章から明確に特定できる場合だけ hasLocation を true にする。\n- 場所を推測・創作しない。\n- locationName は、元メッセージに含まれる場所を都道府県・市町村などの行政区名と組み合わせ、Nominatimで検索しやすい具体的な名称にする。元メッセージだけでは行政区が分からない場合は、分かる範囲の名称を使い、勝手に自治体を補わない。\n- eventType は必ず「鳥獣目撃」「道路障害」「助け合い」「イベント」「その他」のいずれか。\n- summary は10文字程度の短い日本語要約。\n\nメッセージ:\n${text}`
        }]
      }
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          hasLocation: { type: Type.BOOLEAN },
          locationName: { type: Type.STRING },
          eventType: {
            type: Type.STRING,
            enum: eventTypes
          },
          summary: { type: Type.STRING }
        },
        required: ['hasLocation', 'locationName', 'eventType', 'summary']
      }
    }
  });

  if (!response.text) {
    throw new Error('Geminiから空の解析結果が返されました');
  }

  let parsed;
  try {
    parsed = JSON.parse(response.text);
  } catch (error) {
    throw new Error(`GeminiのJSON解析に失敗しました: ${error.message}`);
  }

  return normalizeAnalysis(parsed);
}

async function geocodeLocation(locationName) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', locationName);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('accept-language', 'ja');

  const response = await fetch(url, {
    headers: {
      'User-Agent': NOMINATIM_USER_AGENT,
      'Accept': 'application/json'
    },
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error(`Nominatim API error: ${response.status}`);
  }

  const results = await response.json();
  const first = Array.isArray(results) ? results[0] : null;
  if (!first) return null;

  const lat = Number(first.lat);
  const lng = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return { lat, lng };
}

app.post('/api/messages', async (req, res) => {
  const { text, userId } = req.body || {};

  if (
    typeof text !== 'string' ||
    !text.trim() ||
    text.length > 2000 ||
    typeof userId !== 'string' ||
    !userId.trim()
  ) {
    return res.status(400).json({
      error: 'text（1〜2000文字）とuserIdは必須です'
    });
  }

  const cleanText = text.trim();
  const cleanUserId = userId.trim().slice(0, 200);

  try {
    const analysis = await analyzeMessage(cleanText);
    let locationData = null;
    let geocodeError = null;

    if (analysis.hasLocation) {
      try {
        const coordinates = await geocodeLocation(analysis.locationName);
        if (coordinates) {
          locationData = {
            ...coordinates,
            eventType: analysis.eventType,
            summary: analysis.summary,
            locationName: analysis.locationName
          };
        } else {
          geocodeError = '場所を地図上で特定できませんでした';
        }
      } catch (error) {
        console.error('ジオコーディング失敗:', error);
        geocodeError = '地図検索サービスに接続できませんでした';
      }
    }

    const message = {
      text: cleanText,
      userId: cleanUserId,
      createdAt: new Date().toISOString(),
      locationData
    };

    io.emit('receive-message', {
      username: cleanUserId,
      message: cleanText,
      timestamp: new Date().toLocaleTimeString('ja-JP'),
      userId: cleanUserId,
      locationData
    });

    return res.json({
      ...message,
      analysis,
      geocodeError
    });
  } catch (error) {
    console.error('メッセージ解析に失敗しました:', error);
    return res.status(502).json({
      error: 'メッセージのAI解析に失敗しました。しばらくしてから再試行してください。'
    });
  }
});

const users = {};

io.on('connection', (socket) => {
  console.log(`新しいユーザーが接続しました: ${socket.id}`);

  socket.on('set-username', (username) => {
    if (typeof username !== 'string' || !username.trim()) return;

    const cleanUsername = username.trim().slice(0, 50);
    const isTaken = Object.values(users).some(
      (u) => u.username?.toLowerCase() === cleanUsername.toLowerCase()
    );

    if (isTaken) {
      socket.emit('username-error', {
        message: 'この名前は既に使用されています。別の名前を選んでください。'
      });
      return;
    }

    users[socket.id] = {
      id: socket.id,
      username: cleanUsername,
      timestamp: new Date()
    };

    socket.emit('username-accepted', { username: cleanUsername });
    io.emit('user-joined', {
      username: cleanUsername,
      message: `${cleanUsername}さんがチャットに参加しました`
    });
    io.emit('update-users', Object.values(users));
  });

  socket.on('send-image', (data) => {
    const user = users[socket.id];
    if (user && data?.image) {
      io.emit('receive-image', {
        username: user.username,
        image: data.image,
        filename: data.filename || null,
        timestamp: new Date().toLocaleTimeString('ja-JP'),
        userId: socket.id
      });
    }
  });

  socket.on('send-video', (data) => {
    const user = users[socket.id];
    if (user && data?.video) {
      io.emit('receive-video', {
        username: user.username,
        video: data.video,
        filename: data.filename || null,
        timestamp: new Date().toLocaleTimeString('ja-JP'),
        userId: socket.id
      });
    }
  });

  socket.on('send-message', (data) => {
    const user = users[socket.id];
    if (user && typeof data?.message === 'string' && data.message.trim()) {
      io.emit('receive-message', {
        username: user.username,
        message: data.message.trim(),
        timestamp: new Date().toLocaleTimeString('ja-JP'),
        userId: socket.id,
        locationData: null
      });
    }
  });

  socket.on('call-offer', (payload) => {
    const { targetId, offer } = payload || {};
    const caller = users[socket.id];
    if (targetId && offer && caller) {
      io.to(targetId).emit('incoming-call', {
        from: socket.id,
        username: caller.username,
        offer
      });
    }
  });

  socket.on('call-answer', (payload) => {
    const { targetId, answer } = payload || {};
    if (targetId && answer) {
      io.to(targetId).emit('call-answered', { from: socket.id, answer });
    }
  });

  socket.on('ice-candidate', (payload) => {
    const { targetId, candidate } = payload || {};
    if (targetId && candidate) {
      io.to(targetId).emit('ice-candidate', {
        from: socket.id,
        candidate
      });
    }
  });

  socket.on('end-call', (payload) => {
    const { targetId } = payload || {};
    if (targetId) {
      io.to(targetId).emit('call-ended', { from: socket.id });
    }
  });

  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (!user) return;

    console.log(`ユーザーが切断しました: ${user.username}`);
    io.emit('user-left', {
      username: user.username,
      message: `${user.username}さんがチャットから退出しました`
    });

    delete users[socket.id];
    io.emit('update-users', Object.values(users));
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`チャットサーバーがポート ${PORT} で起動しました`);
});
