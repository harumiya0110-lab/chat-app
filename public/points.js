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
    pointsEl.title = '人を助けたときにもらえる地域ポイント';
  }

  socket.on('region-points-updated', data => {
    if (!data || data.username !== currentUsername) return;
    setPoints(data.points);

    const earned = Number(data.earned || 0);
    if (earned > 0 && typeof setStatus === 'function') {
      setStatus(`🎉 「手伝える」で地域ポイントを${earned}pt獲得しました！`);
    }
  });
})();
