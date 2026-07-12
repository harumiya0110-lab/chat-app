const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 静的ファイルの配信
app.use(express.static(path.join(__dirname, 'public')));

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
