(() => {
  if (window.__ruralThemeShopInitialized) return;
  window.__ruralThemeShopInitialized = true;

  const headerUser = document.querySelector('.header-user');
  if (!headerUser || typeof socket === 'undefined') return;

  // 「見た目変更」と「チャットの色」を統合した6色のテーマ。
  const themes = {
    forest: { name: '🌿 里山グリーン', description: '自然になじむ、見やすく落ち着いた緑', color: '#2f7d4a', cost: 0 },
    ocean: { name: '🌊 オーシャンブルー', description: '爽やかで信頼感のある青', color: '#2f78b7', cost: 40 },
    sakura: { name: '🌸 さくらピンク', description: 'やわらかく親しみやすいピンク', color: '#d85c86', cost: 50 },
    violet: { name: '🔮 ラベンダーバイオレット', description: '上品で落ち着いた紫', color: '#7357b8', cost: 60 },
    matsuri: { name: '🍊 あたたかオレンジ', description: '明るく元気な暖色系オレンジ', color: '#d97832', cost: 70 },
    night: { name: '🌙 ナイトネイビー', description: '暗い場所でも見やすい深いネイビー', color: '#315b86', cost: 80 }
  };

  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'theme-shop-btn';
  button.className = 'theme-shop-open';
  button.textContent = '🎨 見た目交換';
  button.title = '地域ポイントでチャット全体の色を交換';
  headerUser.insertBefore(button, headerUser.querySelector('#online-count'));

  const style = document.createElement('style');
  style.textContent = `
    .theme-shop-open{border:0;background:rgba(255,255,255,.15);color:#fff;padding:7px 11px;border-radius:999px;white-space:nowrap;cursor:pointer;font:inherit}
    .theme-shop-open:hover{background:rgba(255,255,255,.24)}
    .theme-shop-modal{position:fixed;inset:0;z-index:11000;display:none;align-items:center;justify-content:center;padding:16px}
    .theme-shop-modal.is-open{display:flex}
    .theme-shop-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.5)}
    .theme-shop-box{position:relative;width:min(760px,96vw);max-height:88vh;overflow:auto;background:#fff;border-radius:16px;padding:18px;box-shadow:0 18px 60px rgba(0,0,0,.32)}
    .theme-shop-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:6px}
    .theme-shop-head h2{margin:0;font-size:20px}
    .theme-shop-close{border:0;background:#eef2ee;color:#31513f;border-radius:999px;width:34px;height:34px;font-size:20px;cursor:pointer}
    .theme-shop-balance{padding:10px 12px;background:#f5f8f4;border-radius:10px;color:#31513f;font-weight:700;margin:10px 0 8px}
    .theme-shop-intro{margin:0 0 14px;color:#68796e;font-size:12px;line-height:1.5}
    .theme-shop-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
    .theme-card{border:1px solid #d9e2d6;border-radius:12px;padding:12px;background:#fff}
    .theme-card.current{border-width:2px}
    .theme-card h4{margin:0 0 4px;font-size:15px}
    .theme-card p{margin:0 0 9px;color:#68796e;font-size:12px;line-height:1.45}
    .theme-card button{width:100%;border:0;border-radius:8px;padding:9px 10px;background:#234d3c;color:#fff;font:inherit;cursor:pointer}
    .theme-card button.secondary{background:#eef2ee;color:#31513f}
    .theme-card button:disabled{opacity:.6;cursor:default}
    .theme-card .theme-owned{font-size:11px;color:#2d8a57;font-weight:700;margin-bottom:7px}
    .theme-card .theme-current{font-size:11px;font-weight:800;margin-bottom:7px}
    .theme-swatch{height:54px;border-radius:9px;margin:0 0 10px;border:1px solid rgba(0,0,0,.08);box-shadow:inset 0 0 0 999px rgba(255,255,255,.03)}
    .theme-shop-note{margin-top:12px;color:#68796e;font-size:11px;line-height:1.5}
    @media(max-width:760px){.theme-shop-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:480px){.theme-shop-grid{grid-template-columns:1fr}.theme-shop-box{padding:14px}}
  `;
  document.head.appendChild(style);

  const modal = document.createElement('div');
  modal.className = 'theme-shop-modal';
  modal.innerHTML = `
    <div class="theme-shop-backdrop"></div>
    <div class="theme-shop-box" role="dialog" aria-modal="true" aria-labelledby="theme-shop-title">
      <div class="theme-shop-head">
        <h2 id="theme-shop-title">🎨 見た目交換</h2>
        <button type="button" class="theme-shop-close" aria-label="閉じる">×</button>
      </div>
      <div id="theme-shop-balance" class="theme-shop-balance">⭐ 地域ポイント：0pt</div>
      <p class="theme-shop-intro">見た目とチャットの色を一つにまとめました。選んだ色が、チャット背景・投稿本文・オンラインユーザー欄・入力欄・ボタンなど全体の配色に反映されます。</p>
      <div id="theme-shop-grid" class="theme-shop-grid"></div>
      <div class="theme-shop-note">地域ポイントを使って新しい色を交換できます。交換済みの色は何度でも無料で切り替えられます。</div>
    </div>
  `;
  document.body.appendChild(modal);

  const balanceEl = modal.querySelector('#theme-shop-balance');
  const gridEl = modal.querySelector('#theme-shop-grid');
  let state = { points: 0, themes: ['forest'], currentTheme: 'forest', chatColors: ['forest'], currentChatColor: 'forest' };
  let catalog = { ...themes };
  let exchangeInFlight = false;

  const applyUnifiedTheme = id => {
    const safe = themes[id] ? id : 'forest';
    document.body.dataset.ruralTheme = safe;
    document.body.dataset.ruralChatColor = safe;
    localStorage.setItem('rural-theme', safe);
    localStorage.setItem('rural-chat-color', safe);
  };

  const status = text => { if (typeof setStatus === 'function') setStatus(text); };

  function render() {
    balanceEl.textContent = `⭐ 地域ポイント：${Math.max(0, Math.floor(Number(state.points || 0)))}pt`;
    gridEl.innerHTML = Object.entries(catalog).map(([id, info]) => {
      const owned = state.themes.includes(id) || state.chatColors.includes(id);
      const current = state.currentTheme === id || state.currentChatColor === id;
      const cost = id === 'forest' ? '無料' : `${Number(info.cost || 0)}pt`;
      const buttonText = current ? '✅ 使用中' : owned ? 'この色を使う' : `⭐ ${cost}で交換`;
      const swatch = info.color || '#2f7d4a';
      return `
        <div class="theme-card${current ? ' current' : ''}" style="${current ? `border-color:${swatch}` : ''}">
          <div class="theme-swatch" style="background:${swatch}"></div>
          <h4>${info.name}</h4>
          <p>${info.description || ''}</p>
          ${owned ? '<div class="theme-owned">✓ 交換済み</div>' : ''}
          ${current ? '<div class="theme-current" style="color:'+swatch+'">現在選択中</div>' : ''}
          <button type="button" data-theme-id="${id}" class="${owned && !current ? 'secondary' : ''}" ${current || exchangeInFlight ? 'disabled' : ''}>${buttonText}</button>
        </div>`;
    }).join('');
  }

  function finish(result, fallback) {
    exchangeInFlight = false;
    if (!result?.ok) {
      if (result?.reason === 'insufficient-points') {
        status(`⭐ 地域ポイントが足りません（必要 ${Number(result.cost || 0)}pt / 所持 ${Number(result.points || 0)}pt）`);
      } else if (result?.reason === 'timeout') {
        status('⚠️ サーバーからの応答がタイムアウトしました。交換状態を確認してください。');
      } else {
        status(fallback);
      }
      render();
      return;
    }

    state = {
      points: Number(result.points ?? state.points),
      themes: Array.isArray(result.themes) ? result.themes : state.themes,
      currentTheme: result.currentTheme || state.currentTheme,
      chatColors: Array.isArray(result.chatColors) ? result.chatColors : state.chatColors,
      currentChatColor: result.currentChatColor || result.currentTheme || state.currentChatColor
    };
    applyUnifiedTheme(state.currentTheme || state.currentChatColor);
    render();
    status('✅ 見た目を変更しました。');
  }

  function sendExchange(eventName, payload, triggerButton, fallback) {
    exchangeInFlight = true;
    if (triggerButton) triggerButton.textContent = '⏳ 処理中…';
    render();
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      finish({ ok: false, reason: 'timeout' }, fallback);
    }, 20000);

    socket.emit(eventName, payload, result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finish(result, fallback);
    });
  }

  button.addEventListener('click', () => { modal.classList.add('is-open'); render(); });
  modal.querySelector('.theme-shop-backdrop').addEventListener('click', () => modal.classList.remove('is-open'));
  modal.querySelector('.theme-shop-close').addEventListener('click', () => modal.classList.remove('is-open'));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') modal.classList.remove('is-open'); });

  gridEl.addEventListener('click', e => {
    const b = e.target.closest('[data-theme-id]');
    if (!b || exchangeInFlight) return;
    const id = b.dataset.themeId;
    if (!currentUsername || !socket.connected) return status('先にチャットへ参加してください。');
    const owned = state.themes.includes(id) || state.chatColors.includes(id);
    const current = state.currentTheme === id || state.currentChatColor === id;
    if (current) return;
    status(owned ? '🎨 色を切り替えています…' : '⭐ 地域ポイントで色を交換しています…');
    sendExchange(owned ? 'select-theme' : 'exchange-theme', { themeId: id }, b, '⚠️ 見た目の変更に失敗しました。もう一度試してください。');
  });

  socket.on('theme-state', data => {
    if (!data || data.username !== currentUsername) return;
    state = {
      points: Number(data.points || 0),
      themes: Array.isArray(data.themes) ? data.themes : ['forest'],
      currentTheme: data.currentTheme || data.currentChatColor || 'forest',
      chatColors: Array.isArray(data.chatColors) ? data.chatColors : (Array.isArray(data.themes) ? data.themes : ['forest']),
      currentChatColor: data.currentChatColor || data.currentTheme || 'forest'
    };
    catalog = data.catalog && typeof data.catalog === 'object' ? data.catalog : catalog;
    applyUnifiedTheme(state.currentTheme);
    exchangeInFlight = false;
    render();
  });

  socket.on('region-points-updated', data => {
    if (!data || data.username !== currentUsername) return;
    state.points = Math.max(0, Math.floor(Number(data.points || 0)));
    render();
  });

  const savedTheme = localStorage.getItem('rural-theme');
  const savedChatColor = localStorage.getItem('rural-chat-color');
  const saved = themes[savedTheme] ? savedTheme : (themes[savedChatColor] ? savedChatColor : 'forest');
  applyUnifiedTheme(saved);
  render();
})();