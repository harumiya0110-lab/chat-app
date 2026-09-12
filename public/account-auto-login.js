(() => {
  const usernameInput = document.getElementById('username-input');
  const joinBtn = document.getElementById('join-btn');
  const setupPanel = document.getElementById('setup-panel');
  const chatMain = document.getElementById('chat-main');
  const statusEl = document.getElementById('status');
  if (!usernameInput || !joinBtn || !setupPanel || !chatMain) return;

  let joiningUsername = '';
  let signupInProgress = false;

  function setStatus(message, error = false) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.style.color = error ? '#a52d2d' : '';
  }

  function getAccountField(id) {
    return document.getElementById(id);
  }

  async function waitForAuth() {
    for (let i = 0; i < 60; i += 1) {
      if (window.ruralFirebaseAuth) return window.ruralFirebaseAuth;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Firebase Authenticationの初期化を待っている間にタイムアウトしました。');
  }

  async function claimName(username, uid, email) {
    const response = await fetch('/api/account-name/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountName: username, uid, email: email || '' })
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 409) return { ok: false, reason: 'name-taken' };
    if (!response.ok) return { ok: false, reason: result.reason || 'server-error' };
    return result;
  }

  async function isNameAvailable(username) {
    const response = await fetch(`/api/account-name/check?name=${encodeURIComponent(username)}`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, available: false, reason: result.reason || 'server-error' };
    return result;
  }

  async function registerAccount() {
    if (signupInProgress) return;

    const nameInput = getAccountField('account-name');
    const emailInput = getAccountField('account-email-signup');
    const passwordInput = getAccountField('account-password-signup');
    const name = String(nameInput?.value || '').normalize('NFC').trim().slice(0, 20);
    const email = String(emailInput?.value || '').trim();
    const password = String(passwordInput?.value || '');

    if (!name) return setStatus('新規登録時はアカウント名を入力してください。', true);
    if (name.length > 20) return setStatus('アカウント名は20文字以内にしてください。', true);
    if (!email || !password) return setStatus('メールアドレスとパスワードを入力してください。', true);

    signupInProgress = true;
    window.__ruralSignupInProgress = true;
    setStatus('アカウント名の使用状況を確認しています…');

    let createdUser = null;
    try {
      const auth = await waitForAuth();

      const availability = await isNameAvailable(name);
      if (!availability.ok) {
        setStatus('アカウント名の確認に失敗しました。しばらくしてから再試行してください。', true);
        return;
      }
      if (!availability.available) {
        setStatus('このアカウント名はすでに使用されています。別のアカウント名を入力してください。', true);
        return;
      }

      setStatus('アカウントを作成しています…');
      const result = await auth.createUserWithEmailAndPassword(email, password);
      createdUser = result.user;

      await createdUser.updateProfile({ displayName: name });
      await createdUser.reload();

      setStatus('アカウント名を確定しています…');
      const claimResult = await claimName(name, createdUser.uid, createdUser.email || email);
      if (!claimResult.ok) {
        try {
          await createdUser.delete();
        } catch (deleteError) {
          console.error('重複名のため作成したFirebaseユーザーの削除に失敗:', deleteError);
          await auth.signOut().catch(() => {});
        }
        setStatus('このアカウント名は登録中に他のアカウントで使用されました。別のアカウント名を入力してください。', true);
        return;
      }

      usernameInput.value = name;
      setStatus('✅ アカウントを作成しました。チャットへ移動しています…');
      window.__ruralSignupInProgress = false;
      window.dispatchEvent(new CustomEvent('rural-account-authenticated', {
        detail: { uid: createdUser.uid, username: name, email: createdUser.email || email }
      }));
    } catch (error) {
      console.error('Account registration failed:', error);
      if (createdUser) {
        await createdUser.delete().catch(() => {});
      }
      setStatus(
        error?.code === 'auth/email-already-in-use'
          ? 'このメールアドレスはすでに登録されています。ログインしてください。'
          : (error?.message || 'アカウント作成に失敗しました。'),
        true
      );
    } finally {
      signupInProgress = false;
      window.__ruralSignupInProgress = false;
    }
  }

  // auth.jsにある通常の新規登録処理を、重複アカウント名を確認する処理へ置き換えます。
  document.addEventListener('click', event => {
    const button = event.target.closest('#email-signup-btn');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void registerAccount();
  }, true);

  // auth.jsがログイン完了時に発火するイベントを、新規登録処理中だけ止めます。
  window.addEventListener('rural-account-authenticated', event => {
    if (window.__ruralSignupInProgress) event.stopImmediatePropagation();
  }, true);

  async function enterChat(username) {
    const cleanUsername = String(username || '').normalize('NFC').trim().slice(0, 20);
    if (!cleanUsername || !chatMain.hidden) return;
    if (joiningUsername === cleanUsername) return;

    joiningUsername = cleanUsername;
    usernameInput.value = cleanUsername;
    setStatus('アカウントで自動的にチャットへ参加しています…');
    joinBtn.click();
  }

  // メールログイン後のチャット参加はauth.jsの認証完了イベントから行います。
  // このリスナーは残し、ページ再読み込み時などにイベントが先に届かない場合を補助します。
  window.addEventListener('rural-account-authenticated', event => {
    if (signupInProgress || window.__ruralSignupInProgress) return;
    const user = window.ruralFirebaseAuth?.currentUser;
    void enterChat(event.detail?.username || user?.displayName || '');
  });

  const tryExistingUser = () => {
    if (signupInProgress || window.__ruralSignupInProgress) return;
    const user = window.ruralFirebaseAuth?.currentUser;
    if (user?.displayName) void enterChat(user.displayName);
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
