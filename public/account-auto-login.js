(() => {
  const usernameInput = document.getElementById('username-input');
  const joinBtn = document.getElementById('join-btn');
  const chatMain = document.getElementById('chat-main');
  const statusEl = document.getElementById('status');
  const accountStatusEl = document.getElementById('account-status');
  const accountNameInput = document.getElementById('account-name');
  const emailSignupInput = document.getElementById('account-email-signup');
  const passwordSignupInput = document.getElementById('account-password-signup');
  const emailSignupBtn = document.getElementById('email-signup-btn');
  if (!usernameInput || !joinBtn || !chatMain) return;

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
  let signupInFlight = false;

  function setStatus(message, error = false) {
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.style.color = error ? '#a52d2d' : '';
    }
    if (accountStatusEl) {
      accountStatusEl.textContent = message;
      accountStatusEl.classList.toggle('account-error', error);
    }
  }

  async function ensureFirebase() {
    if (window.firebase?.auth && window.ruralFirebaseAuth) return window.ruralFirebaseAuth;

    const load = src => new Promise((resolve, reject) => {
      if ([...document.scripts].some(script => script.src === src)) {
        const existing = [...document.scripts].find(script => script.src === src);
        if (window.firebase) return resolve();
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', () => reject(new Error(`Firebase SDKの読み込みに失敗しました: ${src}`)), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Firebase SDKの読み込みに失敗しました: ${src}`));
      document.head.appendChild(script);
    });

    await load('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js');
    await load('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth-compat.js');
    if (!window.firebase.apps.length) window.firebase.initializeApp(FIREBASE_CONFIG);
    window.ruralFirebaseAuth = window.firebase.auth();
    window.ruralFirebaseAuth.useDeviceLanguage();
    return window.ruralFirebaseAuth;
  }

  async function checkAccountName(name) {
    const clean = String(name || '').normalize('NFC').trim().slice(0, 20);
    if (!clean) return { ok: false, available: false, reason: 'invalid' };
    const response = await fetch(`/api/account-name/check?name=${encodeURIComponent(clean)}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`アカウント名確認に失敗しました（${response.status}）`);
    return response.json();
  }

  async function claimAccountName(name, uid, email) {
    const response = await fetch('/api/account-name/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ accountName: name, uid, email })
    });
    const result = await response.json().catch(() => ({ ok: false, reason: 'server-error' }));
    if (response.status === 409 && result?.reason === 'name-taken') return result;
    if (!response.ok) return { ok: false, reason: result?.reason || 'server-error' };
    return result;
  }

  function disableSignup(disabled) {
    if (emailSignupBtn) emailSignupBtn.disabled = disabled;
  }

  async function deleteCreatedUser(auth, user) {
    try {
      if (auth.currentUser?.uid === user?.uid) await user.delete();
    } catch (error) {
      console.error('[signup-name-policy] failed to delete rollback user:', error);
    }
    try {
      await auth.signOut();
    } catch (error) {
      console.error('[signup-name-policy] failed to sign out rollback user:', error);
    }
  }

  async function createAccountWithNamePolicy() {
    if (signupInFlight) return;
    const accountName = String(accountNameInput?.value || '').normalize('NFC').trim().slice(0, 20);
    const email = String(emailSignupInput?.value || '').trim();
    const password = String(passwordSignupInput?.value || '');

    if (!accountName) return setStatus('アカウント名を入力してください。', true);
    if (accountName.length > 20) return setStatus('アカウント名は20文字以内にしてください。', true);
    if (!email || !password) return setStatus('メールアドレスとパスワードを入力してください。', true);

    signupInFlight = true;
    window.__ruralSignupInProgress = true;
    disableSignup(true);
    setStatus('アカウント名を確認しています…');

    let auth = null;
    let createdUser = null;
    try {
      const availability = await checkAccountName(accountName);
      if (!availability?.ok) throw new Error('アカウント名を確認できませんでした。もう一度試してください。');
      if (availability.available === false) {
        setStatus('このアカウント名はすでにメールアドレスと連携されています。別のアカウント名を使用してください。', true);
        return;
      }

      auth = await ensureFirebase();
      setStatus('アカウントを作成しています…');
      const result = await auth.createUserWithEmailAndPassword(email, password);
      createdUser = result.user;
      await createdUser.updateProfile({ displayName: accountName });
      await createdUser.reload();

      setStatus('アカウント名を登録しています…');
      const claim = await claimAccountName(accountName, createdUser.uid, createdUser.email || email);
      if (!claim?.ok) {
        await deleteCreatedUser(auth, createdUser);
        if (claim?.reason === 'name-taken') {
          setStatus('このアカウント名は別のメールアドレスと連携されたため、使用できません。別のアカウント名を選んでください。', true);
          return;
        }
        throw new Error('アカウント名の登録に失敗しました。アカウント作成を取り消しました。');
      }

      usernameInput.value = accountName;
      setStatus('✅ アカウントを作成しました。チャットへ移動しています…');
      window.__ruralSignupInProgress = false;
      window.dispatchEvent(new CustomEvent('rural-account-authenticated', {
        detail: { uid: createdUser.uid, username: accountName, email: createdUser.email || email }
      }));
    } catch (error) {
      console.error('[signup-name-policy] signup failed:', error);
      if (createdUser) await deleteCreatedUser(auth, createdUser);
      const code = error?.code || '';
      const messages = {
        'auth/operation-not-allowed': 'メールアドレス／パスワードのログインがFirebaseで有効になっていません。',
        'auth/invalid-email': 'メールアドレスの形式が正しくありません。',
        'auth/missing-password': 'パスワードを入力してください。',
        'auth/weak-password': 'パスワードが弱すぎます。より安全なパスワードを設定してください。',
        'auth/email-already-in-use': 'このメールアドレスはすでに登録されています。ログインしてください。',
        'auth/too-many-requests': '試行回数が多すぎます。しばらく待ってから再試行してください。'
      };
      setStatus(messages[code] || error?.message || 'アカウント作成に失敗しました。', true);
    } finally {
      window.__ruralSignupInProgress = false;
      signupInFlight = false;
      disableSignup(false);
    }
  }

  // 新規登録ボタンはこのスクリプトで処理し、メール連携済みの名前を
  // Firebaseユーザー作成前に確実に拒否します。
  window.addEventListener('click', event => {
    const button = event.target.closest('#email-signup-btn');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void createAccountWithNamePolicy();
  }, true);

  // メール連携アカウントがチャットに入る前に、サーバーへ本人確認用の名前を伝えます。
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
    if (window.__ruralSignupInProgress) return;
    const username = String(event.detail?.username || '').normalize('NFC').trim().slice(0, 20);
    if (!username) return;
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
