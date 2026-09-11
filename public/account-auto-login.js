(() => {
  const usernameInput = document.getElementById('username-input');
  const joinBtn = document.getElementById('join-btn');
  const setupPanel = document.getElementById('setup-panel');
  const chatMain = document.getElementById('chat-main');
  const statusEl = document.getElementById('status');
  if (!usernameInput || !joinBtn || !setupPanel || !chatMain) return;

  let joiningUsername = '';

  function enterChat(username) {
    const cleanUsername = String(username || '').trim().slice(0, 20);
    if (!cleanUsername || !chatMain.hidden) return;
    if (joiningUsername === cleanUsername) return;

    joiningUsername = cleanUsername;
    usernameInput.value = cleanUsername;
    if (statusEl) statusEl.textContent = 'アカウントで自動的にチャットへ参加しています…';
    joinBtn.click();
  }

  window.addEventListener('rural-account-authenticated', event => {
    enterChat(event.detail?.username || '');
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
