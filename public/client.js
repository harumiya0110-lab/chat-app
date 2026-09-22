const socket = io();

let currentUsername = '';
let localStream = null;
let peerConnection = null;
let currentCallTarget = null;
let pendingIncoming = null;
let pendingIceCandidates = [];
let isMuted = false;
let isVideoOn = true;
let isMinimized = false;
let isJoiningChat = false;
let isHistoryLoading = false;
let ruralReplyTarget = null;

window.ruralSetReplyTarget = target => {
  ruralReplyTarget = target && typeof target.id === 'string' ? {
    id: target.id,
    username: String(target.username || '投稿者').slice(0, 50),
    message: String(target.message || '').slice(0, 2000)
  } : null;
  window.dispatchEvent(new CustomEvent('rural-reply-target-changed', { detail: ruralReplyTarget }));
};
window.ruralGetReplyTarget = () => ruralReplyTarget;

const MAX_CHAT_MESSAGES = 50;
const ruralMarkerByMessageId = new Map();
window.ruralMarkerByMessageId = ruralMarkerByMessageId;

const markerLocationCache = new Map();
let mapLocationSystemMessage = null;

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
  return String(value ?? '').replace(/[&<>'\"]/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '\"': '&quot;'
  }[ch]));
}

function setStatus(text) {
  if (status) status.textContent = text;
}

function scrollToBottom() {
  messages.scrollTop = messages.scrollHeight;
}

function trimChatMessages() {
  if (!messages) return;
  const chatItems = messages.querySelectorAll('.message');
  const removeCount = Math.max(0, chatItems.length - MAX_CHAT_MESSAGES);
  for (let i = 0; i < removeCount; i += 1) {
    chatItems[i]?.remove();
  }
}

function addNormalMessageDeleteControl(item, data) {
  if (data.locationData || data.username !== currentUsername || !data.id) return;

  const actions = document.createElement('div');
  actions.className = 'message-actions';

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'chat-delete-btn';
  deleteButton.textContent = '🗑 削除';
  deleteButton.title = '自分の投稿だけ削除できます';

  deleteButton.addEventListener('click', () => {
    if (!window.confirm('この投稿を削除しますか？')) return;

    deleteButton.disabled = true;
    deleteButton.textContent = '削除中…';

    socket.emit('delete-chat-message', { id: data.id }, result => {
      if (!result?.ok) {
        deleteButton.disabled = false;
        deleteButton.textContent = '🗑 削除';
        const reasonMessages = {
          'not-owner': '自分の投稿だけ削除できます。',
          'not-found': '投稿が見つかりません。',
          'unauthorized': 'ログインしてから削除してください。',
          'server-error': '削除中にエラーが発生しました。'
        };
        setStatus(reasonMessages[result.reason] || '投稿の削除に失敗しました。');
        return;
      }

      item.remove();
      setStatus('自分の投稿を削除しました。');
      scrollToBottom();
    });
  });

  actions.appendChild(deleteButton);
  item.appendChild(actions);
}

function buildMessageElement(data) {
  const item = document.createElement('article');
  item.className = 'message' + (data.username === currentUsername ? ' own' : '');
  const timestamp = data.timestamp || (data.createdAt ? new Date(data.createdAt).toLocaleString('ja-JP') : '');
  const type = data.locationData?.eventType;
  const style = EVENT_STYLES[type];
  const badge = type && style ? `<span class="message-type-badge" style="background:${style.color}">${escapeHtml(type)}</span>` : '';
  const resolved = data.status === 'resolved' ? '<span class="message-resolved-badge">✅ 解決済み</span>' : '';
  const replyToId = String(data.replyToId || '').trim();
  const replyToUsername = String(data.replyToUsername || '投稿者').trim() || '投稿者';
  const replyToText = String(data.replyToText || '').trim().slice(0, 200);
  const reply = replyToId
    ? `<div class="message-reply" data-reply-target="${escapeHtml(replyToId)}" role="button" tabindex="0" title="返信元の投稿を表示"><span class="message-reply-label">↩︎ ${escapeHtml(replyToUsername)}さんへの返信</span>${replyToText ? `<span class="message-reply-quote">${escapeHtml(replyToText)}</span>` : ''}</div>`
    : '';
  item.innerHTML = `<div class="message-header"><span>${escapeHtml(data.username || '投稿者')}</span><span>${escapeHtml(timestamp)}</span></div><div class="message-badges">${badge}${resolved}</div>${reply}<div class="message-bubble">${escapeHtml(data.message || data.text || '')}</div>`;
  item.dataset.messageId = typeof data.id === 'string' ? data.id : '';
  item.dataset.username = typeof data.username === 'string' ? data.username : '';
  item.dataset.userId = typeof data.userId === 'string' ? data.userId : '';
  item.dataset.location = data.locationData ? '1' : '0';
  item.dataset.status = data.status === 'resolved' ? 'resolved' : 'open';
  item.dataset.reactions = JSON.stringify(data.reactions || { like: [], helpful: [], thanks: [] });
  item.dataset.messageText = String(data.message || data.text || '').slice(0, 2000);
  addNormalMessageDeleteControl(item, data);
  return item;
}

window.ruralBuildMessageElement = buildMessageElement;

function getMessageKey(data) {
  const id = typeof data?.id === 'string' ? data.id.trim() : '';
  if (id) return 'id:' + id;
  const username = String(data?.username || '').trim();
  const message = String(data?.message || data?.text || '').trim();
  const createdAt = String(data?.createdAt || data?.timestamp || '').trim();
  const location = data?.locationData
    ? [data.locationData.lat, data.locationData.lng, data.locationData.eventType].map(String).join(':')
    : '';
  return 'legacy:' + [username, message, createdAt, location].join('|');
}

function hasRenderedMessage(data) {
  const key = getMessageKey(data);
  if (!key || key === 'legacy:|||') return false;
  return [...messages.querySelectorAll('.message')].some(item => {
    if (item.dataset.messageKey === key) return true;
    if (data?.id && item.dataset.messageId === String(data.id)) return true;
    return false;
  });
}

function addMessage(data) {
  if (hasRenderedMessage(data)) return;
  const item = buildMessageElement(data);
  item.dataset.messageKey = getMessageKey(data);
  messages.appendChild(item);
  if (!isHistoryLoading) {
    trimChatMessages();
    scrollToBottom();
  }
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
  image.alt = data.filename || '画像';
  image.loading = 'lazy';
  image.style.maxWidth = '100%';

  if (typeof data?.image === 'string') {
    image.src = data.image;
  } else if (data?.image instanceof ArrayBuffer || ArrayBuffer.isView(data?.image)) {
    const bytes = data.image instanceof ArrayBuffer
      ? new Uint8Array(data.image)
      : new Uint8Array(data.image.buffer, data.image.byteOffset, data.image.byteLength);
    const type = typeof data.imageType === 'string' && /^image\\/[a-z0-9.+-]+$/i.test(data.imageType) ? data.imageType : 'image/jpeg';
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type }));
    image.src = objectUrl;
    image.addEventListener('load', () => URL.revokeObjectURL(objectUrl), { once: true });
  }

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.appendChild(image);
  item.innerHTML = `<div class="message-header"><span>${escapeHtml(data.username || '投稿者')}</span><span>${escapeHtml(data.timestamp || '')}</span></div>`;
  item.appendChild(bubble);
  messages.appendChild(item);
  trimChatMessages();
  scrollToBottom();
}

function addVideo(data) {
  const item = document.createElement('article');
  item.className = 'message' + (data.username === currentUsername ? ' own' : '');
  const video = document.createElement('video');
  video.controls = true;
  video.preload = 'metadata';
  video.playsInline = true;
  video.muted = false;
  video.defaultMuted = false;
  video.volume = 1;

  let objectUrl = '';
  if (typeof data?.video === 'string' && data.video.startsWith('data:video/')) {
    video.src = data.video;
  } else if (data?.video instanceof ArrayBuffer || ArrayBuffer.isView(data?.video)) {
    const bytes = data.video instanceof ArrayBuffer
      ? new Uint8Array(data.video)
      : new Uint8Array(data.video.buffer, data.video.byteOffset, data.video.byteLength);
    const type = typeof data.videoType === 'string' && /^video\\/[a-z0-9.+-]+$/i.test(data.videoType) ? data.videoType : 'video/mp4';
    objectUrl = URL.createObjectURL(new Blob([bytes], { type }));
    video.src = objectUrl;
    video.addEventListener('loadedmetadata', () => {
      video.volume = 1;
      video.muted = false;
      video.defaultMuted = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }, { once: true });
  }

  video.addEventListener('error', () => {
    setStatus('動画を再生できませんでした。MP4（H.264/AAC）などブラウザ対応形式を試してください。');
    if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  }, { once: true });

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.appendChild(video);
  item.innerHTML = `<div class="message-header"><span>${escapeHtml(data.username || '投稿者')}</span><span>${escapeHtml(data.timestamp || '')}</span></div>`;
  item.appendChild(bubble);
  messages.appendChild(item);
  trimChatMessages();
  scrollToBottom();
}

function joinChat() {
  const username = usernameInput.value.trim();
  if (!username) return alert('ニックネームを入力してください');
  if (username.length > 20) return alert('ニックネームは20文字以内にしてください');
  // メールログイン時などに認証イベントが重複しても、参加要求は一度だけ送信します。
  if (isJoiningChat || joinBtn.disabled) return;
  isJoiningChat = true;
  joinBtn.disabled = true;
  socket.emit('set-username', username);
}

joinBtn.addEventListener('click', joinChat);
usernameInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinChat(); });

function handleChatAccepted({ username, users: onlineUsers } = {}) {
  const acceptedUsername = String(username || '').trim();
  if (!acceptedUsername) return;
  isJoiningChat = false;
  currentUsername = acceptedUsername;
  usernameDisplay.textContent = acceptedUsername;
  setupPanel.hidden = true;
  chatMain.hidden = false;
  joinBtn.disabled = false;
  updateUsersList(Array.isArray(onlineUsers) ? onlineUsers : []);
  messageInput.focus();

  // 再参加時に前回の履歴を残したまま追加しないよう、チャット表示を一度リセットします。
  // これで同じ投稿がログイン回数に応じて2回・3回と表示されるのを防ぎます。
  if (messages) messages.replaceChildren();
  isHistoryLoading = true;
  window.__ruralHistoryLoading = true;
  setStatus('チャット履歴を読み込んでいます…');
}

socket.on('username-accepted', handleChatAccepted);

socket.on('username-error', data => {
  isJoiningChat = false;
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
      body: JSON.stringify({
        text,
        userId: socket.id || `web-${crypto.randomUUID()}`,
        replyToId: ruralReplyTarget?.id || '',
        replyToUsername: ruralReplyTarget?.username || '',
        replyToText: ruralReplyTarget?.message || ''
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '送信に失敗しました');
    messageInput.value = '';
    ruralReplyTarget = null;
    window.dispatchEvent(new CustomEvent('rural-reply-target-changed', { detail: null }));
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

socket.on('chat-history', history => {
  const items = Array.isArray(history) ? history : [];
  if (!items.length) return;

  const fragment = document.createDocumentFragment();
  const seen = new Set();
  for (const data of items) {
    const key = getMessageKey(data);
    if (key && seen.has(key)) continue;
    if (hasRenderedMessage(data)) continue;
    if (key) seen.add(key);
    const item = buildMessageElement(data);
    item.dataset.messageKey = key;
    fragment.appendChild(item);
  }
  messages.appendChild(fragment);

  // DOM挿入を1回にまとめた後、地図ピンを生成します。
  for (const data of items) addMarker(data);

  trimChatMessages();
  scrollToBottom();
});

socket.on('chat-history-end', () => {
  isHistoryLoading = false;
  window.__ruralHistoryLoading = false;
  trimChatMessages();
  scrollToBottom();
  setStatus('場所を含む投稿はAIが解析して地図に表示します。');
});

socket.on('chat-message-deleted', data => {
  const id = typeof data?.id === 'string' ? data.id : '';
  if (!id) return;
  messages.querySelectorAll('.message').forEach(item => {
    if (item.dataset.messageId === id) item.remove();
  });
  const marker = ruralMarkerByMessageId.get(id);
  if (marker && map.hasLayer(marker)) map.removeLayer(marker);
  ruralMarkerByMessageId.delete(id);
});

socket.on('receive-image', addImage);
socket.on('receive-video', addVideo);
socket.on('user-joined', data => addSystemMessage(data.message));
socket.on('user-left', data => addSystemMessage(data.message));
socket.on('update-users', updateUsersList);

socket.on('connect', () => {
  if (!currentUsername) return;
  socket.emit('get-online-users', {}, result => {
    if (result?.ok) updateUsersList(result.users);
  });
});

function updateUsersList(users) {
  const onlineUsers = Array.isArray(users)
    ? users.filter(user => user && typeof user === 'object' && user.id && String(user.username || '').trim())
    : [];

  if (!usersList) return;
  usersList.replaceChildren();
  onlineCount.textContent = String(onlineUsers.length) + '人';

  if (!onlineUsers.length) {
    const empty = document.createElement('li');
    empty.className = 'users-empty';
    empty.textContent = 'オンラインユーザーはいません';
    usersList.appendChild(empty);
    return;
  }

  for (const user of onlineUsers) {
    const li = document.createElement('li');
    li.dataset.userId = String(user.id);

    const nameWrap = document.createElement('span');
    nameWrap.className = 'online-user-name';
    const dot = document.createElement('i');
    dot.className = 'online-user-dot';
    dot.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.textContent = String(user.username).slice(0, 50);
    nameWrap.append(dot, name);
    li.appendChild(nameWrap);

    if (String(user.username) === currentUsername || String(user.id) === String(socket.id)) {
      const me = document.createElement('small');
      me.className = 'online-user-me';
      me.textContent = 'あなた';
      li.appendChild(me);
    } else {
      const call = document.createElement('button');
      call.textContent = '📹 通話';
      call.type = 'button';
      call.title = String(user.username) + 'さんにビデオ通話を発信';
      call.addEventListener('click', () => startCall(String(user.id), String(user.username)));
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

async function showMarkerAreaInChat(marker) {
  const point = marker?.getLatLng?.();
  if (!point) return;

  const cacheKey = `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`;
  const cached = markerLocationCache.get(cacheKey);
  if (cached) {
    updateMarkerAreaMessage(cached);
    return;
  }

  updateMarkerAreaMessage({ loading: true });
  try {
    const response = await fetch(`/api/reverse-geocode?lat=${encodeURIComponent(point.lat)}&lng=${encodeURIComponent(point.lng)}`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.error || '場所を特定できませんでした。');

    const location = {
      prefecture: String(result.prefecture || '').trim(),
      city: String(result.city || '').trim()
    };
    markerLocationCache.set(cacheKey, location);
    updateMarkerAreaMessage(location);
  } catch (error) {
    console.error('ピンの場所取得に失敗しました:', error);
    updateMarkerAreaMessage({ error: error.message || '都道府県・市区町村を特定できませんでした。' });
  }
}

function updateMarkerAreaMessage(location) {
  if (!messages) return;

  if (!mapLocationSystemMessage) {
    mapLocationSystemMessage = document.createElement('div');
    mapLocationSystemMessage.className = 'system-message map-location-system-message';
    messages.appendChild(mapLocationSystemMessage);
  }

  if (location.loading) {
    mapLocationSystemMessage.textContent = '📍 ピンの場所を調べています…';
  } else if (location.error) {
    mapLocationSystemMessage.textContent = `📍 ${location.error}`;
  } else {
    const prefecture = location.prefecture || '';
    const city = location.city || '';
    const area = [prefecture, city].filter(Boolean).join('');
    mapLocationSystemMessage.textContent = area
      ? `📍 このピンの場所：${area}`
      : '📍 このピンの都道府県・市区町村を特定できませんでした。';
  }

  scrollToBottom();
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
  const messageId = typeof message.id === 'string' ? message.id.trim() : '';
  if (messageId && ruralMarkerByMessageId.has(messageId)) {
    return ruralMarkerByMessageId.get(messageId);
  }
  const marker = L.marker([lat, lng], { icon: createEventIcon(type) }).addTo(map).bindPopup(popup);
  marker.__messageId = messageId;
  marker.on('click', () => {
    void showMarkerAreaInChat(marker);
    window.dispatchEvent(new CustomEvent('rural-map-marker-clicked', { detail: { marker, messageId } }));
  });
  if (messageId) ruralMarkerByMessageId.set(messageId, marker);
  return marker;
}

window.ruralAddMarker = addMarker;

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
    if (!socket.connected) {
      setStatus('サーバーに接続されていないため画像を送信できません。');
      return;
    }
    setStatus('画像を送信しています…');
    const dataUrl = await resizeImage(file);
    socket.timeout(30000).emit('send-image', {
      image: dataUrl,
      imageType: file.type || 'image/jpeg',
      filename: file.name
    }, (err, result) => {
      if (err) {
        console.error('画像送信タイムアウト:', err);
        setStatus('画像の送信がタイムアウトしました。');
        return;
      }
      if (!result?.ok) {
        setStatus(result.reason === 'too-large' ? '画像は12MB程度までにしてください。' : '画像の送信に失敗しました。');
        return;
      }
      setStatus('画像を送信しました。');
    });
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
    if (!socket.connected) {
      setStatus('サーバーに接続されていないため動画を送信できません。');
      return;
    }
    setStatus('動画を読み込んでいます…');
    const buffer = await file.arrayBuffer();
    setStatus('動画を送信しています…');
    socket.timeout(120000).emit('send-video', {
      video: buffer,
      videoType: file.type || 'video/mp4',
      filename: file.name
    }, (err, result) => {
      if (err) {
        console.error('動画送信タイムアウト:', err);
        setStatus('動画の送信がタイムアウトしました。');
        return;
      }
      if (!result?.ok) {
        setStatus(result.reason === 'too-large' ? '動画は15MB以下にしてください。' : '動画の送信に失敗しました。');
        return;
      }
      setStatus('動画を送信しました。');
    });
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
  pendingIceCandidates = [];
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
    if (!event.candidate) return;
    socket.timeout(10000).emit('ice-candidate', { targetId, candidate: event.candidate });
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
    socket.timeout(10000).emit('call-offer', { targetId, offer }, (err, result) => {
      if (err || !result?.ok) {
        setStatus(result?.reason === 'offline' ? '相手がオンラインではありません。' : '通話の発信に失敗しました。');
        cleanupCall(false);
      }
    });
  } catch (error) {
    console.error(error);
    cleanupCall(false);
    alert(error.message || '通話を開始できませんでした');
  }
}

socket.on('incoming-call', data => {
  if (currentCallTarget) return;
  pendingIncoming = data;
  currentCallTarget = data.from;
  showCallUI(`${data.username}さんから着信`, true);
});

acceptBtn.addEventListener('click', async () => {
  if (!pendingIncoming) return;
  try {
    localStream = await getMedia();
    peerConnection = createPeerConnection(pendingIncoming.from);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    localVideo.srcObject = localStream;
    miniLocal.srcObject = localStream;
    showCallUI(`${pendingIncoming.username}さんと接続中…`);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(pendingIncoming.offer));
    await flushPendingIceCandidates();
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('call-answer', { targetId: pendingIncoming.from, answer });
    pendingIncoming = null;
  } catch (error) {
    console.error(error);
    cleanupCall(true);
    alert(error.message || '通話に応答できませんでした');
  }
});

declineBtn.addEventListener('click', () => {
  if (pendingIncoming?.from) socket.emit('end-call', { targetId: pendingIncoming.from });
  cleanupCall(false);
});

socket.on('call-answered', async data => {
  if (!peerConnection || data.from !== currentCallTarget) return;
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    await flushPendingIceCandidates();
    callStatus.textContent = '接続中…';
  } catch (error) {
    console.error(error);
    cleanupCall(true);
  }
});

socket.on('ice-candidate', async data => {
  if (!peerConnection || data.from !== currentCallTarget || !data.candidate) return;
  if (!peerConnection.remoteDescription) {
    pendingIceCandidates.push(data.candidate);
    return;
  }
  try {
    await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
  } catch (error) {
    console.error('ICE候補の追加に失敗しました:', error);
  }
});

async function flushPendingIceCandidates() {
  if (!peerConnection || !peerConnection.remoteDescription || !pendingIceCandidates.length) return;
  const candidates = pendingIceCandidates.splice(0);
  for (const candidate of candidates) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error('保留中ICE候補の追加に失敗しました:', error);
    }
  }
}

socket.on('call-ended', data => {
  if (data.from === currentCallTarget) cleanupCall(false);
});

muteBtn.addEventListener('click', () => {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(track => { track.enabled = !isMuted; });
  muteBtn.textContent = isMuted ? 'ミュート解除' : 'ミュート';
});

camToggleBtn.addEventListener('click', () => {
  if (!localStream) return;
  isVideoOn = !isVideoOn;
  localStream.getVideoTracks().forEach(track => { track.enabled = isVideoOn; });
  camToggleBtn.textContent = isVideoOn ? 'カメラOFF' : 'カメラON';
});

function minimizeCall() {
  if (!currentCallTarget) return;
  isMinimized = true;
  callModal.hidden = true;
  miniBar.hidden = false;
}

function unminimizeCall() {
  if (!currentCallTarget) return;
  isMinimized = false;
  miniBar.hidden = true;
  callModal.hidden = false;
}

minimizeBtn.addEventListener('click', minimizeCall);
miniUnminimize.addEventListener('click', unminimizeCall);
endBtn.addEventListener('click', () => cleanupCall(true));
miniEnd.addEventListener('click', () => cleanupCall(true));