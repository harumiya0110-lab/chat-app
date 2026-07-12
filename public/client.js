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
        li.textContent = user.username;
        if (user.username === currentUsername) {
            li.textContent += ' (あなた)';
        }
        usersList.appendChild(li);
    });

    // オンラインユーザー数を更新
    onlineCountDisplay.textContent = `${users.length}人`;
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
    imageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        // サイズリミット（例: 5MB）
        const maxSize = 5 * 1024 * 1024;
        if (file.size > maxSize) {
            alert('画像は5MB以下にしてください');
            imageInput.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = function(evt) {
            const dataURL = evt.target.result;
            socket.emit('send-image', { image: dataURL, filename: file.name });
            imageInput.value = '';
        };
        reader.readAsDataURL(file);
    });
}
