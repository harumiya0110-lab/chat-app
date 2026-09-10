(() => {
  const CONFIG = {
    // Firebase Console > Project settings > General > Your apps > Web app > SDK setup and configuration
    // FirebaseのWeb APIキーはFirebaseサービス用の公開設定値です。Gemini APIキーとは別物です。
    apiKey: 'PASTE_FIREBASE_WEB_API_KEY_HERE',
    authDomain: 'inakachat-29b24.firebaseapp.com',
    projectId: 'inakachat-29b24',
    appId: 'PASTE_FIREBASE_WEB_APP_ID_HERE'
  };

  const setupPanel = document.getElementById('setup-panel');
  const usernameInput = document.getElementById('username-input');
  const joinBtn = document.getElementById('join-btn');
  const statusEl = document.getElementById('status');
  if (!setupPanel || !usernameInput || !joinBtn) return;

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
    <p>今までの「名前だけで参加」に加えて、メールアドレス＋パスワードでアカウントを作成・ログインできます。</p>
    <input id="account-email" type="email" autocomplete="email" placeholder="メールアドレス">
    <input id="account-password" type="password" autocomplete="current-password" placeholder="パスワード" style="margin-top:7px">
    <div class="account-row">
      <button id="email-login-btn" type="button">メールでログイン</button>
      <button id="email-signup-btn" type="button">新規登録</button>
    </div>
    <div id="account-status" class="account-status"></div>
    <div id="account-actions" class="account-row" hidden>
      <button id="account-signout-btn" type="button" class="account-signout">ログアウト</button>
    </div>
    <div class="account-note">アカウントログイン後、ニックネームを確認して「参加する」を押してください。名前だけでの参加も今までどおり利用できます。</div>
  `;
  setupPanel.appendChild(accountBox);

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

  function suggestNickname(user) {
    const suggested = String(user?.displayName || user?.email?.split('@')[0] || '').trim().slice(0, 20);
    if (suggested && !usernameInput.value.trim()) usernameInput.value = suggested;
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
    if (CONFIG.apiKey.startsWith('PASTE_') || CONFIG.appId.startsWith('PASTE_')) {
      throw new Error('Firebase WebアプリのapiKeyとappIdをpublic/auth.jsに設定してください。');
    }

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
        accountActions.hidden = true;
        return;
      }
      suggestNickname(user);
      accountStatus.textContent = `✅ ログイン中：${user.email || 'アカウント'}`;
      accountActions.hidden = false;
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
      suggestNickname(result.user);
      setAccountStatus('✅ メールアドレスでログインしました。ニックネームを確認して参加してください。');
    } catch (error) {
      console.error(error);
      setAccountStatus(friendlyError(error), true);
    } finally {
      setButtonsDisabled(false);
    }
  }

  async function signUpEmail() {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) return setAccountStatus('メールアドレスとパスワードを入力してください。', true);
    setButtonsDisabled(true);
    setAccountStatus('メールアカウントを作成しています…');
    try {
      await ensureFirebase();
      const result = await window.ruralFirebaseAuth.createUserWithEmailAndPassword(email, password);
      suggestNickname(result.user);
      setAccountStatus('✅ アカウントを作成しました。ニックネームを確認して参加してください。');
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
      setAccountStatus('ログアウトしました。名前だけで参加することもできます。');
    } catch (error) {
      console.error(error);
      setAccountStatus(friendlyError(error), true);
    }
  });

  ensureFirebase().catch(error => {
    console.warn('Firebase Authentication is not configured yet:', error.message);
    accountStatus.textContent = 'メールアカウントログインを使うにはFirebase Webアプリ設定が必要です。今までの名前だけでの参加はそのまま使えます。';
  });
})();
