const socket = io();

let currentUsername = '';
let localStream = null;
let peerConnection = null;
let currentCallTarget = null;
let pendingIncoming = null;
let pendingIceCandidates = [];
let pendingOutgoingIceCandidates = [];
let outgoingIceEnabled = false;
let isMuted = false;
let isVideoOn = true;
let isRemoteVideoOn = true;
let isMinimized = false;
let isJoiningChat = false;
let isHistoryLoading = false;
let ruralReplyTarget = null;
let isAdmin = false;

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
const localCameraOff = $('local-camera-off');
const remoteCameraOff = $('remote-camera-off');
const miniLocalCameraOff = $('mini-local-camera-off');
const miniRemoteCameraOff = $('mini-remote-camera-off');
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

let map = null;

function initializeMap() {
  if (typeof L === 'undefined' || typeof L.map !== 'function') {
    console.warn('Leafletが読み込めないため、地図機能を一時的に無効にします。');
    return null;
  }

  try {
    map = L.map('map').setView([34.3853, 132.4553], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    window.ruralMap = map;
    return map;
  } catch (error) {
    console.error('地図の初期化に失敗しました:', error);
    map = null;
    return null;
  }
}

// 地図が失敗しても、ログイン機能まで止まらないようにします。
initializeMap();

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

      removeRenderedMessage(item);
      setStatus('自分の投稿を削除しました。');
      scrollToBottom();
    });
  });

  actions.appendChild(deleteButton);
  item.appendChild(actions);
}

function addReportControl(item, data) {
  if (!data?.id || !data?.message || data.username === currentUsername || item.querySelector('.chat-report-btn')) return;
  const host = item.querySelector(':scope > .message-actions') || (() => { const el=document.createElement('div'); el.className='message-actions'; item.appendChild(el); return el; })();
  const button=document.createElement('button'); button.type='button'; button.className='chat-report-btn'; button.textContent='⚑ 通報'; button.title='このメッセージを通報';
  button.addEventListener('click',()=>{
    const reason=window.prompt('通報理由を入力してください'); if(!reason?.trim()) return;
    button.disabled=true; socket.timeout(10000).emit('submit-report',{id:data.id,reason:reason.trim(),message:String(data.message||data.text||'').slice(0,2000),targetUsername:String(data.username||'').slice(0,50)},(err,result)=>{
      button.disabled=false; if(err||!result?.ok){setStatus('通報の送信に失敗しました。');return;} button.textContent='⚑ 通報済み'; setStatus('通報を送信しました。管理者が確認します。');
    });
  }); host.appendChild(button);
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
  item.dataset.location = data.locationData && !replyToId ? '1' : '0';
  item.dataset.status = data.status === 'resolved' ? 'resolved' : 'open';
  item.dataset.reactions = JSON.stringify(data.reactions || { like: [], helpful: [], thanks: [] });
  item.dataset.messageText = String(data.message || data.text || '').slice(0, 2000);
  item.dataset.replyToId = replyToId;
  item.dataset.replyPending = replyToId ? 'true' : 'false';
  if (replyToId) item.classList.add('reply-message');
  addNormalMessageDeleteControl(item, data);
  addReportControl(item, data);
  return item;
}

window.ruralBuildMessageElement = buildMessageElement;

function ensureReplyThread(parent) {
  if (!parent) return null;

  let thread = parent.querySelector(':scope > .message-replies');
  if (!thread) {
    thread = document.createElement('div');
    thread.className = 'message-replies';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'message-replies-toggle';
    toggle.setAttribute('aria-expanded', 'true');

    const list = document.createElement('div');
    list.className = 'message-replies-list';

    toggle.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      list.hidden = !list.hidden;
      toggle.setAttribute('aria-expanded', String(!list.hidden));
      toggle.classList.toggle('collapsed', list.hidden);
    });

    thread.appendChild(toggle);
    thread.appendChild(list);
    parent.appendChild(thread);
  }

  const list = thread.querySelector(':scope > .message-replies-list');
  const toggle = thread.querySelector(':scope > .message-replies-toggle');
  const count = list?.querySelectorAll(':scope > .message.reply-message').length || 0;

  if (toggle) {
    toggle.hidden = count === 0;
    toggle.textContent = count ? `↳ 返信 ${count}件` : '↳ 返信';
  }

  return { thread, list, toggle };
}

function attachReplyToParent(item, data = {}) {
  const replyToId = String(data.replyToId || item?.dataset?.replyToId || '').trim();
  if (!replyToId || !item || !messages) return false;

  const parent = [...messages.querySelectorAll('.message')].find(message =>
    message !== item && message.dataset.messageId === replyToId
  );

  if (!parent) {
    item.classList.add('reply-message');
    item.dataset.replyPending = 'true';
    return false;
  }

  const thread = ensureReplyThread(parent);
  if (!thread?.list) return false;

  item.classList.add('reply-message');
  item.dataset.replyPending = 'false';
  thread.list.appendChild(item);
  ensureReplyThread(parent);
  return true;
}

function attachPendingReplies() {
  if (!messages) return;
  const pending = [...messages.querySelectorAll('.message.reply-message[data-reply-pending="true"]')];
  pending.forEach(item => attachReplyToParent(item, { replyToId: item.dataset.replyToId || '' }));
}

function removeRenderedMessage(item) {
  if (!item || !messages) return;
  const replyToId = String(item.dataset.replyToId || '').trim();
  if (replyToId) {
    const parent = [...messages.querySelectorAll('.message')].find(message =>
      message !== item && message.dataset.messageId === replyToId
    );
    item.remove();
    if (parent) {
      const thread = parent.querySelector(':scope > .message-replies');
      if (thread) {
        const list = thread.querySelector(':scope > .message-replies-list');
        const toggle = thread.querySelector(':scope > .message-replies-toggle');
        const count = list?.querySelectorAll(':scope > .message.reply-message').length || 0;
        if (toggle) {
          toggle.hidden = count === 0;
          toggle.textContent = count ? `↳ 返信 ${count}件` : '↳ 返信';
          if (count === 0) toggle.setAttribute('aria-expanded', 'true');
        }
        if (count === 0) thread.remove();
      }
    }
    return;
  }
  item.remove();
}

window.ruralOrganizeReplies = attachPendingReplies;

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
  window.ruralEnhanceMessage?.(item);
  if (data?.replyToId) attachReplyToParent(item, data);
  attachPendingReplies();
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
    const type = typeof data.imageType === 'string' && /^image\/[a-z0-9.+-]+$/i.test(data.imageType) ? data.imageType : 'image/jpeg';
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
    const type = typeof data.videoType === 'string' && /^video\/[a-z0-9.+-]+$/i.test(data.videoType) ? data.videoType : 'video/mp4';
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

function enterChatScreen(acceptedUsername, onlineUsers = [], admin = false) {
  const name = String(acceptedUsername || '').trim();
  if (!name) return false;

  isJoiningChat = false;
  currentUsername = name;
  isAdmin = admin === true;
  usernameDisplay.textContent = name;
  document.getElementById('admin-reports-btn')?.toggleAttribute('hidden', !isAdmin);

  // ログイン画面用の状態を完全に解除し、チャット画面を表示します。
  document.body.classList.remove('pre-auth');
  setupPanel.hidden = true;
  chatMain.hidden = false;
  chatMain.removeAttribute('hidden');

  updateUsersList(Array.isArray(onlineUsers) ? onlineUsers : []);
  joinBtn.disabled = false;

  if (messages) messages.replaceChildren();
  isHistoryLoading = true;
  window.__ruralHistoryLoading = true;
  setStatus('チャット履歴を読み込んでいます…');

  requestAnimationFrame(() => {
    document.body.classList.remove('pre-auth');
    setupPanel.hidden = true;
    chatMain.hidden = false;
    chatMain.removeAttribute('hidden');
    window.ruralMap?.invalidateSize?.(true);
    messageInput?.focus?.();
  });

  return true;
}

function handleChatAccepted({ username, users: onlineUsers, isAdmin: acceptedAdmin } = {}) {
  const acceptedUsername = String(username || '').trim();
  if (!acceptedUsername) return;
  enterChatScreen(acceptedUsername, onlineUsers, acceptedAdmin === true);
}

function showLoginScreen() {
  currentUsername = '';
  isJoiningChat = false;
  setupPanel.hidden = false;
  chatMain.hidden = true;
  chatMain.setAttribute('hidden', '');
  document.body.classList.add('pre-auth');
  joinBtn.disabled = false;
}

function joinChat() {
  const username = usernameInput.value.normalize('NFC').trim();
  const adminPassword = username === 'ハル' ? (window.prompt('管理者「ハル」のパスワードを入力してください') || '') : '';
  if (!username) {
    alert('ニックネームを入力してください');
    usernameInput.focus();
    return;
  }
  if (username.length > 20) {
    alert('ニックネームは20文字以内にしてください');
    return;
  }
  if (isJoiningChat || (chatMain && !chatMain.hidden)) return;

  if (!socket.connected) {
    setStatus('サーバーに接続しています…');
    socket.connect();
    joinBtn.disabled = false;
    return;
  }

  isJoiningChat = true;
  joinBtn.disabled = true;
  setStatus('チャットに参加しています…');

  socket.timeout(10000).emit('set-username', { username, password: adminPassword }, (error, result) => {
    // サーバーから username-accepted が先に届いて画面が切り替わった場合は、
    // ACK側では何もしません。
    if (chatMain && !chatMain.hidden && currentUsername) return;

    if (!error && result?.ok) {
      enterChatScreen(result.username || username, result.users, result.isAdmin === true);
      return;
    }

    isJoiningChat = false;
    joinBtn.disabled = false;

    const message = result?.message || (
      error
        ? 'サーバーへの接続がタイムアウトしました。接続を確認してもう一度お試しください。'
        : 'チャットへの参加に失敗しました。'
    );
    setStatus(message);
    alert(message);
  });
}

function openAdminReports() {
  if (!isAdmin) return;
  socket.timeout(10000).emit('get-reports', {}, (err,result)=>{
    if(err||!result?.ok){setStatus('通報一覧を取得できませんでした。');return;}
    const modal=document.createElement('div'); modal.id='admin-reports-modal'; modal.className='admin-reports-modal';
    const reports=Array.isArray(result.reports)?result.reports:[];
    modal.innerHTML=`<div class="admin-reports-box"><div class="admin-reports-header"><strong>⚑ 通報確認</strong><button type="button" class="admin-reports-close">×</button></div><div class="admin-reports-list">${reports.length?reports.map(r=>`<article class="admin-report-item"><div><strong>${escapeHtml(r.targetUsername||'不明')}</strong> <span>${escapeHtml(r.reason||'')}</span></div><p>${escapeHtml(r.message||'')}</p><small>通報者：${escapeHtml(r.reporterUsername||'不明')}　${escapeHtml(r.createdAt?new Date(r.createdAt).toLocaleString('ja-JP'):'')}</small></article>`).join(''):'<p class="admin-reports-empty">現在、通報はありません。</p>'}</div></div>`;
    document.body.appendChild(modal); modal.querySelector('.admin-reports-close')?.addEventListener('click',()=>modal.remove());
  });
}
document.getElementById('admin-reports-btn')?.addEventListener('click',openAdminReports);
socket.on('chat-report-created',()=>{if(isAdmin) document.getElementById('admin-reports-btn')?.classList.add('has-new-report');});

joinBtn.addEventListener('click', joinChat);
usernameInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') joinChat();
});

socket.on('username-accepted', handleChatAccepted);

socket.on('username-error', data => {
  isJoiningChat = false;
  joinBtn.disabled = false;
  setStatus(data?.message || 'この名前は使用できません');
  alert(data?.message || 'この名前は使用できません');
});

socket.on('connect_error', () => {
  if (currentUsername) return;
  isJoiningChat = false;
  joinBtn.disabled = false;
  setStatus('サーバーに接続できません。しばらくしてからもう一度お試しください。');
});

socket.on('disconnect', () => {
  if (!currentUsername) showLoginScreen();
});

async function sendTextMessage(overrideText = null, overrideReplyTarget = undefined) {
  const text = String(overrideText ?? messageInput.value).trim();
  if (!text || !currentUsername) return false;
  const replyTarget = overrideReplyTarget === undefined ? ruralReplyTarget : overrideReplyTarget;
  sendBtn.disabled = true;
  setStatus(replyTarget?.id ? '返信を投稿しています…' : 'AIが場所とイベント種別を解析しています…');
  try {
    const response = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        userId: socket.id || `web-${crypto.randomUUID()}`,
        replyToId: replyTarget?.id || '',
        replyToUsername: replyTarget?.username || '',
        replyToText: replyTarget?.message || ''
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '送信に失敗しました');
    if (overrideText === null) messageInput.value = '';
    ruralReplyTarget = null;
    window.dispatchEvent(new CustomEvent('rural-reply-target-changed', { detail: null }));
    if (result.locationData) {
      setStatus(`${result.locationData.locationName} に「${result.locationData.eventType}」のピンを追加しました。`);
    } else if (result.geocodeError) {
      setStatus(`投稿しました。ただし${result.geocodeError}。`);
    } else {
      setStatus('投稿しました。場所を特定できない投稿はチャットのみ表示します。');
    }
    return true;
  } catch (error) {
    console.error(error);
    setStatus(error.message || '送信中にエラーが発生しました。');
    return false;
  } finally {
    sendBtn.disabled = false;
    messageInput.focus();
  }
}

window.ruralSendTextMessage = sendTextMessage;

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

  // 履歴では一度に複数投稿を追加するため、DOM挿入後に返信を親投稿へ再配置します。
  attachPendingReplies();

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

function clearAllDisplayedPosts() {
  if (messages) messages.replaceChildren();
  ruralMarkerByMessageId.forEach(marker => {
    try {
      if (map && typeof map.hasLayer === 'function' && map.hasLayer(marker)) map.removeLayer(marker);
    } catch (error) {
      console.warn('地図ピンのリセットに失敗しました:', error);
    }
  });
  ruralMarkerByMessageId.clear();
  markerLocationCache.clear();
  mapLocationSystemMessage = null;
  ruralReplyTarget = null;
  window.dispatchEvent(new CustomEvent('rural-reply-target-changed', { detail: null }));
}

socket.on('chat-message-deleted', data => {
  const id = typeof data?.id === 'string' ? data.id : '';
  if (!id) return;
  messages.querySelectorAll('.message').forEach(item => {
    if (item.dataset.messageId === id) removeRenderedMessage(item);
  });
  const marker = ruralMarkerByMessageId.get(id);
  if (marker && map.hasLayer(marker)) map.removeLayer(marker);
  ruralMarkerByMessageId.delete(id);
});

socket.on('chat-posts-cleared', () => {
  clearAllDisplayedPosts();
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
  if (typeof L === 'undefined' || typeof L.divIcon !== 'function') return null;

  return L.divIcon({
    className: '',
    html: `<div class="event-marker" style="background:${style.color}" aria-label="${escapeHtml(eventType || 'その他')}"><span class="event-marker-symbol">${style.symbol}</span></div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 44],
    popupAnchor: [0, -40]
  });
}

async function fetchMarkerArea(point) {
  if (!point) return null;
  const cacheKey = `${Number(point.lat).toFixed(5)},${Number(point.lng).toFixed(5)}`;
  const cached = markerLocationCache.get(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetch(`/api/reverse-geocode?lat=${encodeURIComponent(point.lat)}&lng=${encodeURIComponent(point.lng)}`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.error || '場所を特定できませんでした。');

    const location = {
      prefecture: String(result.prefecture || '').trim(),
      city: String(result.city || '').trim()
    };
    markerLocationCache.set(cacheKey, location);
    return location;
  } catch (error) {
    console.error('ピンの場所取得に失敗しました:', error);
    return { error: error.message || '都道府県・市区町村を特定できませんでした。' };
  }
}

async function showMarkerAreaInChat(marker) {
  const point = marker?.getLatLng?.();
  if (!point) return;
  const cached = markerLocationCache.get(`${point.lat.toFixed(5)},${point.lng.toFixed(5)}`);
  if (cached) {
    updateMarkerAreaMessage(cached);
    return;
  }
  updateMarkerAreaMessage({ loading: true });
  const location = await fetchMarkerArea(point);
  if (location?.error) updateMarkerAreaMessage(location);
  else updateMarkerAreaMessage(location || { error: '都道府県・市区町村を特定できませんでした。' });
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
  // 返信は地図へ出さない。過去のデータに場所情報が残っていても対象外にします。
  if (String(message?.replyToId || '').trim()) return null;
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
  if (!map || typeof L === 'undefined' || typeof L.marker !== 'function') {
    console.warn('地図が利用できないため、位置情報のピン表示をスキップします。');
    return null;
  }
  const icon = createEventIcon(type);
  if (!icon) return null;
  const marker = L.marker([lat, lng], { icon }).addTo(map).bindPopup(popup);
  marker.__messageId = messageId;
  marker.on('click', async () => {
    marker.setPopupContent(`${popup}<br><span>📍 県・市を確認しています…</span>`);
    const location = await fetchMarkerArea({ lat, lng });
    if (location?.error) {
      marker.setPopupContent(`${popup}<br><strong>📍 ${escapeHtml(location.error)}</strong>`);
    } else {
      const prefecture = String(location?.prefecture || '').trim();
      const city = String(location?.city || '').trim();
      const area = [prefecture, city].filter(Boolean).join('');
      marker.setPopupContent(
        area
          ? `${popup}<br><strong>📍 ${escapeHtml(area)}</strong>`
          : `${popup}<br><strong>📍 都道府県・市区町村を特定できませんでした。</strong>`
      );
    }
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

function setCameraOffUi(isLocal, isOn) {
  const targets = isLocal
    ? [localCameraOff, miniLocalCameraOff]
    : [remoteCameraOff, miniRemoteCameraOff];
  targets.forEach(element => {
    if (element) element.hidden = isOn;
  });
}

function showCallUI(text, incoming = false) {
  callModal.hidden = false;
  callStatus.textContent = text;
  setCameraOffUi(true, isVideoOn);
  setCameraOffUi(false, isRemoteVideoOn);
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
  pendingOutgoingIceCandidates = [];
  outgoingIceEnabled = false;
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
  isRemoteVideoOn = true;
  setCameraOffUi(true, true);
  setCameraOffUi(false, true);
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
    if (!outgoingIceEnabled) {
      pendingOutgoingIceCandidates.push({ targetId, candidate: event.candidate });
      return;
    }
    socket.timeout(10000).emit('ice-candidate', { targetId, candidate: event.candidate });
  };
  pc.ontrack = event => {
    const stream = event.streams[0];
    remoteVideo.srcObject = stream;
    miniRemote.srcObject = stream;
    isRemoteVideoOn = stream.getVideoTracks().some(track => track.enabled !== false && track.readyState !== 'ended');
    setCameraOffUi(false, isRemoteVideoOn);
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
        return;
      }
      outgoingIceEnabled = true;
      flushPendingOutgoingIceCandidates();
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
    socket.timeout(10000).emit('call-answer', { targetId: pendingIncoming.from, answer }, (err, result) => {
      if (err || !result?.ok) {
        cleanupCall(true);
        setStatus('通話への応答に失敗しました。');
        return;
      }
      outgoingIceEnabled = true;
      flushPendingOutgoingIceCandidates();
    });
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
  if (data.from !== currentCallTarget || !data.candidate) return;
  if (!peerConnection || !peerConnection.remoteDescription) {
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

function flushPendingOutgoingIceCandidates() {
  if (!outgoingIceEnabled || !pendingOutgoingIceCandidates.length) return;
  const candidates = pendingOutgoingIceCandidates.splice(0);
  for (const payload of candidates) {
    socket.timeout(10000).emit('ice-candidate', payload);
  }
}

socket.on('camera-state', data => {
  if (!currentCallTarget || data?.from !== currentCallTarget) return;
  isRemoteVideoOn = data.enabled !== false;
  setCameraOffUi(false, isRemoteVideoOn);
});

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
  setCameraOffUi(true, isVideoOn);
  camToggleBtn.textContent = isVideoOn ? 'カメラOFF' : 'カメラON';

  if (currentCallTarget) {
    socket.timeout(5000).emit('camera-state', {
      targetId: currentCallTarget,
      enabled: isVideoOn
    }, (err, result) => {
      if (err || !result?.ok) {
        console.warn('カメラ状態の通知に失敗しました');
      }
    });
  }
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