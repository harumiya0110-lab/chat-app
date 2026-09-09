const socket = io();

let currentUsername = '';
let localStream = null;
let peerConnection = null;
let currentCallTarget = null;
let pendingIncoming = null;
let isMuted = false;
let isVideoOn = true;
let isMinimized = false;

const $ = (id) => document.getElementById(id);
const setupPanel = $('setup-panel');
const chatMain = $('chat-main');
const usernameInput = $('username-input');
const joinBtn = $('join-btn');
const messageInput = $('message-input');
const sendBtn = $('send-btn');
const imageBtn = $('image-btn');
const imageInput = $('image-input');
const videoBtn = $('video-btn');
const videoInput = $('video-input');
const messages = $('messages');
const usersList = $('users-list');
const usernameDisplay = $('current-username');
const onlineCount = $('online-count');
const status = $('status');
const callModal = $('call-modal');
const callStatus = $('call-status');
const remoteVideo = $('remote-video');
const localVideo = $('local-video');
const acceptBtn = $('call-accept-btn');
const declineBtn = $('call-decline-btn');
const muteBtn = $('mute-btn');
const camToggleBtn = $('cam-toggle-btn');
const minimizeBtn = $('minimize-btn');
const endBtn = $('call-end-btn');
const miniBar = $('mini-call-bar');
const miniLocal = $('mini-local');
const miniRemote = $('mini-remote');
const miniUnminimize = $('mini-unminimize');
const miniEnd = $('mini-end');

const EVENT_STYLES = {
  '鳥獣目撃': { color: '#8b5cf6', symbol: '🐾' },
  '交通障害': { color: '#d64545', symbol: '!' },
  '道路障害': { color: '#d64545', symbol: '!' },
  '助け合い': { color: '#2d8a57', symbol: '+' },
  'イベント': { color: '#e39a28', symbol: '★' },
  'その他': { color: '#6c7a89', symbol: '・' }
};

const map = L.map('map').setView([34.3853, 132.4553], 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[ch]));
}

function setStatus(text) {
  if (status) status.textContent = text;
}

function scrollToBottom() {
  messages.scrollTop = messages.scrollHeight;
}

function addMessage(data) {
  const item = document.createElement('article');
  item.className = 'message' + (data.username === currentUsername ? ' own' : '');
  const timestamp = data.timestamp || (data.createdAt ? new Date(data.createdAt).toLocaleString('ja-JP') : '');
  const type = data.locationData?.eventType;
  const style = EVENT_STYLES[type];
  const badge = type && style ? `<span style="display:inline-block;background:${style.color};color:#fff;border-radius:999px;padding:2px 7px;font-size:11px;font-weight:700;margin-bottom:4px">${escapeHtml(type)}</span><br>` : '';
  item.innerHTML = `<div class="message-header"><span>${escapeHtml(data.username || '投稿者')}</span><span>${escapeHtml(timestamp)}</span></div><div class="message-bubble">${badge}${escapeHtml(data.message || data.text || '')}</div>`;
  messages.appendChild(item);
  scrollToBottom();
}

function addSystemMessage(text) {
  const item = document.createElement('div');
  item.className = 'system-message';
  item.textContent = text;
  messages.appendChild(item);
  scrollToBottom();
}

function addImage(data) {
  const item = document.createElement('article');
  item.className = 'message' + (data.username === currentUsername ? ' own' : '');
  const image = document.createElement('img');
  image.src = data.image;
  image.alt = data.filename || '画像';
  image.loading = 'lazy';
  image.style.maxWidth = '100%';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.appendChild(image);
  item.innerHTML = `<div class="message-header"><span>${escapeHtml(data.username || '投稿者')}</span><span>${escapeHtml(data.timestamp || '')}</span></div>`;
  item.appendChild(bubble);
  messages.appendChild(item);
  scrollToBottom();
}

function addVideo(data) {
  const item = document.createElement('article');
  item.className = 'message' + (data.username === currentUsername ? ' own' : '');
  const video = document.createElement('video');
  video.src = data.video;
  video.controls = true;
  video.preload = 'metadata';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.appendChild(video);
  item.innerHTML = `<div class="message-header"><span>${escapeHtml(data.username || '投稿者')}</span><span>${escapeHtml(data.timestamp || '')}</span></div>`;
  item.appendChild(bubble);
  messages.appendChild(item);
  scrollToBottom();
}

function joinChat() {
  const username = usernameInput.value.trim();
  if (!username) return alert('ニックネームを入力してください');
  if (username.length > 20) return alert('ニックネームは20文字以内にしてください');
  joinBtn.disabled = true;
  socket.emit('set-username', username);
}

joinBtn.addEventListener('click', joinChat);
usernameInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinChat(); });

socket.on('username-accepted', ({ username }) => {
  currentUsername = username;
  usernameDisplay.textContent = username;
  setupPanel.hidden = true;
  chatMain.hidden = false;
  joinBtn.disabled = false;
  messageInput.focus();
  setStatus('場所を含む投稿はAIが解析して地図に表示します。');
});

socket.on('username-error', data => {
  alert(data?.message || 'この名前は使用できません');
  joinBtn.disabled = false;
});

async function sendTextMessage() {
  const text = messageInput.value.trim();
  if (!text || !currentUsername) return;
  sendBtn.disabled = true;
  setStatus('AIが場所とイベント種別を解析しています…');
  try {
    const response = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, userId: socket.id || `web-${crypto.randomUUID()}` })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '送信に失敗しました');
    messageInput.value = '';
    if (result.locationData) {
      setStatus(`${result.locationData.locationName} に「${result.locationData.eventType}」のピンを追加しました。`);
    } else if (result.geocodeError) {
      setStatus(`投稿しました。ただし${result.geocodeError}。`);
    } else {
      setStatus('投稿しました。場所を特定できない投稿はチャットのみ表示します。');
    }
  } catch (error) {
    console.error(error);
    setStatus(error.message || '送信中にエラーが発生しました。');
  } finally {
    sendBtn.disabled = false;
    messageInput.focus();
  }
}

sendBtn.addEventListener('click', sendTextMessage);
messageInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendTextMessage();
  }
});

socket.on('receive-message', data => {
  addMessage(data);
  addMarker(data);
});
socket.on('receive-image', addImage);
socket.on('receive-video', addVideo);
socket.on('user-joined', data => addSystemMessage(data.message));
socket.on('user-left', data => addSystemMessage(data.message));
socket.on('update-users', updateUsersList);

function updateUsersList(users) {
  usersList.innerHTML = '';
  onlineCount.textContent = `${users.length}人`;
  for (const user of users) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = user.username;
    li.appendChild(name);
    if (user.username === currentUsername) {
      const me = document.createElement('small');
      me.textContent = ' あなた';
      li.appendChild(me);
    } else {
      const call = document.createElement('button');
      call.textContent = '📹 通話';
      call.type = 'button';
      call.addEventListener('click', () => startCall(user.id, user.username));
      li.appendChild(call);
    }
    usersList.appendChild(li);
  }
}

function createEventIcon(eventType) {
  const style = EVENT_STYLES[eventType] || EVENT_STYLES['その他'];
  return L.divIcon({
    className: '',
    html: `<div class="event-marker" style="background:${style.color}"><span>${style.symbol}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -28]
  });
}

function addMarker(message) {
  const loc = message.locationData;
  if (!loc) return;
  const lat = Number(loc.lat);
  const lng = Number(loc.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const type = loc.eventType || 'その他';
  const style = EVENT_STYLES[type] || EVENT_STYLES['その他'];
  const popup = `<strong style="color:${style.color}">${escapeHtml(type)}</strong><br><strong>${escapeHtml(loc.summary || '')}</strong><br><small>${escapeHtml(loc.locationName || '')}</small><hr>${escapeHtml(message.message || message.text || '')}`;
  L.marker([lat, lng], { icon: createEventIcon(type) }).addTo(map).bindPopup(popup);
}

imageBtn.addEventListener('click', () => imageInput.click());
videoBtn.addEventListener('click', () => videoInput.click());

function resizeImage(file, maxWidth = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = e => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

imageInput.addEventListener('change', async () => {
  const file = imageInput.files?.[0];
  imageInput.value = '';
  if (!file) return;
  if (file.size > 12 * 1024 * 1024) return alert('画像は12MB以下にしてください');
  try {
    setStatus('画像を送信しています…');
    const dataUrl = await resizeImage(file);
    socket.emit('send-image', { image: dataUrl, filename: file.name });
    setStatus('画像を送信しました。');
  } catch (error) {
    console.error(error);
    setStatus('画像の処理に失敗しました。');
  }
});

videoInput.addEventListener('change', async () => {
  const file = videoInput.files?.[0];
  videoInput.value = '';
  if (!file) return;
  if (file.size > 15 * 1024 * 1024) return alert('動画は15MB以下にしてください');
  try {
    setStatus('動画を送信しています…');
    const reader = new FileReader();
    reader.onload = () => {
      socket.emit('send-video', { video: reader.result, filename: file.name });
      setStatus('動画を送信しました。');
    };
    reader.onerror = () => setStatus('動画の読み込みに失敗しました。');
    reader.readAsDataURL(file);
  } catch (error) {
    console.error(error);
    setStatus('動画の処理に失敗しました。');
  }
});

function showCallUI(text, incoming = false) {
  callModal.hidden = false;
  callStatus.textContent = text;
  acceptBtn.hidden = !incoming;
  declineBtn.hidden = !incoming;
  muteBtn.hidden = incoming;
  camToggleBtn.hidden = incoming;
  minimizeBtn.hidden = incoming;
  endBtn.hidden = incoming;
  miniBar.hidden = true;
}

function stopLocalStream() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  localVideo.srcObject = null;
  miniLocal.srcObject = null;
}

function cleanupCall(sendEnd = false) {
  if (sendEnd && currentCallTarget) socket.emit('end-call', { targetId: currentCallTarget });
  if (peerConnection) {
    try { peerConnection.close(); } catch {}
  }
  peerConnection = null;
  stopLocalStream();
  remoteVideo.srcObject = null;
  miniRemote.srcObject = null;
  currentCallTarget = null;
  pendingIncoming = null;
  isMuted = false;
  isVideoOn = true;
  isMinimized = false;
  callModal.hidden = true;
  miniBar.hidden = true;
  muteBtn.textContent = 'ミュート';
  camToggleBtn.textContent = 'カメラOFF';
}

function createPeerConnection(targetId) {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  });
  pc.onicecandidate = event => {
    if (event.candidate) socket.emit('ice-candidate', { targetId, candidate: event.candidate });
  };
  pc.ontrack = event => {
    const stream = event.streams[0];
    remoteVideo.srcObject = stream;
    miniRemote.srcObject = stream;
  };
  pc.onconnectionstatechange = () => {
    if (['failed', 'closed'].includes(pc.connectionState)) cleanupCall(false);
    else if (pc.connectionState === 'connected') callStatus.textContent = '通話中';
  };
  return pc;
}

async function getMedia() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('このブラウザではカメラ・マイクを利用できません');
  return navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'user' } });
}

async function startCall(targetId, targetName) {
  if (currentCallTarget) return alert('既に通話中です。');
  try {
    localStream = await getMedia();
    currentCallTarget = targetId;
    peerConnection = createPeerConnection(targetId);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    localVideo.srcObject = localStream;
    miniLocal.srcObject = localStream;
    showCallUI(`${targetName}さんへ発信中…`);
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('call-offer', { targetId, offer });
  } catch (error) {
    console.error(error);
    cleanupCall(false);
    alert(`通話を開始できませんでした。カメラ・マイクの許可を確認してください。\n${error.message}`);
  }
}

socket.on('incoming-call', ({ from, username, offer }) => {
  if (currentCallTarget) {
    socket.emit('end-call', { targetId: from });
    return;
  }
  pendingIncoming = { from, username, offer };
  showCallUI(`${username}さんから着信`, true);
});

acceptBtn.addEventListener('click', async () => {
  if (!pendingIncoming) return;
  const { from, offer, username } = pendingIncoming;
  try {
    localStream = await getMedia();
    currentCallTarget = from;
    peerConnection = createPeerConnection(from);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    localVideo.srcObject = localStream;
    miniLocal.srcObject = localStream;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('call-answer', { targetId: from, answer });
    callStatus.textContent = `${username}さんと通話中`;
    acceptBtn.hidden = true;
    declineBtn.hidden = true;
    muteBtn.hidden = false;
    camToggleBtn.hidden = false;
    minimizeBtn.hidden = false;
    endBtn.hidden = false;
    pendingIncoming = null;
  } catch (error) {
    console.error(error);
    socket.emit('end-call', { targetId: from });
    cleanupCall(false);
    alert(`通話に応答できませんでした。\n${error.message}`);
  }
});

declineBtn.addEventListener('click', () => {
  if (pendingIncoming?.from) socket.emit('end-call', { targetId: pendingIncoming.from });
  cleanupCall(false);
});

socket.on('call-answered', async ({ answer }) => {
  if (!peerConnection || !answer) return;
  try { await peerConnection.setRemoteDescription(new RTCSessionDescription(answer)); }
  catch (error) { console.error(error); }
});

socket.on('ice-candidate', async ({ candidate }) => {
  if (!peerConnection || !candidate) return;
  try { await peerConnection.addIceCandidate(new RTCIceCandidate(candidate)); }
  catch (error) { console.warn('ICE candidate error', error); }
});

socket.on('call-ended', () => cleanupCall(false));

muteBtn.addEventListener('click', () => {
  const audio = localStream?.getAudioTracks()[0];
  if (!audio) return;
  isMuted = !isMuted;
  audio.enabled = !isMuted;
  muteBtn.textContent = isMuted ? 'ミュート解除' : 'ミュート';
});

camToggleBtn.addEventListener('click', () => {
  const video = localStream?.getVideoTracks()[0];
  if (!video) return;
  isVideoOn = !isVideoOn;
  video.enabled = isVideoOn;
  camToggleBtn.textContent = isVideoOn ? 'カメラOFF' : 'カメラON';
});

endBtn.addEventListener('click', () => cleanupCall(true));
miniEnd.addEventListener('click', () => cleanupCall(true));

minimizeBtn.addEventListener('click', () => {
  isMinimized = true;
  callModal.hidden = true;
  miniBar.hidden = false;
});

miniUnminimize.addEventListener('click', () => {
  isMinimized = false;
  callModal.hidden = false;
  miniBar.hidden = true;
});

window.addEventListener('beforeunload', () => {
  if (currentCallTarget) socket.emit('end-call', { targetId: currentCallTarget });
});
