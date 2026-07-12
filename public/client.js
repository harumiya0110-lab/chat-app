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

let autoScrollEnabled = true;
let localStream = null;
let peerConnection = null;
let currentCallTarget = null;
const audioEl = document.createElement('audio');
audioEl.autoplay = true;

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
            callBtn.textContent = '電話';
            callBtn.style.marginLeft = '8px';
            callBtn.onclick = () => { startCall(user.id, user.username); };
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

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
        alert('マイクにアクセスできませんでした: ' + err.message);
        return;
    }

    peerConnection = createPeerConnection(targetId);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    currentCallTarget = targetId;

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('call-offer', { targetId, offer });
    alert(`${targetName} に発信中...`);
}

function createPeerConnection(targetId) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { targetId, candidate: event.candidate });
        }
    };
    pc.ontrack = (event) => {
        audioEl.srcObject = event.streams[0];
        document.body.appendChild(audioEl);
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
    if (audioEl && audioEl.parentNode) audioEl.parentNode.removeChild(audioEl);
    currentCallTarget = null;
}

// シグナリング受信ハンドラ
socket.on('incoming-call', async (data) => {
    const { from, username, offer } = data || {};
    const accept = confirm(`${username} さんから通話があります。応答しますか？`);
    if (!accept) {
        socket.emit('end-call', { targetId: from });
        return;
    }

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
        alert('マイクにアクセスできませんでした: ' + err.message);
        socket.emit('end-call', { targetId: from });
        return;
    }

    peerConnection = createPeerConnection(from);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    currentCallTarget = from;

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('call-answer', { targetId: from, answer });
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
