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
// 通話管理: callId -> {participants: Set}
const calls = {};
// 保留中の参加リクエスト: callsPending[callId][requesterId] = { expected: [...], responses: { socketId: bool }}
const callsPending = {};

function emitUserList() {
  // Build user list with inCall and callId info
  const list = Object.values(users).map(u => ({ ...u, inCall: false, callId: null }));
  // mark users in calls
  for (const [callId, info] of Object.entries(calls)) {
    info.participants.forEach(id => {
      const user = list.find(x => x.id === id);
      if (user) { user.inCall = true; user.callId = callId; }
    });
  }
  io.emit('update-users', list);
}

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
    emitUserList();
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
    const { targetId, offer, callId } = payload || {};
    const caller = users[socket.id];
    if (!caller || !targetId || !offer) return;
    const id = callId || socket.id;
    // create call record if not exists
    if (!calls[id]) calls[id] = { participants: new Set([socket.id]) };
    // forward offer with callId
    io.to(targetId).emit('incoming-call', { from: socket.id, username: caller.username, offer, callId: id, initiator: socket.id });
  });

  // 相手からのアンサーを発信者に転送
  socket.on('call-answer', (payload) => {
    const { targetId, answer, callId } = payload || {};
    if (!targetId || !answer) return;
    // add responder to call participants if callId provided
    if (callId && calls[callId]) {
      calls[callId].participants.add(socket.id);
      calls[callId].participants.add(targetId);
      emitUserList();
    }
    io.to(targetId).emit('call-answered', { from: socket.id, answer, callId });
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
    const { targetId, callId } = payload || {};
    if (callId && calls[callId]) {
      // remove sender from participants
      calls[callId].participants.delete(socket.id);
      // notify remaining participants
      calls[callId].participants.forEach(id => {
        io.to(id).emit('call-ended', { from: socket.id, callId });
      });
      // if no participants left remove call
      if (calls[callId].participants.size === 0) delete calls[callId];
      emitUserList();
      return;
    }
    if (targetId) {
      io.to(targetId).emit('call-ended', { from: socket.id });
    }
  });

  // 参加リクエスト: requester が既存の callId に参加希望を出す
  socket.on('request-join', (payload) => {
    const { callId, requesterId, autoApprove } = payload || {};
    if (!callId || !calls[callId]) {
      socket.emit('join-denied', { reason: '通話が存在しません' });
      return;
    }
    const participants = Array.from(calls[callId].participants);
    const expected = participants.filter(id => id !== requesterId);
    if (expected.length === 0) {
      // no participants to approve -> approve by default
      calls[callId].participants.add(requesterId);
      emitUserList();
      socket.emit('join-approved', { callId, initiator: participants[0] || null });
      return;
    }
    // create pending
    if (!callsPending[callId]) callsPending[callId] = {};
    callsPending[callId][requesterId] = { expected: expected.slice(), responses: {} };
    const requester = users[requesterId];
    expected.forEach(id => {
      io.to(id).emit('join-request', { callId, requesterId, requesterName: requester ? requester.username : '不明', autoApprove });
    });
    // optional: set timeout to auto-deny
  });

  // 参加応答ハンドラ
  socket.on('join-response', (payload) => {
    const { callId, requesterId, accepted } = payload || {};
    if (!callId || !callsPending[callId] || !callsPending[callId][requesterId]) return;
    const pending = callsPending[callId][requesterId];
    pending.responses[socket.id] = !!accepted;

    const responseCount = Object.keys(pending.responses).length;
    const yesCount = Object.values(pending.responses).filter(v => v).length;
    const noCount = responseCount - yesCount;
    const total = pending.expected.length;

    // すべての参加者が答えたら多数決
    if (responseCount >= total) {
      if (yesCount > noCount) {
        calls[callId].participants.add(requesterId);
        const reqSock = io.sockets.sockets.get(requesterId);
        if (reqSock) reqSock.emit('join-approved', { callId, initiator: Array.from(calls[callId].participants)[0] });
        emitUserList();
      } else {
        const reqSock = io.sockets.sockets.get(requesterId);
        if (reqSock) reqSock.emit('join-denied', { callId, by: socket.id });
      }
      delete callsPending[callId][requesterId];
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
      // remove from any calls
      for (const [callId, info] of Object.entries(calls)) {
        info.participants.delete(socket.id);
        if (info.participants.size === 0) delete calls[callId];
      }
      emitUserList();
    }
  });
});

// サーバーの起動
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`チャットサーバーがポート ${PORT} で起動しました`);
  console.log(`ブラウザで http://localhost:${PORT} にアクセスしてください`);
});
