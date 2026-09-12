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

  // 「手伝える」は「イベント」と「助け合い」の投稿だけで表示します。
  // map-delete.js 側がポップアップを描画したあとに非対象の操作欄を除去します。
  const HELPABLE_EVENT_TYPES = new Set(['イベント', '助け合い']);

  function removeHelpControlFromMarker(marker) {
    if (!marker || HELPABLE_EVENT_TYPES.has(marker.__eventType)) return;
    const popupElement = marker.getPopup?.()?.getElement?.();
    const actions = popupElement?.querySelector?.('.map-pin-actions');
    if (!actions) return;
    actions.querySelector('.map-help-block')?.remove();
  }

  if (typeof map !== 'undefined' && map?.on) {
    map.on('popupopen', event => {
      setTimeout(() => removeHelpControlFromMarker(event?.popup?._source), 0);
    });
  }

  function refreshRestrictedHelpControl(id) {
    if (!id || typeof map === 'undefined') return;
    setTimeout(() => {
      map.eachLayer(layer => {
        if (layer?.__deleteMessageId === id) removeHelpControlFromMarker(layer);
      });
    }, 0);
  }

  socket.on('map-pin-help-updated', data => refreshRestrictedHelpControl(data?.id));
  socket.on('map-pin-help-confirmed', data => refreshRestrictedHelpControl(data?.id));

  // Firebase Authentication のログイン画面を後から読み込みます。
  // client.js / points.js の既存動作を変えず、今までの「名前だけで参加」も残します。
  const authScript = document.createElement('script');
  authScript.src = '/auth.js';
  authScript.defer = true;
  authScript.onerror = () => console.error('Firebase Authentication script could not be loaded.');
  document.head.appendChild(authScript);
})();
