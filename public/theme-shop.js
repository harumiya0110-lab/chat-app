(() => {
  if (window.__ruralThemeShopInitialized) return;
  window.__ruralThemeShopInitialized = true;

  const headerUser = document.querySelector('.header-user');
  if (!headerUser || typeof socket === 'undefined') return;

  const themes = {
    forest: { name: '🟢 グリーン', description: '自然をイメージした緑色のテーマ', cost: 0 },
    sakura: { name: '🌸 ピンク', description: '春らしいやさしいピンク色のテーマ', cost: 50 },
    ocean: { name: '🔵 ブルー', description: '海と空をイメージした青色のテーマ', cost: 80 },
    night: { name: '🔷 ネイビー', description: '夜空をイメージした落ち着いた紺色のテーマ', cost: 100 },
    matsuri: { name: '🟠 オレンジ', description: 'お祭りをイメージした元気なオレンジ色のテーマ', cost: 150 }
  };
  const chatColors = {
    forest: { name: '🌿 里山グリーン', description: '自然をイメージした標準カラー', color: '#2f7d4a', cost: 0 },
    blue: { name: '🌊 青空ブルー', description: '明るく爽やかな青', color: '#2d78b8', cost: 30 },
    sakura: { name: '🌸 さくらピンク', description: 'やわらかく親しみやすいピンク', color: '#d85c86', cost: 40 },
    violet: { name: '🔮 バイオレット', description: '少し落ち着いた紫', color: '#7657b8', cost: 50 },
    sunset: { name: '🌇 夕焼けオレンジ', description: 'あたたかい夕焼け色', color: '#d97932', cost: 60 },
    ink: { name: '🌑 墨ブラック', description: '引き締まったシックな黒', color: '#333333', cost: 80 }
  };

  const button = document.createElement('button');
  button.type = 'button'; button.id = 'theme-shop-btn'; button.className = 'theme-shop-open';
  button.textContent = '🎨 見た目交換'; button.title = '地域ポイントでチャットの見た目を交換';
  headerUser.insertBefore(button, headerUser.querySelector('#online-count'));

  const style = document.createElement('style');
  style.textContent = `
    .theme-shop-open{border:0;background:rgba(255,255,255,.15);color:#fff;padding:7px 11px;border-radius:999px;white-space:nowrap;cursor:pointer;font:inherit}.theme-shop-open:hover{background:rgba(255,255,255,.24)}
    .theme-shop-modal{position:fixed;inset:0;z-index:11000;display:none;align-items:center;justify-content:center;padding:16px}.theme-shop-modal.is-open{display:flex}.theme-shop-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.5)}
    .theme-shop-box{position:relative;width:min(720px,96vw);max-height:88vh;overflow:auto;background:#fff;border-radius:16px;padding:18px;box-shadow:0 18px 60px rgba(0,0,0,.32)}.theme-shop-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:6px}.theme-shop-head h2{margin:0;font-size:20px}.theme-shop-close{border:0;background:#eef2ee;color:#31513f;border-radius:999px;width:34px;height:34px;font-size:20px;cursor:pointer}
    .theme-shop-balance{padding:10px 12px;background:#f5f8f4;border-radius:10px;color:#31513f;font-weight:700;margin:10px 0 14px}.theme-shop-section{margin-top:16px}.theme-shop-section h3{margin:0 0 8px;font-size:16px;color:#31513f}.theme-shop-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .theme-card{border:1px solid #d9e2d6;border-radius:12px;padding:12px;background:#fff}.theme-card h4{margin:0 0 4px;font-size:15px}.theme-card p{margin:0 0 9px;color:#68796e;font-size:12px;line-height:1.45}.theme-card button{width:100%;border:0;border-radius:8px;padding:9px 10px;background:#234d3c;color:#fff;font:inherit;cursor:pointer}.theme-card button.secondary{background:#eef2ee;color:#31513f}.theme-card button:disabled{opacity:.55;cursor:wait}.theme-card .theme-owned{font-size:11px;color:#2d8a57;font-weight:700;margin-bottom:7px}.chat-color-swatch{width:100%;height:30px;border-radius:8px;margin:0 0 8px;border:1px solid rgba(0,0,0,.08)}.theme-shop-note{margin-top:12px;color:#68796e;font-size:11px;line-height:1.5}@media(max-width:650px){.theme-shop-grid{grid-template-columns:1fr}.theme-shop-box{padding:14px}}
    body[data-rural-theme="sakura"]{background:#fff1f6!important;color:#4f3040!important}body[data-rural-theme="sakura"] .app-header{background:#8d4867!important}body[data-rural-theme="sakura"] .setup-panel{background:linear-gradient(145deg,#fff7fa,#f9dde8)!important}body[data-rural-theme="sakura"] .chat-panel,body[data-rural-theme="sakura"] .map-panel{border-color:#ecc5d4!important}body[data-rural-theme="sakura"] .users-panel{background:#fff7fa!important;border-color:#ecc5d4!important}body[data-rural-theme="sakura"] .message{background:#fff2f7!important}body[data-rural-theme="sakura"] .input-area,body[data-rural-theme="sakura"] .status{background:#fff7fa!important;border-color:#ecc5d4!important}
    body[data-rural-theme="ocean"]{background:#eaf6fb!important;color:#193b4a!important}body[data-rural-theme="ocean"] .app-header{background:#17617a!important}body[data-rural-theme="ocean"] .setup-panel{background:linear-gradient(145deg,#f2fbff,#d8eef7)!important}body[data-rural-theme="ocean"] .chat-panel,body[data-rural-theme="ocean"] .map-panel{border-color:#b8dae6!important}body[data-rural-theme="ocean"] .users-panel{background:#f2fbff!important;border-color:#b8dae6!important}body[data-rural-theme="ocean"] .message{background:#edf8fc!important}body[data-rural-theme="ocean"] .input-area,body[data-rural-theme="ocean"] .status{background:#f2fbff!important;border-color:#b8dae6!important}
    body[data-rural-theme="night"]{background:#151c24!important;color:#e9f0f4!important}body[data-rural-theme="night"] .app-header{background:#202f42!important}body[data-rural-theme="night"] .chat-panel,body[data-rural-theme="night"] .map-panel{background:#202b35!important;border-color:#3b4b59!important}body[data-rural-theme="night"] .setup-panel{background:linear-gradient(145deg,#23313d,#17232d)!important}body[data-rural-theme="night"] .users-panel{background:#1b2731!important;border-color:#3b4b59!important}body[data-rural-theme="night"] .users-panel li{background:#24313c!important;border-color:#3b4b59!important}body[data-rural-theme="night"] .messages{background:#202b35!important}body[data-rural-theme="night"] .message{background:#2a3742!important;color:#e9f0f4!important}body[data-rural-theme="night"] .input-area,body[data-rural-theme="night"] .status{background:#19242e!important;border-color:#3b4b59!important;color:#b9c8d0!important}body[data-rural-theme="night"] .input-area input{background:#26343f!important;color:#fff!important;border-color:#4a5c69!important}
    body[data-rural-theme="matsuri"]{background:#fff7e9!important;color:#4d3020!important}body[data-rural-theme="matsuri"] .app-header{background:#9b3f25!important}body[data-rural-theme="matsuri"] .setup-panel{background:linear-gradient(145deg,#fffaf0,#ffe4bd)!important}body[data-rural-theme="matsuri"] .chat-panel,body[data-rural-theme="matsuri"] .map-panel{border-color:#e8c89d!important}body[data-rural-theme="matsuri"] .users-panel{background:#fffaf0!important;border-color:#e8c89d!important}body[data-rural-theme="matsuri"] .message{background:#fff3d8!important}body[data-rural-theme="matsuri"] .input-area,body[data-rural-theme="matsuri"] .status{background:#fffaf0!important;border-color:#e8c89d!important}
    body[data-rural-chat-color="forest"]{--rural-chat:#2f7d4a}body[data-rural-chat-color="blue"]{--rural-chat:#2d78b8}body[data-rural-chat-color="sakura"]{--rural-chat:#d85c86}body[data-rural-chat-color="violet"]{--rural-chat:#7657b8}body[data-rural-chat-color="sunset"]{--rural-chat:#d97932}body[data-rural-chat-color="ink"]{--rural-chat:#333}.app-header{transition:border-color .15s ease}body[data-rural-chat-color] .app-header{border-bottom:4px solid var(--rural-chat)!important}body[data-rural-chat-color] .message.own{border-left:5px solid var(--rural-chat)!important}body[data-rural-chat-color] .send-button,body[data-rural-chat-color] #send-button{background:var(--rural-chat)!important;border-color:var(--rural-chat)!important}body[data-rural-chat-color] .chat-panel{border-top:3px solid var(--rural-chat)!important}
  `;
  document.head.appendChild(style);

  const modal = document.createElement('div');
  modal.className = 'theme-shop-modal';
  modal.innerHTML = `<div class="theme-shop-backdrop"></div><div class="theme-shop-box" role="dialog" aria-modal="true" aria-labelledby="theme-shop-title"><div class="theme-shop-head"><h2 id="theme-shop-title">🎨 地域ポイント交換所</h2><button type="button" class="theme-shop-close" aria-label="閉じる">×</button></div><div id="theme-shop-balance" class="theme-shop-balance">⭐ 地域ポイント：0pt</div><div class="theme-shop-section"><h3>🎨 チャット全体の見た目</h3><div id="theme-shop-grid" class="theme-shop-grid"></div></div><div class="theme-shop-section"><h3>💬 チャットの色</h3><div id="chat-color-grid" class="theme-shop-grid"></div></div><div class="theme-shop-note">地域ポイントは、他の人の「助け合い」投稿で実際に手伝い、投稿者から「来た！」と確認されると10pt獲得できます。購入済みの商品は何度でも無料で切り替えられます。</div></div>`;
  document.body.appendChild(modal);

  const balanceEl = modal.querySelector('#theme-shop-balance');
  const gridEl = modal.querySelector('#theme-shop-grid');
  const colorGridEl = modal.querySelector('#chat-color-grid');
  let state = { points: 0, themes: ['forest'], currentTheme: 'forest', chatColors: ['forest'], currentChatColor: 'forest' };
  let catalog = { ...themes };
  let colorCatalog = { ...chatColors };
  let exchangeInFlight = false;

  const applyTheme = id => { const safe = themes[id] ? id : 'forest'; document.body.dataset.ruralTheme = safe; localStorage.setItem('rural-theme', safe); };
  const applyChatColor = id => { const safe = colorCatalog[id] ? id : 'forest'; document.body.dataset.ruralChatColor = safe; localStorage.setItem('rural-chat-color', safe); };
  const status = text => { if (typeof setStatus === 'function') setStatus(text); };

  function render() {
    balanceEl.textContent = `⭐ 地域ポイント：${Math.max(0, Math.floor(Number(state.points || 0)))}pt`;
    gridEl.innerHTML = Object.entries(catalog).map(([id, info]) => {
      const owned = state.themes.includes(id), current = state.currentTheme === id;
      const cost = id === 'forest' ? '無料' : `${Number(info.cost)}pt`;
      const text = current ? '✅ 使用中' : owned ? 'この色を使う' : `⭐ ${cost}で交換`;
      return `<div class="theme-card"><h4>${info.name}</h4><p>${info.description || ''}</p>${owned ? '<div class="theme-owned">✓ 交換済み</div>' : ''}<button type="button" data-theme-id="${id}" class="${owned && !current ? 'secondary' : ''}" ${current ? 'disabled' : ''}>${text}</button></div>`;
    }).join('');
    colorGridEl.innerHTML = Object.entries(colorCatalog).map(([id, info]) => {
      const owned = state.chatColors.includes(id), current = state.currentChatColor === id;
      const cost = id === 'forest' ? '無料' : `${Number(info.cost)}pt`;
      const text = current ? '✅ 使用中' : owned ? 'この色を使う' : `⭐ ${cost}で交換`;
      return `<div class="theme-card"><div class="chat-color-swatch" style="background:${info.color}"></div><h4>${info.name}</h4><p>${info.description || ''}</p>${owned ? '<div class="theme-owned">✓ 交換済み</div>' : ''}<button type="button" data-color-id="${id}" class="${owned && !current ? 'secondary' : ''}" ${current ? 'disabled' : ''}>${text}</button></div>`;
    }).join('');
    gridEl.querySelectorAll('button,[data-theme-id]').forEach(b => b.disabled = exchangeInFlight || b.disabled);
    colorGridEl.querySelectorAll('button,[data-color-id]').forEach(b => b.disabled = exchangeInFlight || b.disabled);
  }

  function setBusy(button) { exchangeInFlight = true; if (button) button.textContent = '⏳ 処理中…'; render(); }
  function finish(result, fallback) {
    exchangeInFlight = false;
    if (!result?.ok) {
      if (result?.reason === 'insufficient-points') status(`⭐ 地域ポイントが足りません（必要 ${Number(result.cost || 0)}pt / 所持 ${Number(result.points || 0)}pt）`);
      else status(fallback);
    } else {
      state = {
        points: Number(result.points ?? state.points),
        themes: Array.isArray(result.themes) ? result.themes : state.themes,
        currentTheme: result.currentTheme || state.currentTheme,
        chatColors: Array.isArray(result.chatColors) ? result.chatColors : state.chatColors,
        currentChatColor: result.currentChatColor || state.currentChatColor
      };
      applyTheme(state.currentTheme);
      applyChatColor(state.currentChatColor);
    }
    render();
  }

  function sendExchange(eventName, payload, button, fallback) {
    setBusy(button);
    let settled = false;
    const timer = setTimeout(() => {
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
    const b = e.target.closest('[data-theme-id]'); if (!b || exchangeInFlight) return;
    const id = b.dataset.themeId; if (!currentUsername || !socket.connected) return status('先にチャットへ参加してください。');
    const owned = state.themes.includes(id), current = state.currentTheme === id; if (current) return;
    status(owned ? '🎨 見た目を切り替えています…' : '⭐ 地域ポイントで交換しています…');
    sendExchange(owned ? 'select-theme' : 'exchange-theme', { themeId: id }, b, '⚠️ 見た目の変更に失敗しました。もう一度試してください。');
  });

  colorGridEl.addEventListener('click', e => {
    const b = e.target.closest('[data-color-id]'); if (!b || exchangeInFlight) return;
    const id = b.dataset.colorId; if (!currentUsername || !socket.connected) return status('先にチャットへ参加してください。');
    const owned = state.chatColors.includes(id), current = state.currentChatColor === id; if (current) return;
    status(owned ? '🎨 チャットの色を切り替えています…' : '⭐ 地域ポイントで色を交換しています…');
    sendExchange(owned ? 'select-chat-color' : 'exchange-chat-color', { colorId: id }, b, '⚠️ チャットの色の変更に失敗しました。もう一度試してください。');
  });

  socket.on('theme-state', data => {
    if (!data || data.username !== currentUsername) return;
    state = { points: Number(data.points || 0), themes: Array.isArray(data.themes) ? data.themes : ['forest'], currentTheme: data.currentTheme || 'forest', chatColors: Array.isArray(data.chatColors) ? data.chatColors : ['forest'], currentChatColor: data.currentChatColor || 'forest' };
    catalog = data.catalog && typeof data.catalog === 'object' ? data.catalog : catalog;
    colorCatalog = data.chatColorCatalog && typeof data.chatColorCatalog === 'object' ? data.chatColorCatalog : colorCatalog;
    applyTheme(state.currentTheme); applyChatColor(state.currentChatColor); exchangeInFlight = false; render();
  });

  socket.on('region-points-updated', data => { if (!data || data.username !== currentUsername) return; state.points = Math.max(0, Math.floor(Number(data.points || 0))); render(); });

  const savedTheme = localStorage.getItem('rural-theme'); if (themes[savedTheme]) applyTheme(savedTheme);
  const savedColor = localStorage.getItem('rural-chat-color'); if (chatColors[savedColor]) applyChatColor(savedColor);
  render();
})();
