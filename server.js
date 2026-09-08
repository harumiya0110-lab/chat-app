import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import { Server as SocketIOServer } from 'socket.io';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
const eventTypes = ['鳥獣目撃', '道路障害', '助け合い', 'イベント', 'その他'];

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

function parseGeminiResponse(response) {
  const text = response.text?.trim();
  if (!text) throw new Error('Geminiから空の解析結果が返されました');
  const parsed = JSON.parse(text);
  return {
    hasLocation: parsed.hasLocation === true && typeof parsed.locationName === 'string',
    locationName: typeof parsed.locationName === 'string' ? parsed.locationName.trim() : '',
    eventType: eventTypes.includes(parsed.eventType) ? parsed.eventType : 'その他',
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 100) : '地域のお知らせ'
  };
}

async function analyzeMessage(text) {
  if (!ai) throw new Error('GEMINI_API_KEYが設定されていません');
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    contents: `次の地域チャットメッセージを分析してください。場所が特定できる場合だけhasLocationをtrueにしてください。locationNameには都道府県・市町村を含む検索可能な具体的名称を入れてください。推測で場所を補わないでください。\n\nメッセージ: ${text}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          hasLocation: { type: 'boolean' },
          locationName: { type: 'string' },
          eventType: { type: 'string', enum: eventTypes },
          summary: { type: 'string' }
        },
        required: ['hasLocation', 'locationName', 'eventType', 'summary']
      }
    }
  });
  return parseGeminiResponse(response);
}

async function geocodeLocation(locationName) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', locationName);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  const response = await fetch(url, {
    headers: { 'User-Agent': process.env.NOMINATIM_USER_AGENT || 'inaka-power-chat-map/1.0 (contact@example.com)' }
  });
  if (!response.ok) throw new Error(`Nominatim API error: ${response.status}`);
  const firstResult = (await response.json())[0];
  if (!firstResult) return null;
  const lat = Number(firstResult.lat);
  const lng = Number(firstResult.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

app.post('/api/messages', async (req, res) => {
  const { text, userId } = req.body || {};
  if (typeof text !== 'string' || !text.trim() || text.length > 2000 || typeof userId !== 'string' || !userId.trim()) {
    return res.status(400).json({ error: 'text（1〜2000文字）とuserIdは必須です' });
  }
  try {
    const analysis = await analyzeMessage(text.trim());
    let locationData = null;
    if (analysis.hasLocation && analysis.locationName) {
      const coordinates = await geocodeLocation(analysis.locationName);
      if (coordinates) locationData = { ...coordinates, eventType: analysis.eventType, summary: analysis.summary, locationName: analysis.locationName };
    }
    const message = { text: text.trim(), userId: userId.trim(), createdAt: new Date().toISOString(), locationData };
    io.emit('receive-message', { username: userId.trim(), message: message.text, timestamp: new Date().toLocaleTimeString('ja-JP'), userId: message.userId, locationData });
    return res.json(message);
  } catch (error) {
    console.error('メッセージ解析に失敗しました:', error);
    return res.status(502).json({ error: 'メッセージの解析に失敗しました。しばらくしてから再試行してください。' });
  }
});

// ユーザー情報を保存
const users = {};

// WebSocket接続時の処理
io.on('connection', (socket) => {
  console.log('新しいユーザーが接続しました: ' + socket.id);

  // ユーザーがニックネームを設定
  socket.on('set-username', (username) => {
    // 重複チェック（大文字小文字を区別しない）
    const isTaken = Object.values(users).some(u => u.username && u.username.toLowerCase() === username.toLowerCase());
    if (isTaken) {
      socket.emit('username-error', { message: 'この名前は既に使用されています。別の名前を選んでください。' });
      return;
    }

    users[socket.id] = {
      id: socket.id,
      username: username,
      timestamp: new Date()
    };

    // クライアントに受理通知
    socket.emit('username-accepted', { username });

    // 他のユーザーに通知
    io.emit('user-joined', {
      username: username,
      message: `${username}さんがチャットに参加しました`
    });

    // オンラインユーザーリストを更新
    io.emit('update-users', Object.values(users));
  });

  // 画像メッセージの受信
  socket.on('send-image', (data) => {
    const user = users[socket.id];
    if (user && data && data.image) {
      const imageData = {
        username: user.username,
        image: data.image, // data URL
        filename: data.filename || null,
        timestamp: new Date().toLocaleTimeString('ja-JP'),
        userId: socket.id
      };
      io.emit('receive-image', imageData);
    }
  });

  // 動画メッセージの受信
  socket.on('send-video', (data) => {
    const user = users[socket.id];
    if (user && data && data.video) {
      const videoData = {
        username: user.username,
        video: data.video, // data URL
        filename: data.filename || null,
        timestamp: new Date().toLocaleTimeString('ja-JP'),
        userId: socket.id
      };
      io.emit('receive-video', videoData);
    }
  });

  // チャットメッセージの受信
  socket.on('send-message', (data) => {
    const user = users[socket.id];
    if (user) {
      const messageData = {
        username: user.username,
        message: data.message,
        timestamp: new Date().toLocaleTimeString('ja-JP'),
        userId: socket.id
      };
      
      // すべてのクライアントにメッセージを送信
      io.emit('receive-message', messageData);
    }
  });

  // WebRTC シグナリング: 発信側からのオファーを相手に転送
  socket.on('call-offer', (payload) => {
    const { targetId, offer } = payload || {};
    const caller = users[socket.id];
    if (targetId && offer && caller) {
      io.to(targetId).emit('incoming-call', { from: socket.id, username: caller.username, offer });
    }
  });

  // 相手からのアンサーを発信者に転送
  socket.on('call-answer', (payload) => {
    const { targetId, answer } = payload || {};
    if (targetId && answer) {
      io.to(targetId).emit('call-answered', { from: socket.id, answer });
    }
  });

  // ICE candidate を相手に転送
  socket.on('ice-candidate', (payload) => {
    const { targetId, candidate } = payload || {};
    if (targetId && candidate) {
      io.to(targetId).emit('ice-candidate', { from: socket.id, candidate });
    }
  });

  // 通話終了通知
  socket.on('end-call', (payload) => {
    const { targetId } = payload || {};
    if (targetId) {
      io.to(targetId).emit('call-ended', { from: socket.id });
    }
  });

  // ユーザーが切断したとき
  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (user) {
      console.log(`ユーザーが切断しました: ${user.username}`);
      
      io.emit('user-left', {
        username: user.username,
        message: `${user.username}さんがチャットから退出しました`
      });

      delete users[socket.id];
      io.emit('update-users', Object.values(users));
    }
  });
});

// サーバーの起動
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`チャットサーバーがポート ${PORT} で起動しました`);
  console.log(`ブラウザで http://localhost:${PORT} にアクセスしてください`);
});
