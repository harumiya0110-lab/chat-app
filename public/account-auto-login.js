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
    if (window.__ruralSignupInProgress) return;
    enterChat(username);
  });

  const tryExistingUser = () => {
    if (window.__ruralSignupInProgress) return;
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
