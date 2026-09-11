(() => {
  const usernameInput = document.getElementById('username-input');
  const joinBtn = document.getElementById('join-btn');
  const setupPanel = document.getElementById('setup-panel');
  const chatMain = document.getElementById('chat-main');
  const statusEl = document.getElementById('status');
  if (!usernameInput || !joinBtn || !setupPanel || !chatMain) return;

  let joiningUsername = '';

  async function claimName(username, uid, email) {
    const response = await fetch('/api/account-name/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountName: username, uid, email: email || '' })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 409) throw new Error(result.reason || 'server-error');
    return result;
  }

  function isFreshAccount(user) {
    const created = Date.parse(user?.metadata?.creationTime || '');
    const signedIn = Date.parse(user?.metadata?.lastSignInTime || '');
    return Number.isFinite(created) && Number.isFinite(signedIn) && Math.abs(created - signedIn) < 15000;
  }

  async function enterChat(username, user = null) {
    const cleanUsername = String(username || '').normalize('NFC').trim().slice(0, 20);
    if (!cleanUsername || !chatMain.hidden) return;
    if (joiningUsername === cleanUsername) return;

    joiningUsername = cleanUsername;
    usernameInput.value = cleanUsername;
    if (statusEl) statusEl.textContent = 'アカウント名を確認しています…';

    if (user?.uid) {
      try {
        const result = await claimName(cleanUsername, user.uid, user.email);
        if (!result.ok) {
          const wasFreshAccount = isFreshAccount(user);
          joiningUsername = '';
          if (wasFreshAccount) await user.delete().catch(() => {});
          else await window.ruralFirebaseAuth?.signOut?.();
          if (statusEl) statusEl.textContent = wasFreshAccount
            ? 'そのアカウント名はすでに使用されています。アカウント作成を取り消しました。別の名前で登録してください。'
            : 'このアカウント名はすでに別のアカウントで使用されています。';
          return;
        }
      } catch (error) {
        console.error('Account-name claim failed:', error);
        joiningUsername = '';
        if (statusEl) statusEl.textContent = 'アカウント名の確認に失敗しました。しばらくしてから再試行してください。';
        return;
      }
    }

    if (statusEl) statusEl.textContent = 'アカウントで自動的にチャットへ参加しています…';
    joinBtn.click();
  }

  window.addEventListener('rural-account-authenticated', event => {
    const user = window.ruralFirebaseAuth?.currentUser;
    enterChat(event.detail?.username || '', user);
  });

  const tryExistingUser = () => {
    const user = window.ruralFirebaseAuth?.currentUser;
    if (user?.displayName) enterChat(user.displayName, user);
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
