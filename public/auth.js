(() => {
  if (window.__ruralAuthInitialized) return;
  window.__ruralAuthInitialized = true;

  const CONFIG = {
    apiKey: 'AIzaSyAQk0FwLAp0lw7KsHGsgbStO3DFnC0tOE',
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
  const headerSignoutBtn = document.getElementById('header-signout-btn');
  if (!setupPanel || !usernameInput || !joinBtn) return;

  const existing = setupPanel.querySelector('.account-login');
  if (existing) return;

  const style = document.createElement('style');
  style.textContent = `
    .setup-panel{position:relative;overflow:auto;min-height:650px;padding:34px 24px 42px;justify-content:flex-start;gap:0;background:linear-gradient(145deg,#f7faf5 0%,#e8f0e5 100%)}
    .setup-panel::before{content:"";position:absolute;width:260px;height:260px;border-radius:50%;background:rgba(255,255,255,.42);top:-110px;right:-90px;pointer-events:none}
    .setup-welcome{position:relative;z-index:1;width:min(500px,100%);text-align:center;margin:8px auto 18px}
    .setup-welcome-badge{display:inline-flex;align-items:center;gap:6px;padding:6px 11px;border-radius:999px;background:rgba(35,77,60,.09);color:#31513f;font-size:12px;font-weight:700;letter-spacing:.02em}
    .setup-welcome h2{margin:13px 0 7px;font-size:clamp(25px,4vw,34px);line-height:1.2;color:#234d3c}
    .setup-welcome p{margin:0;color:#64746b;font-size:13px;line-height:1.65}
    .guest-join{position:relative;z-index:1;width:min(500px,100%);margin:0 auto 14px;padding:16px;border:1px solid #d5e0d2;border-radius:14px;background:rgba(255,255,255,.8);box-shadow:0 5px 18px rgba(34,65,47,.06)}
    .guest-join-title{margin:0 0 9px;font-size:14px;font-weight:700;color:#2d4639}
    .guest-join-row{display:flex;gap:8px}
    .guest-join-row #username-input{flex:1;min-width:0;width:auto;padding:11px 13px;border:1px solid #b9c9b8;border-radius:9px;background:#fff}
    .guest-join-row #join-btn{flex:0 0 auto;min-width:96px;margin:0;padding:10px 14px;background:#234d3c}
    .guest-join-note{margin:8px 0 0;color:#76837b;font-size:11px;text-align:left;line-height:1.45}
    .account-login{position:relative;z-index:1;width:min(500px,100%);padding:18px;border:1px solid #d5e0d2;border-radius:14px;background:rgba(255,255,255,.94);text-align:left;box-shadow:0 8px 24px rgba(34,65,47,.08)}
    .account-login h3{margin:0;font-size:17px;color:#234d3c;text-align:center}
    .account-login>p{margin:6px auto 13px;max-width:400px;color:#68796e;font-size:12px;line-height:1.55;text-align:center}
    .auth-choice{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:13px}
    .auth-choice button{min-height:54px;padding:12px;font-size:14px;font-weight:700;border-radius:10px;transition:transform .15s ease,box-shadow .15s ease,background .15s ease}
    .auth-choice button:hover{transform:translateY(-1px);box-shadow:0 5px 14px rgba(35,77,60,.12)}
    .auth-choice .auth-login-choice{background:#234d3c;color:#fff;border-color:#234d3c}
    .auth-choice .auth-signup-choice{background:#f8fbf7;color:#234d3c;border-color:#bfd0bc}
    .auth-view{margin-top:12px;padding-top:12px;border-top:1px solid #e4ebe1}
    .auth-view input{display:block;width:100%;padding:11px 12px;border:1px solid #b9c9b8;border-radius:9px;background:#fff;font:inherit;outline:none}
    .auth-view input:focus,.guest-join-row #username-input:focus{border-color:#558266;box-shadow:0 0 0 3px rgba(85,130,102,.12)}
    .account-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:9px}
    .account-login button{min-width:0;padding:10px 12px;border:1px solid #b9c9b8;border-radius:9px;background:#fff;color:#234d3c;cursor:pointer;font:inherit}
    .account-login button:hover:not(:disabled){background:#f4f8f2}
    .account-login button:disabled{opacity:.55;cursor:wait}
    .account-login .account-signout{background:#f7e9e9;color:#8d3333;border-color:#e7bcbc}
    .account-login .account-note{margin-top:12px;text-align:center;font-size:11px;color:#728078;line-height:1.5}
    .account-login .account-status{margin-top:9px;padding:0 2px;font-size:12px;line-height:1.45;color:#234d3c;text-align:center}
    .account-login .account-reset{margin-top:8px;width:100%;background:#f5f8f3}
    .account-error{color:#a52d2d!important}
    .auth-back{background:#eef2ee!important;color:#31513f!important}
    .auth-view[hidden]{display:none}
    @media(max-width:650px){
      .setup-panel{padding:26px 14px 32px}
      .guest-join-row{flex-direction:column}
      .guest-join-row #join-btn{width:100%}
      .account-row{grid-template-columns:1fr}
    }
    @media(max-width:430px){
      .auth-choice{grid-template-columns:1fr}
      .setup-welcome h2{font-size:27px}
    }
  `;
  document.head.appendChild(style);

  const setupWelcome = document.createElement('div');
  setupWelcome.className = 'setup-welcome';
  setupWelcome.innerHTML = `
    <div class="setup-welcome-badge">🌿 地域コミュニティ</div>
    <h2>チャットマップへようこそ</h2>
    <p>地域の出来事を共有したり、困っている人を手伝ったりできる場所です。</p>
  `;
  setupPanel.insertBefore(setupWelcome, usernameInput.parentElement || usernameInput);

  const guestJoin = document.createElement('div');
  guestJoin.className = 'guest-join';
  guestJoin.innerHTML = `
    <div class="guest-join-title">👤 名前だけで参加</div>
    <div class="guest-join-row"></div>
    <div class="guest-join-note">アカウントを作成しなくても、ニックネームだけですぐ参加できます。</div>
  `;
  const guestRow = guestJoin.querySelector('.guest-join-row');
  guestRow.appendChild(usernameInput);
  guestRow.appendChild(joinBtn);
  setupPanel.appendChild(guestJoin);

  const accountBox = document.createElement('div');
  accountBox.className = 'account-login';
  accountBox.innerHTML = `
    <h3>🔐 アカウントを使う</h3>
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
    <div class="account-note">アカウントなしでも「名前だけで参加」できます。</div>
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
        if (headerSignoutBtn) headerSignoutBtn.hidden = true;
        showChoice();
        return;
      }
      setChatName(user);
      accountStatus.textContent = `✅ ログイン中：${user.email || 'アカウント'} / ${user.displayName || '名前未設定'}`;
      accountStatus.classList.remove('account-error');
      accountActions.hidden = false;
      if (headerSignoutBtn) {
        headerSignoutBtn.hidden = false;
        headerSignoutBtn.textContent = '🚪 ログアウト';
      }
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
      await window.ruralFirebaseAuth.signInWithEmailAndPassword(email, password);
      // ログイン完了後のチャット参加は onAuthStateChanged に一本化します。
      // ここでもannounceAuthenticatedを呼ぶと、同じソケットへ2回参加要求を送って
      // 「この名前は既に使用されています」と表示される原因になります。
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

  async function signOutAccount() {
    try {
      await ensureFirebase();
      if (headerSignoutBtn) headerSignoutBtn.disabled = true;
      if (signoutBtn) signoutBtn.disabled = true;
      await window.ruralFirebaseAuth.signOut();
      usernameInput.value = '';
      window.location.reload();
    } catch (error) {
      console.error(error);
      if (headerSignoutBtn) headerSignoutBtn.disabled = false;
      if (signoutBtn) signoutBtn.disabled = false;
      setAccountStatus(friendlyError(error), true);
    }
  }

  emailLoginBtn.addEventListener('click', signInEmail);
  emailSignupBtn.addEventListener('click', signUpEmail);
  passwordResetBtn.addEventListener('click', sendPasswordReset);
  signoutBtn.addEventListener('click', signOutAccount);
  headerSignoutBtn?.addEventListener('click', signOutAccount);

  window.addEventListener('rural-account-authenticated', event => {
    const name = String(event.detail?.username || '').trim();
    if (!name || typeof socket === 'undefined') return;
    window.__ruralSignupInProgress = false;
    usernameInput.value = name;
    joinBtn.click();
  });
})();
