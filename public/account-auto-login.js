(() => {
  const usernameInput = document.getElementById('username-input');
  const joinBtn = document.getElementById('join-btn');
  const setupPanel = document.getElementById('setup-panel');
  const chatMain = document.getElementById('chat-main');
  const statusEl = document.getElementById('status');
  if (!usernameInput || !joinBtn || !setupPanel || !chatMain) return;

  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyAQk0FwLApOl0w7KsHGsgbStO3DFnC0tOE',
    authDomain: 'inakachat-29b24.firebaseapp.com',
    projectId: 'inakachat-29b24',
    storageBucket: 'inakachat-29b24.firebasestorage.app',
    messagingSenderId: '144875359478',
    appId: '1:144875359478:web:775f496fdb659a1098b0d7',
    measurementId: 'G-CMSLDR94M4'
  };

  let joiningUsername = '';
  let signupInProgress = false;
  let firebaseReadyPromise = null;

  function setStatus(message, error = false) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.style.color = error ? '#a52d2d' : '';
  }

  function getAccountField(id) {
    return document.getElementById(id);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === '1') return resolve();
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', () => reject(new Error(`Firebase SDKの読み込みに失敗しました: ${src}`)), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.addEventListener('load', () => { script.dataset.loaded = '1'; resolve(); }, { once: true });
      script.addEventListener('error', () => reject(new Error(`Firebase SDKの読み込みに失敗しました: ${src}`)), { once: true });
      document.head.appendChild(script);
    });
  }

  async function ensureAuthForSignup() {
    if (window.ruralFirebaseAuth) return window.ruralFirebaseAuth;
    if (firebaseReadyPromise) return firebaseReadyPromise;

    firebaseReadyPromise = (async () => {
      if (!window.firebase?.auth) {
        await loadScript('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js');
        await loadScript('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth-compat.js');
      }
      if (!window.firebase) throw new Error('Firebase SDKを初期化できませんでした。');
      if (!window.firebase.apps.length) window.firebase.initializeApp(FIREBASE_CONFIG);
      window.ruralFirebaseAuth = window.firebase.auth();
      window.ruralFirebaseAuth.useDeviceLanguage();
      return window.ruralFirebaseAuth;
    })();

    try {
      return await firebaseReadyPromise;
    } finally {
      firebaseReadyPromise = null;
    }
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

  function firebaseSignupError(error) {
    const code = error?.code || '';
    const messages = {
      'auth/operation-not-allowed': 'メールアドレス／パスワードのログインがFirebaseで有効になっていません。',
      'auth/invalid-email': 'メールアドレスの形式が正しくありません。',
      'auth/missing-password': 'パスワードを入力してください。',
      'auth/weak-password': 'パスワードが弱すぎます。より安全なパスワードを設定してください。',
      'auth/email-already-in-use': 'このメールアドレスはすでに登録されています。ログインしてください。',
      'auth/invalid-api-key': 'Firebaseの設定を確認できませんでした。',
      'auth/unauthorized-domain': 'このサイトのドメインがFirebase Authenticationの承認済みドメインに登録されていません。',
      'auth/network-request-failed': 'ネットワークエラーが発生しました。通信状態を確認してください。'
    };
    return messages[code] || error?.message || 'アカウント作成に失敗しました。';
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
    if (!email || !password) return setStatus('メールアドレスとパスワードを入力してください。', true);

    signupInProgress = true;
    window.__ruralSignupInProgress = true;
    setStatus('アカウント名の使用状況を確認しています…');

    let createdUser = null;
    try {
      const auth = await ensureAuthForSignup();

      const availability = await isNameAvailable(name);
      if (!availability.ok) {
        setStatus('アカウント名を確認できませんでした。しばらくしてから再試行してください。', true);
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
        try { await createdUser.delete(); }
        catch (deleteError) { console.error('Firebaseユーザーのロールバックに失敗:', deleteError); await auth.signOut().catch(() => {}); }
        setStatus(claimResult.reason === 'name-taken'
          ? 'このアカウント名は登録中に他のアカウントで使用されました。別のアカウント名を入力してください。'
          : 'アカウント名を確定できませんでした。アカウントは作成されていません。', true);
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
      if (createdUser) await createdUser.delete().catch(() => {});
      setStatus(firebaseSignupError(error), true);
    } finally {
      signupInProgress = false;
      window.__ruralSignupInProgress = false;
    }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('#email-signup-btn');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void registerAccount();
  }, true);

  // auth.js側に残っている古い新規登録click listenerを、対象ボタンだけ複製して除去します。
  // その後も上のdocument capture listenerは新しいボタンを受け取るため、登録処理は維持されます。
  const detachLegacySignupListener = () => {
    const oldButton = document.getElementById('email-signup-btn');
    if (!oldButton || !oldButton.parentNode || oldButton.dataset.signupHandlerFixed === '1') return;
    const newButton = oldButton.cloneNode(true);
    newButton.dataset.signupHandlerFixed = '1';
    oldButton.replaceWith(newButton);
  };
  detachLegacySignupListener();
  window.setTimeout(detachLegacySignupListener, 0);

  window.addEventListener('rural-account-authenticated', event => {
    if (window.__ruralSignupInProgress) {
      const username = String(event.detail?.username || '').normalize('NFC').trim().slice(0, 20);
      if (username && typeof socket !== 'undefined' && socket?.connected) {
        socket.emit('email-account-session', { username, uid: event.detail?.uid || '', email: event.detail?.email || '' });
      }
      event.stopImmediatePropagation();
    }
  }, true);

  async function enterChat(username) {
    const cleanUsername = String(username || '').normalize('NFC').trim().slice(0, 20);
    if (!cleanUsername || !chatMain.hidden) return;
    if (joiningUsername === cleanUsername) return;

    joiningUsername = cleanUsername;
    usernameInput.value = cleanUsername;
    if (typeof socket !== 'undefined' && socket?.connected) {
      socket.emit('email-account-session', {
        username: cleanUsername,
        uid: window.ruralFirebaseAuth?.currentUser?.uid || '',
        email: window.ruralFirebaseAuth?.currentUser?.email || ''
      });
    }
    setStatus('アカウントで自動的にチャットへ参加しています…');
    joinBtn.click();
  }

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
