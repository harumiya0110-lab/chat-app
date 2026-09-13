(() => {
  const usernameInput = document.getElementById('username-input');
  const joinBtn = document.getElementById('join-btn');
  const chatMain = document.getElementById('chat-main');
  const statusEl = document.getElementById('status');
  if (!usernameInput || !joinBtn || !chatMain) return;

  let joiningUsername = '';

  function setStatus(message, error = false) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.style.color = error ? '#a52d2d' : '';
  }

  // メール連携アカウントが新規登録・ログイン後にチャットへ入る直前に、
  // サーバーへ「この名前は認証済みアカウント本人」と先に通知します。
  // captureで受けることで、auth.jsのjoinBtn.click()より前に実行されます。
  window.addEventListener('rural-account-authenticated', event => {
    const username = String(event.detail?.username || '').normalize('NFC').trim().slice(0, 20);
    const uid = String(event.detail?.uid || '').trim();
    const email = String(event.detail?.email || '').trim();
    if (!username || typeof socket === 'undefined' || !socket?.connected) return;
    socket.emit('email-account-session', { username, uid, email });
  }, true);

  function enterChat(username) {
    const cleanUsername = String(username || '').normalize('NFC').trim().slice(0, 20);
    if (!cleanUsername || !chatMain.hidden || joiningUsername === cleanUsername) return;

    joiningUsername = cleanUsername;
    usernameInput.value = cleanUsername;
    if (typeof socket === 'undefined' || !socket?.connected) {
      setStatus('サーバーへの接続を待っています…');
      return;
    }

    setStatus('アカウントで自動的にチャットへ参加しています…');
    joinBtn.click();
  }

  window.addEventListener('rural-account-authenticated', event => {
    const username = String(event.detail?.username || '').normalize('NFC').trim().slice(0, 20);
    if (!username) return;
    enterChat(username);
  });

  const tryExistingUser = () => {
    const user = window.ruralFirebaseAuth?.currentUser;
    if (user?.displayName) enterChat(user.displayName);
  };

  tryExistingUser();
  setTimeout(tryExistingUser, 500);

  joinBtn.addEventListener('click', () => {
    if (!chatMain.hidden) joiningUsername = '';
  });

  window.addEventListener('rural-account-login-failed', () => {
    joiningUsername = '';
  });
})();
