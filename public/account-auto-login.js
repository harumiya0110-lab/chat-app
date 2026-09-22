(() => {
  // メール連携アカウントの本人情報だけをサーバーへ伝えます。
  // 新規登録処理そのものは auth.js に一本化し、二重クリック処理や
  // Firebaseの認証状態競合を起こさないようにします。
  const sendEmailAccountSession = event => {
    const username = String(event.detail?.username || '').normalize('NFC').trim().slice(0, 20);
    const uid = String(event.detail?.uid || '').trim();
    const email = String(event.detail?.email || '').trim();
    if (!username || !uid || typeof socket === 'undefined' || !socket?.connected) return;
    socket.emit('email-account-session', { username, uid, email });
  };

  window.addEventListener('rural-account-authenticated', sendEmailAccountSession, true);

  // auth.js の認証状態監視より先にSocket.IOが接続済みになるケースにも対応します。
  const retry = () => {
    const user = window.ruralFirebaseAuth?.currentUser;
    if (!user?.displayName || typeof socket === 'undefined' || !socket?.connected) return;
    socket.emit('email-account-session', {
      username: String(user.displayName).normalize('NFC').trim().slice(0, 20),
      uid: String(user.uid || '').trim(),
      email: String(user.email || '').trim()
    });
  };

  if (document.readyState === 'complete') {
    setTimeout(retry, 300);
  } else {
    window.addEventListener('load', () => setTimeout(retry, 300), { once: true });
  }
})();
