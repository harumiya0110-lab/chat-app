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
    pointsEl.title = '毎日ログイン+3pt、チャット利用+1pt、地図付き投稿+5pt、助け合い確認+20pt';
  }

  socket.on('region-points-updated', data => {
    if (!data || data.username !== currentUsername) return;
    setPoints(data.points);

    const earned = Number(data.earned || 0);
    if (earned > 0 && typeof setStatus === 'function') {
      const messages = {
        'daily-login': `🎁 今日のログインで地域ポイントを${earned}pt獲得しました！`,
        'chat-use': `💬 チャットの利用で地域ポイントを${earned}pt獲得しました！`,
        'map-post': `📍 地域情報の投稿で地域ポイントを${earned}pt獲得しました！`,
        'help-confirmed': `🎉 実際の助け合いが確認され、地域ポイントを${earned}pt獲得しました！`
      };
      setStatus(messages[data.reason] || `⭐ 地域ポイントを${earned}pt獲得しました！`);
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

})();
