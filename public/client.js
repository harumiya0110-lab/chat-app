// Socket.IOの接続
const socket = io();

let currentUsername = '';

// DOM要素の取得
const setupPanel = document.getElementById('setup-panel');
const chatMain = document.getElementById('chat-main');
const usernameInput = document.getElementById('username-input');
const messageInput = document.getElementById('message-input');
const imageInput = document.getElementById('image-input');
const messagesContainer = document.getElementById('messages');
const usersList = document.getElementById('users-list');
const currentUsernameDisplay = document.getElementById('current-username');
const onlineCountDisplay = document.getElementById('online-count');
const callModal = document.getElementById('call-modal');
const callStatus = document.getElementById('call-status');
const remoteVideo = document.getElementById('remote-video');
const localVideo = document.getElementById('local-video');
const callAcceptBtn = document.getElementById('call-accept-btn');
const callDeclineBtn = document.getElementById('call-decline-btn');
const muteBtn = document.getElementById('mute-btn');
const camToggleBtn = document.getElementById('cam-toggle-btn');
const callEndBtn = document.getElementById('call-end-btn');

let autoScrollEnabled = true;
let localStream = null;
let peerConnection = null;
let currentCallTarget = null;
let isMuted = false;
let isVideoOn = true;

messagesContainer.addEventListener('scroll', () => {
    const isNearBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < 80;
    autoScrollEnabled = isNearBottom;
});

// チャットに参加する処理
function joinChat() {
    const username = usernameInput.value.trim();
    
    if (username === '') {
        alert('ニックネームを入力してください');
        return;
    }

    if (username.length > 20) {
        alert('ニックネームは20文字以内にしてください');
        return;
    }

    // サーバーにニックネームを送信（サーバー側で重複チェック）
    socket.emit('set-username', username);
    // ボタンを無効化して重複応答を待つ
    document.getElementById('join-btn').disabled = true;
}

// サーバーが名前を受理したとき
socket.on('username-accepted', (data) => {
    currentUsername = data.username;
    // UIを切り替え
    setupPanel.style.display = 'none';
    chatMain.style.display = 'grid';
    // 入力フィールドをフォーカス
    messageInput.focus();
    // ユーザー表示を更新
    currentUsernameDisplay.textContent = currentUsername;
    document.getElementById('join-btn').disabled = false;
});

// サーバーが重複を検出したとき
socket.on('username-error', (data) => {
    alert(data.message || 'この名前は使用できません');
    document.getElementById('join-btn').disabled = false;
});

// メッセージ送信処理
function sendMessage() {
    const message = messageInput.value.trim();
    
    if (message === '') {
        return;
    }

    // サーバーにメッセージを送信
    socket.emit('send-message', { message: message });
    
    // 入力フィールドをリセット
    messageInput.value = '';
    messageInput.focus();
}

// Enterキーでメッセージ送信
function handleKeyPress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

// メッセージ受信時の処理
socket.on('receive-message', (data) => {
    displayMessage(data);
});

// 画像受信
socket.on('receive-image', (data) => {
    displayImage(data);
});

// ユーザーが参加したときの通知
socket.on('user-joined', (data) => {
    displaySystemMessage(data.message, 'joined');
});

// ユーザーが退出したときの通知
socket.on('user-left', (data) => {
    displaySystemMessage(data.message, 'left');
});

// オンラインユーザーリスト更新
socket.on('update-users', (users) => {
    updateUsersList(users);
});

// メッセージを表示
function displayMessage(data) {
    const messageElement = document.createElement('div');
    messageElement.className = 'message';
    
    // 自分のメッセージかどうか判定
    if (data.username === currentUsername) {
        messageElement.classList.add('own');
    }

    const messageHeader = document.createElement('div');
    messageHeader.className = 'message-header';
    messageHeader.innerHTML = `
        <span>${data.username}</span>
        <span>${data.timestamp}</span>
    `;

    const messageBubble = document.createElement('div');
    messageBubble.className = 'message-bubble';
    messageBubble.textContent = data.message || '';

    messageElement.appendChild(messageHeader);
    messageElement.appendChild(messageBubble);

    messagesContainer.appendChild(messageElement);
    
    // 最新メッセージまでスクロール
    scrollToBottom();
}

// 画像メッセージを表示
function displayImage(data) {
    const messageElement = document.createElement('div');
    messageElement.className = 'message';
    if (data.username === currentUsername) {
        messageElement.classList.add('own');
    }

    const messageHeader = document.createElement('div');
    messageHeader.className = 'message-header';
    messageHeader.innerHTML = `
        <span>${data.username}</span>
        <span>${data.timestamp}</span>
    `;

    const messageBubble = document.createElement('div');
    messageBubble.className = 'message-bubble';

    const img = document.createElement('img');
    img.src = data.image;
    img.alt = data.filename || 'image';
    img.style.maxWidth = '60%';
    img.style.borderRadius = '8px';
    img.style.display = 'block';

    messageBubble.appendChild(img);

    messageElement.appendChild(messageHeader);
    messageElement.appendChild(messageBubble);

    messagesContainer.appendChild(messageElement);
    scrollToBottom();
}

// システムメッセージを表示
function displaySystemMessage(message, type) {
    const systemMessage = document.createElement('div');
    systemMessage.className = 'system-message';
    systemMessage.textContent = message;
    
    messagesContainer.appendChild(systemMessage);
    scrollToBottom();
}

// ユーザーリストを更新
function updateUsersList(users) {
    usersList.innerHTML = '';
    
    users.forEach(user => {
        const li = document.createElement('li');
        const nameSpan = document.createElement('span');
        nameSpan.textContent = user.username;
        li.appendChild(nameSpan);

        if (user.username === currentUsername) {
            const you = document.createElement('span');
            you.textContent = ' (あなた)';
            you.style.marginLeft = '6px';
            li.appendChild(you);
        } else {
            const callBtn = document.createElement('button');
            callBtn.textContent = '通話';
            callBtn.style.marginLeft = '8px';
            callBtn.onclick = () => { startCall(user.id, user.username, true); };
            li.appendChild(callBtn);
        }
        usersList.appendChild(li);
    });

    // オンラインユーザー数を更新
    onlineCountDisplay.textContent = `${users.length}人`;
}

// 画像を縮小して dataURL を返す
function resizeImageFile(file, maxWidth = 1024, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas');
                const scale = Math.min(1, maxWidth / img.width);
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
                const dataURL = canvas.toDataURL(mime, quality);
                resolve(dataURL);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// 通話開始（発信）
async function startCall(targetId, targetName) {
    if (currentCallTarget) {
        alert('既に通話中です。');
        return;
    }
    // ビデオ＋音声で取得（モバイルではカメラを許可する）
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    } catch (err) {
        alert('メディアデバイスにアクセスできませんでした: ' + err.message);
        return;
    }

    // UI を表示
    showCallUI('発信中...');

    peerConnection = createPeerConnection(targetId);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    // ローカルプレビュー
    if (localVideo) localVideo.srcObject = localStream;
    currentCallTarget = targetId;

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('call-offer', { targetId, offer });
}

function createPeerConnection(targetId) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { targetId, candidate: event.candidate });
        }
    };
    pc.ontrack = (event) => {
        // リモートストリームをビデオにセット
        if (remoteVideo) remoteVideo.srcObject = event.streams[0];
    };
    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
            endCall();
        }
    };
    return pc;
}

// 通話終了
function endCall() {
    if (peerConnection) {
        try { peerConnection.close(); } catch (e) {}
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;
    isMuted = false; isVideoOn = true;
    hideCallUI();
    currentCallTarget = null;
}

// シグナリング受信ハンドラ
socket.on('incoming-call', async (data) => {
    const { from, username, offer } = data || {};
    // 着信UIを表示して応答を待つ
    showIncomingCallUI(username, from, offer);
});

socket.on('call-answered', async (data) => {
    const { from, answer } = data || {};
    if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }
});

socket.on('ice-candidate', async (data) => {
    const { from, candidate } = data || {};
    if (peerConnection && candidate) {
        try { await peerConnection.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {}
    }
});

socket.on('call-ended', (data) => {
    endCall();
});

// 通話UI制御
function showCallUI(statusText) {
    if (!callModal) return;
    callModal.style.display = 'block';
    callStatus.textContent = statusText || '';
    // in-call controls
    muteBtn.style.display = 'inline-block';
    camToggleBtn.style.display = 'inline-block';
    callEndBtn.style.display = 'inline-block';
    callAcceptBtn.style.display = 'none';
    callDeclineBtn.style.display = 'none';
}

function hideCallUI() {
    if (!callModal) return;
    callModal.style.display = 'none';
    callStatus.textContent = '';
    muteBtn.style.display = 'none';
    camToggleBtn.style.display = 'none';
    callEndBtn.style.display = 'none';
    callAcceptBtn.style.display = 'inline-block';
    callDeclineBtn.style.display = 'inline-block';
}

function showIncomingCallUI(username, from, offer) {
    if (!callModal) return;
    callModal.style.display = 'block';
    callStatus.textContent = `${username} さんから着信`;

    // accept handler
    const acceptHandler = async () => {
        callAcceptBtn.removeEventListener('click', acceptHandler);
        callDeclineBtn.removeEventListener('click', declineHandler);
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        } catch (err) {
            alert('メディアデバイスにアクセスできませんでした: ' + err.message);
            socket.emit('end-call', { targetId: from });
            hideCallUI();
            return;
        }

        peerConnection = createPeerConnection(from);
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
        if (localVideo) localVideo.srcObject = localStream;
        currentCallTarget = from;

        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('call-answer', { targetId: from, answer });
        showCallUI('通話中');
    };

    const declineHandler = () => {
        callAcceptBtn.removeEventListener('click', acceptHandler);
        callDeclineBtn.removeEventListener('click', declineHandler);
        socket.emit('end-call', { targetId: from });
        hideCallUI();
    };

    callAcceptBtn.addEventListener('click', acceptHandler);
    callDeclineBtn.addEventListener('click', declineHandler);
}

// ミュート／カメラ切替／通話終了ボタン動作
if (muteBtn) {
    muteBtn.addEventListener('click', () => {
        if (!localStream) return;
        isMuted = !isMuted;
        localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
        muteBtn.textContent = isMuted ? 'ミュート解除' : 'ミュート';
    });
}

if (camToggleBtn) {
    camToggleBtn.addEventListener('click', () => {
        if (!localStream) return;
        isVideoOn = !isVideoOn;
        localStream.getVideoTracks().forEach(t => t.enabled = isVideoOn);
        camToggleBtn.textContent = isVideoOn ? 'カメラOFF' : 'カメラON';
    });
}

if (callEndBtn) {
    callEndBtn.addEventListener('click', () => {
        if (currentCallTarget) socket.emit('end-call', { targetId: currentCallTarget });
        endCall();
    });
}

// メッセージコンテナを最下部にスクロール
function scrollToBottom(force = false) {
    if (!autoScrollEnabled && !force) {
        return;
    }

    setTimeout(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }, 0);
}

// ページロード時に入力フィールドをフォーカス
window.addEventListener('load', () => {
    usernameInput.focus();
    scrollToBottom(true);
});

// Enterキーでニックネーム入力も可能
usernameInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        joinChat();
    }
});

// 画像選択時の送信
if (imageInput) {
    // 画像ボタンで input をトリガ
    const imageBtn = document.getElementById('image-btn');
    if (imageBtn) {
        imageBtn.addEventListener('click', () => imageInput.click());
    }

    imageInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        // サイズリミット（例: 5MB）
        const maxSize = 5 * 1024 * 1024;
        if (file.size > maxSize) {
            // モバイルで大きすぎる場合は縮小後に送る
            try {
                const dataURL = await resizeImageFile(file, 1024, 0.8);
                socket.emit('send-image', { image: dataURL, filename: file.name });
            } catch (err) {
                alert('画像の処理に失敗しました');
            }
            imageInput.value = '';
            return;
        }

        // 小さい画像は縮小せずに送信
        try {
            const dataURL = await resizeImageFile(file, 1024, 0.8);
            socket.emit('send-image', { image: dataURL, filename: file.name });
        } catch (err) {
            alert('画像の処理に失敗しました');
        }
        imageInput.value = '';
    });
}
