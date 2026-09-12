(() => {
  if (window.__ruralAuthInitialized) return;
  window.__ruralAuthInitialized = true;

  const CONFIG = {
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
    .account-login input{width:100%;padding:9px 11px;border:1px solid #b9c9b8;border-radius:8px;font:inherit;box-sizing:border-box}
    .account-row{display:flex;gap:7px;margin-top:7px}
    .account-login button{flex:1;min-width:0;padding:9px 10px;border:1px solid #b9c9b8;border-radius:8px;background:#fff;color:#234d3c;cursor:pointer;font:inherit}
    .account-login button:hover:not(:disabled){background:#f4f8f2}
    .account-login button:disabled{opacity:.55;cursor:wait}
    .account-login .account-signout{background:#f7e9e9;color:#8d3333;border-color:#e7bcbc}
    .account-login .account-note{margin-top:8px;font-size:11px;color:#68796e;line-height:1.5}
    .account-login .account-status{margin-top:8px;font-size:12px;line-height:1.45;color:#234d3c}
    .account-login .account-reset{margin-top:7px;width:100%;background:#f5f8f3}
    .account-error{color:#a52d2d!important}
    .auth-choice{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
    .auth-choice button{padding:12px 10px;font-weight:700;border-radius:10px}
    .auth-choice .auth-login-choice{background:#234d3c;color:#fff;border-color:#234d3c}
    .auth-choice .auth-signup-choice{background:#fff;color:#234d3c;border-color:#b9c9b8}
    .auth-view{margin-top:10px}
    .auth-back{width:100%;margin-top:8px;background:#eef2ee!important;color:#31513f!important}
    .auth-view[hidden]{display:none}
    @media(max-width:430px){.auth-choice{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  const accountBox = document.createElement('div');
  accountBox.className = 'account-login';
  accountBox.innerHTML = `
    <h3>🔐 アカウント</h3>
    <p>アカウントを作成すると、登録したメールアドレスとパスワードで次回からログインできます。</p>

    <div id="auth-choice" class="auth-choice">
      <button type="button" class="auth-login-choice">📩 ログイン</button>
      <button type="button" class="auth-signup-choice">✨ アカウント作成</button>
    </div>

    <div id="auth-login-view" class="auth-view" hidden>
      <input id="account-email-login" type="email" autocomplete="email" placeholder="メールアドレス">
      <input id="account-password-login" type="password" autocomplete="current-password" placeholder="パスワード" style="margin-top:7px">
      <div class="account-row">
        <button id="email-login-btn" type="button">メールでログイン</button>
        <button id="auth-login-back" type="button" class="auth-back">戻る</button>
      </div>
      <button id="password-reset-btn" type="button" class="account-reset">📩 パスワードを忘れた場合</button>
    </div>

    <div id="auth-signup-view" class="auth-view" hidden>
      <input id="account-name" type="text" maxlength="20" autocomplete="nickname" placeholder="アカウント名">
      <input id="account-email-signup" type="email" autocomplete="email" placeholder="メールアドレス" style="margin-top:7px">
      <input id="account-password-signup" type="password" autocomplete="new-password" placeholder="パスワード" style="margin-top:7px">
      <div class="account-row">
        <button id="email-signup-btn" type="button">アカウントを作成</button>
        <button id="auth-signup-back" type="button" class="auth-back">戻る</button>
      </div>
    </div>

    <div id="account-status" class="account-status"></div>
    <div id="account-actions" class="account-row" hidden>
      <button id="account-signout-btn" type="button" class="account-signout">ログアウト</button>
    </div>
    <div class="account-note">アカウントを使わず、名前だけで参加することもできます。</div>
  `;
  setupPanel.appendChild(accountBox);

  const choice = accountBox.querySelector('#auth-choice');
  const loginView = accountBox.querySelector('#auth-login-view');
  const signupView = accountBox.querySelector('#auth-signup-view');
  const loginChoiceBtn = accountBox.querySelector('.auth-login-choice');
  const signupChoiceBtn = accountBox.querySelector('.auth-signup-choice');
  const loginBackBtn = accountBox.querySelector('#auth-login-back');
  const signupBackBtn = accountBox.querySelector('#auth-signup-back');

  const accountNameInput = accountBox.querySelector('#account-name');
  const emailLoginInput = accountBox.querySelector('#account-email-login');
  const passwordLoginInput = accountBox.querySelector('#account-password-login');
  const emailSignupInput = accountBox.querySelector('#account-email-signup');
  const passwordSignupInput = accountBox.querySelector('#account-password-signup');
  const emailLoginBtn = accountBox.querySelector('#email-login-btn');
  const emailSignupBtn = accountBox.querySelector('#email-signup-btn');
  const passwordResetBtn = accountBox.querySelector('#password-reset-btn');
  const signoutBtn = accountBox.querySelector('#account-signout-btn');
  const accountStatus = accountBox.querySelector('#account-status');
  const accountActions = accountBox.querySelector('#account-actions');

  function showChoice() {
    choice.hidden = false;
    loginView.hidden = true;
    signupView.hidden = true;
  }

  function showLogin() {
    choice.hidden = true;
    loginView.hidden = false;
    signupView.hidden = true;
    setAccountStatus('');
    emailLoginInput.focus();
  }

  function showSignup() {
    choice.hidden = true;
    loginView.hidden = true;
    signupView.hidden = false;
    setAccountStatus('');
    accountNameInput.focus();
  }

  loginChoiceBtn.addEventListener('click', showLogin);
  signupChoiceBtn.addEventListener('click', showSignup);
  loginBackBtn.addEventListener('click', showChoice);
  signupBackBtn.addEventListener('click', showChoice);

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
      'auth/unauthorized-domain': 'このサイトのドメインがFirebase Authenticationの承認済みドメインに登録されていません。',
      'auth/too-many-requests': '試行回数が多すぎます。しばらく待ってから再試行してください。'
    };
    return messages[code] || `ログインに失敗しました${code ? `（${code}）` : ''}`;
  }

  function setButtonsDisabled(disabled) {
    [emailLoginBtn, emailSignupBtn, passwordResetBtn, loginChoiceBtn, signupChoiceBtn, loginBackBtn, signupBackBtn].forEach(button => { button.disabled = disabled; });
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

    if (!window.firebase.apps.length) window.firebase.initializeApp(CONFIG);
    window.ruralFirebaseAuth = window.firebase.auth();
    window.ruralFirebaseAuth.useDeviceLanguage();

    window.ruralFirebaseAuth.onAuthStateChanged(user => {
      if (!user) {
        accountStatus.textContent = '';
        accountStatus.classList.remove('account-error');
        accountActions.hidden = true;
        showChoice();
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
    const email = emailLoginInput.value.trim();
    const password = passwordLoginInput.value;
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
    const email = emailSignupInput.value.trim();
    const password = passwordSignupInput.value;
    if (!accountName) return setAccountStatus('アカウント名を入力してください。', true);
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

  async function sendPasswordReset() {
    const email = emailLoginInput.value.trim();
    if (!email) return setAccountStatus('パスワード変更メールを送るメールアドレスを入力してください。', true);
    setButtonsDisabled(true);
    setAccountStatus('パスワード変更メールを送信しています…');
    try {
      await ensureFirebase();
      await window.ruralFirebaseAuth.sendPasswordResetEmail(email);
      passwordLoginInput.value = '';
      setAccountStatus('✅ パスワード変更メールを送信しました。メールに記載されたリンクから新しいパスワードを設定してください。');
    } catch (error) {
      console.error(error);
      const code = error?.code || '';
      if (code === 'auth/user-not-found') setAccountStatus('このメールアドレスのアカウントが見つかりません。', true);
      else setAccountStatus(friendlyError(error), true);
    } finally {
      setButtonsDisabled(false);
    }
  }

  emailLoginBtn.addEventListener('click', signInEmail);
  emailSignupBtn.addEventListener('click', signUpEmail);
  passwordResetBtn.addEventListener('click', sendPasswordReset);
  signoutBtn.addEventListener('click', async () => {
    try {
      await ensureFirebase();
      await window.ruralFirebaseAuth.signOut();
      usernameInput.value = '';
      accountNameInput.value = '';
      emailLoginInput.value = '';
      passwordLoginInput.value = '';
      emailSignupInput.value = '';
      passwordSignupInput.value = '';
      setAccountStatus('ログアウトしました。');
      showChoice();
    } catch (error) {
      console.error(error);
      setAccountStatus(friendlyError(error), true);
    }
  });

  ensureFirebase().catch(error => {
    console.warn('Firebase Authentication is not configured yet:', error.message);
    setAccountStatus('Firebase Authenticationの初期化に失敗しました。Firebase Consoleの設定を確認してください。', true);
  });
})();
