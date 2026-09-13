(() => {
  if (window.__ruralSignupHandlerFixInitialized) return;
  window.__ruralSignupHandlerFixInitialized = true;

  // auth.jsにも新規登録処理が登録されているため、対象ボタンだけを一度複製して
  // target側の古いclick listenerを消します。account-auto-login.jsのdocument capture
  // listenerは残るので、そちらの登録処理だけが実行されます。
  const replaceSignupButton = () => {
    const oldButton = document.getElementById('email-signup-btn');
    if (!oldButton || !oldButton.parentNode || oldButton.dataset.signupHandlerFixed === '1') return;
    const newButton = oldButton.cloneNode(true);
    newButton.dataset.signupHandlerFixed = '1';
    oldButton.replaceWith(newButton);
  };

  replaceSignupButton();
  window.setTimeout(replaceSignupButton, 0);
})();
