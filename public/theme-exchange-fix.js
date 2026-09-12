(() => {
  if (window.__ruralThemeExchangeFixInstalled) return;
  window.__ruralThemeExchangeFixInstalled = true;

  if (typeof socket === 'undefined') return;

  let exchangeInFlight = false;
  let lastState = null;

  socket.on('theme-state', state => {
    if (!state || state.username !== currentUsername) return;
    lastState = state;
    exchangeInFlight = false;
    syncButtons();
  });

  socket.on('region-points-updated', data => {
    if (!data || data.username !== currentUsername) return;
    if (lastState && Number.isFinite(Number(data.points))) {
      lastState.points = Math.max(0, Math.floor(Number(data.points)));
    }
    syncButtons();
  });

  function syncButtons() {
    const buttons = document.querySelectorAll('.theme-shop-modal [data-theme-id], .theme-shop-modal [data-color-id]');
    buttons.forEach(button => {
      if (exchangeInFlight) {
        button.disabled = true;
        return;
      }
      const themeId = button.dataset.themeId;
      const colorId = button.dataset.colorId;
      const owned = themeId
        ? Array.isArray(lastState?.themes) && lastState.themes.includes(themeId)
        : Array.isArray(lastState?.chatColors) && lastState.chatColors.includes(colorId);
      const current = themeId
        ? lastState?.currentTheme === themeId
        : lastState?.currentChatColor === colorId;
      button.disabled = Boolean(current);
      if (owned && !current) button.classList.add('secondary');
      if (!current && !owned) button.classList.remove('secondary');
    });
  }

  function showExchangeStatus(message) {
    if (typeof setStatus === 'function') setStatus(message);
  }

  function requestExchange(kind, id, button) {
    if (exchangeInFlight) return;
    if (!id) return;

    const isTheme = kind === 'theme';
    const owned = isTheme
      ? Array.isArray(lastState?.themes) && lastState.themes.includes(id)
      : Array.isArray(lastState?.chatColors) && lastState.chatColors.includes(id);
    const current = isTheme
      ? lastState?.currentTheme === id
      : lastState?.currentChatColor === id;

    if (current) return;

    exchangeInFlight = true;
    syncButtons();
    if (button) button.textContent = '⏳ 交換中…';
    showExchangeStatus(owned ? '見た目を切り替えています…' : '地域ポイントを確認して交換しています…');

    const eventName = isTheme ? 'exchange-theme' : 'exchange-chat-color';
    const payload = isTheme ? { themeId: id } : { colorId: id };

    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      exchangeInFlight = false;
      if (!result || result.ok !== true) {
        const reason = result?.reason;
        if (reason === 'insufficient-points') showExchangeStatus(`⭐ 地域ポイントが足りません（必要 ${Number(result.cost || 0)}pt / 所持 ${Number(result.points || 0)}pt）`);
        else showExchangeStatus('⚠️ 交換に失敗しました。もう一度試してください。');
      }
      syncButtons();
    };

    socket.timeout(12000).emit(eventName, payload, finish);

    window.setTimeout(() => {
      if (!settled) finish({ ok: false, reason: 'timeout' });
    }, 12500);
  }

  document.addEventListener('click', event => {
    const button = event.target.closest?.('.theme-shop-modal [data-theme-id], .theme-shop-modal [data-color-id]');
    if (!button || exchangeInFlight) return;

    const themeId = button.dataset.themeId;
    const colorId = button.dataset.colorId;
    const id = themeId || colorId;
    if (!id) return;

    const isTheme = Boolean(themeId);
    const owned = isTheme
      ? Array.isArray(lastState?.themes) && lastState.themes.includes(id)
      : Array.isArray(lastState?.chatColors) && lastState.chatColors.includes(id);
    const current = isTheme
      ? lastState?.currentTheme === id
      : lastState?.currentChatColor === id;

    if (current) return;
    if (owned) {
      // 所有済みの切り替えも同じ経路に統一し、連打による競合を防ぎます。
      event.preventDefault();
      event.stopImmediatePropagation();
      requestExchange(isTheme ? 'theme' : 'color', id, button);
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    requestExchange(isTheme ? 'theme' : 'color', id, button);
  }, true);

  const observer = new MutationObserver(() => syncButtons());
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(syncButtons, 0);
})();
