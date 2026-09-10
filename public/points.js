(() => {
  const headerUser = document.querySelector('.header-user');
  const onlineCount = document.getElementById('online-count');
  if (!headerUser || !onlineCount || typeof socket === 'undefined') return;

  const pointsEl = document.createElement('span');
  pointsEl.id = 'regional-points';
  pointsEl.className = 'regional-points';
  pointsEl.textContent = '⭐ 地域ポイント 0pt';
  headerUser.insertBefore(pointsEl, onlineCount);

  function setPoints(points) {
    const value = Number.isFinite(Number(points)) ? Math.max(0, Math.floor(Number(points))) : 0;
    pointsEl.textContent = `⭐ 地域ポイント ${value}pt`;
    pointsEl.title = '投稿者に実際の手伝いを確認してもらうと10pt獲得';
  }

  socket.on('region-points-updated', data => {
    if (!data || data.username !== currentUsername) return;
    setPoints(data.points);

    const earned = Number(data.earned || 0);
    if (earned > 0 && typeof setStatus === 'function') {
      setStatus(`🎉 投稿者が「来た！」と確認しました。地域ポイントを${earned}pt獲得しました！`);
    }
  });

  // Firebase Authentication のログイン画面を後から読み込みます。
  // client.js / points.js の既存動作を変えず、今までの「名前だけで参加」も残します。
  const authScript = document.createElement('script');
  authScript.src = '/auth.js';
  authScript.defer = true;
  authScript.onerror = () => console.error('Firebase Authentication script could not be loaded.');
  document.head.appendChild(authScript);
})();
