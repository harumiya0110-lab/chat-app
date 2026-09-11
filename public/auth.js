(() => {
  if (window.__ruralAuthInitialized) return;
  window.__ruralAuthInitialized = true;

  const CONFIG = {
    // Firebase Console > Project settings > General > Your apps > Web app > SDK setup and configuration
    apiKey: 'AIzaSyAQk0FwLApOl0w7KsHGsgbStO3DFnC0tOE',
    authDomain: 'inakachat-29b24.firebaseapp.com',
    projectId: 'inakachat-29b24',
    storageBucket: 'inakachat-29b24.firebasestorage.app',
    messagingSenderId: '144875359478',
    appId: '1:144875359478:web:cbf2b6413fd414cb98b0d7',
    measurementId: 'G-HSK5TPMF7N'
  };

  const setupPanel = document.getElementById('setup-panel');
  const usernameInput = document.getElementById('username-input');
  const joinBtn = document.getElementById('join-btn');
  const statusEl = document.getElementById('status');
  if (!setupPanel || !usernameInput || !joinBtn) return;

  const existing = setupPanel.querySelector('.account-login');
  if (existing) return;

  const style = document.createElement('style');
  style.textContent = `
    .account-login{width:min(390px,100%);padding:14px;border:1px solid #d6e1d3;border-radius:12px;background:rgba(255,255,255,.82);text-align:left}
    .account-login h3{margin:0 0 8px;font-size:15px}
    .account-login p{margin:0 0 10px;color:#68796e;font-size:12px;line-height:1.5}
    .account-login input{width:100%;padding:9px 11px;border:1px solid #b9c9b8;border-radius:8px;font:inherit}
    .account-row{display:flex;gap:7px;margin-top:7px}
    .account-login button{flex:1;min-width:0;padding:9px 10px;border:1px solid #b9c9b8;border-radius:8px;background:#fff;color:#234d3c;cursor:pointer;font:inherit}
    .account-login .account-signout{background:#f7e9e9;color:#8d3333;border-color:#e7bcbc}
    .account-login .account-note{margin-top:8px;font-size:11px;color:#68796e;line-height:1.5}
    .account-login .account-status{margin-top:8px;font-size:12px;line-height:1.45;color:#234d3c}
    .account-error{color:#a52d2d!important}
  `;
  document.head.appendChild(style);

  const accountBox = document.createElement('div');
  accountBox.className = 'account-login';
  accountBox.innerHTML = `
    <h3>🔐 メールアドレスでログイン</h3>
    <p>新規登録時にアカウント名を決めます。次回からはメールアドレスとパスワードだけで自動的にチャットへ入れます。</p>
    <input id="account-name" type="text" maxlength="20" autocomplete="nickname" placeholder="アカウント名（新規登録時のみ）">
    <input id="account-email" type="email" autocomplete="email" placeholder="メールアドレス" style="margin-top:7px">
    <input id="account-password" type="password" autocomplete="current-password" placeholder="パスワード" style="margin-top:7px">
    <div class="account-row">
      <button id="email-login-btn" type="button">メールでログイン</button>
      <button id="email-signup-btn" type="button">新規登録</button>
    </div>
    <div id="account-status" class="account-status"></div>
    <div id="account-actions" class="account-row" hidden>
      <button id="account-signout-btn" type="button" class="account-signout">ログアウト</button>
    </div>
    <div class="account-note">名前だけでの参加も今までどおり利用できます。アカウントログインでは登録したアカウント名がチャットの名前になります。</div>
  `;
  setupPanel.appendChild(accountBox);

  const accountNameInput = accountBox.querySelector('#account-name');
  const emailInput = accountBox.querySelector('#account-email');
  const passwordInput = accountBox.querySelector('#account-password');
  const emailLoginBtn = accountBox.querySelector('#email-login-btn');
  const emailSignupBtn = accountBox.querySelector('#email-signup-btn');
  const signoutBtn = accountBox.querySelector('#account-signout-btn');
  const accountStatus = accountBox.querySelector('#account-status');
  const accountActions = accountBox.querySelector('#account-actions');

  function setAccountStatus(text, error = false) {
    accountStatus.textContent = text;
    accountStatus.classList.toggle('account-error', error);
    if (statusEl && text) statusEl.textContent = text;
  }

  function setChatName(user) {
    const name = String(user?.displayName || '').trim().slice(0, 20);
    if (name) {
      usernameInput.value = name;
      return name;
    }
    return '';
  }

  function announceAuthenticated(user, message = 'ログインしました。チャットへ移動しています…') {
    const name = setChatName(user);
    if (!name) {
      setAccountStatus('アカウント名が設定されていません。いったんログアウトして再登録してください。', true);
      return;
    }
    setAccountStatus(message);
    window.dispatchEvent(new CustomEvent('rural-account-authenticated', {
      detail: { uid: user.uid, username: name, email: user.email || '' }
    }));
  }

  function friendlyError(error) {
    const code = error?.code || '';
    const messages = {
      'auth/operation-not-allowed': 'メールアドレス／パスワードのログインがFirebaseで有効になっていません。',
      'auth/invalid-email': 'メールアドレスの形式が正しくありません。',
      'auth/missing-password': 'パスワードを入力してください。',
      'auth/weak-password': 'パスワードが弱すぎます。より安全なパスワードを設定してください。',
      'auth/email-already-in-use': 'このメールアドレスはすでに登録されています。ログインしてください。',
      'auth/invalid-credential': 'メールアドレスまたはパスワードが正しくありません。',
      'auth/user-not-found': 'このメールアドレスのアカウントが見つかりません。',
      'auth/invalid-api-key': 'Firebase Web APIキーが正しく設定されていません。',
      'auth/unauthorized-domain': 'このサイトのドメインがFirebase Authenticationの承認済みドメインに登録されていません。'
    };
    return messages[code] || `ログインに失敗しました${code ? `（${code}）` : ''}`;
  }

  function setButtonsDisabled(disabled) {
    [emailLoginBtn, emailSignupBtn].forEach(button => { button.disabled = disabled; });
  }

  async function ensureFirebase() {
    if (window.firebase?.auth) return;

    const load = (src) => new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Firebase SDKの読み込みに失敗しました: ${src}`));
      document.head.appendChild(script);
    });

    await load('https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js');
    await load('https://www.gstatic.com/firebasejs/12.18.0/firebase-auth-compat.js');

    if (!window.firebase.apps.length) {
      window.firebase.initializeApp(CONFIG);
    }
    window.ruralFirebaseAuth = window.firebase.auth();
    window.ruralFirebaseAuth.useDeviceLanguage();

    window.ruralFirebaseAuth.onAuthStateChanged(user => {
      if (!user) {
        accountStatus.textContent = '';
        accountStatus.classList.remove('account-error');
        accountActions.hidden = true;
        return;
      }
      setChatName(user);
      accountStatus.textContent = `✅ ログイン中：${user.email || 'アカウント'} / ${user.displayName || '名前未設定'}`;
      accountStatus.classList.remove('account-error');
      accountActions.hidden = false;
      announceAuthenticated(user, '✅ ログイン済みです。チャットへ移動しています…');
    });
  }

  async function signInEmail() {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) return setAccountStatus('メールアドレスとパスワードを入力してください。', true);
    setButtonsDisabled(true);
    setAccountStatus('メールでログインしています…');
    try {
      await ensureFirebase();
      const result = await window.ruralFirebaseAuth.signInWithEmailAndPassword(email, password);
      const name = setChatName(result.user);
      if (!name) throw new Error('アカウント名が登録されていません。');
      announceAuthenticated(result.user, '✅ メールアドレスでログインしました。チャットへ移動しています…');
    } catch (error) {
      console.error(error);
      setAccountStatus(friendlyError(error), true);
    } finally {
      setButtonsDisabled(false);
    }
  }

  async function signUpEmail() {
    const accountName = accountNameInput.value.trim();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!accountName) return setAccountStatus('新規登録時はアカウント名を入力してください。', true);
    if (accountName.length > 20) return setAccountStatus('アカウント名は20文字以内にしてください。', true);
    if (!email || !password) return setAccountStatus('メールアドレスとパスワードを入力してください。', true);
    setButtonsDisabled(true);
    setAccountStatus('アカウントを作成しています…');
    try {
      await ensureFirebase();
      const result = await window.ruralFirebaseAuth.createUserWithEmailAndPassword(email, password);
      await result.user.updateProfile({ displayName: accountName });
      await result.user.reload();
      setChatName(window.ruralFirebaseAuth.currentUser);
      announceAuthenticated(window.ruralFirebaseAuth.currentUser, '✅ アカウントを作成しました。チャットへ移動しています…');
    } catch (error) {
      console.error(error);
      setAccountStatus(friendlyError(error), true);
    } finally {
      setButtonsDisabled(false);
    }
  }

  emailLoginBtn.addEventListener('click', signInEmail);
  emailSignupBtn.addEventListener('click', signUpEmail);
  signoutBtn.addEventListener('click', async () => {
    try {
      await ensureFirebase();
      await window.ruralFirebaseAuth.signOut();
      usernameInput.value = '';
      accountNameInput.value = '';
      setAccountStatus('ログアウトしました。名前だけで参加することもできます。');
    } catch (error) {
      console.error(error);
      setAccountStatus(friendlyError(error), true);
    }
  });

  ensureFirebase().catch(error => {
    console.warn('Firebase Authentication is not configured yet:', error.message);
    accountStatus.textContent = 'Firebase Authenticationの初期化に失敗しました。Firebase Consoleの設定を確認してください。';
  });
})();
