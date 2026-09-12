(() => {
  if (window.__ruralThemeShopInitialized) return;
  window.__ruralThemeShopInitialized = true;

  const headerUser = document.querySelector('.header-user');
  if (!headerUser || typeof socket === 'undefined') return;

  const themes = {
    forest: { name: '🌿 里山', description: '今の緑を基調にした標準テーマ', cost: 0 },
    sakura: { name: '🌸 桜', description: '春らしい桜色のやさしいテーマ', cost: 50 },
    ocean: { name: '🌊 海辺', description: '海と空をイメージした爽やかなテーマ', cost: 80 },
    night: { name: '🌙 星空', description: '夜の地域をイメージした落ち着いたテーマ', cost: 100 },
    matsuri: { name: '🏮 祭り', description: '地域のお祭りをイメージした元気なテーマ', cost: 150 }
  };

  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'theme-shop-btn';
  button.className = 'theme-shop-open';
  button.textContent = '🎨 見た目交換';
  button.title = '地域ポイントでチャットの見た目を交換';
  headerUser.insertBefore(button, headerUser.querySelector('#online-count'));

  const style = document.createElement('style');
  style.textContent = `
    .theme-shop-open{border:0;background:rgba(255,255,255,.15);color:#fff;padding:7px 11px;border-radius:999px;white-space:nowrap;cursor:pointer;font:inherit}
    .theme-shop-open:hover{background:rgba(255,255,255,.24)}
    .theme-shop-modal{position:fixed;inset:0;z-index:11000;display:none;align-items:center;justify-content:center;padding:16px}
    .theme-shop-modal.is-open{display:flex}
    .theme-shop-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.5)}
    .theme-shop-box{position:relative;width:min(620px,96vw);max-height:88vh;overflow:auto;background:#fff;border-radius:16px;padding:18px;box-shadow:0 18px 60px rgba(0,0,0,.32)}
    .theme-shop-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:6px}
    .theme-shop-head h2{margin:0;font-size:20px}
    .theme-shop-close{border:0;background:#eef2ee;color:#31513f;border-radius:999px;width:34px;height:34px;font-size:20px;cursor:pointer}
    .theme-shop-balance{padding:10px 12px;background:#f5f8f4;border-radius:10px;color:#31513f;font-weight:700;margin:10px 0 14px}
    .theme-shop-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .theme-card{border:1px solid #d9e2d6;border-radius:12px;padding:12px;background:#fff}
    .theme-card h3{margin:0 0 4px;font-size:15px}.theme-card p{margin:0 0 9px;color:#68796e;font-size:12px;line-height:1.45}
    .theme-card button{width:100%;border:0;border-radius:8px;padding:9px 10px;background:#234d3c;color:#fff;font:inherit;cursor:pointer}
    .theme-card button.secondary{background:#eef2ee;color:#31513f}.theme-card button:disabled{opacity:.55;cursor:wait}
    .theme-card .theme-owned{font-size:11px;color:#2d8a57;font-weight:700;margin-bottom:7px}
    .theme-shop-note{margin-top:12px;color:#68796e;font-size:11px;line-height:1.5}
    @media(max-width:650px){.theme-shop-grid{grid-template-columns:1fr}.theme-shop-box{padding:14px}}
    body[data-rural-theme="sakura"]{background:#fff1f6!important;color:#4f3040!important}
    body[data-rural-theme="sakura"] .app-header{background:#8d4867!important}.app-header[data-rural-theme="sakura"]{background:#8d4867!important}
    body[data-rural-theme="sakura"] .setup-panel{background:linear-gradient(145deg,#fff7fa,#f9dde8)!important}
    body[data-rural-theme="sakura"] .chat-panel,body[data-rural-theme="sakura"] .map-panel{border-color:#ecc5d4!important}
    body[data-rural-theme="sakura"] .users-panel{background:#fff7fa!important;border-color:#ecc5d4!important}
    body[data-rural-theme="sakura"] .message{background:#fff2f7!important}.message.own{border-left-color:#8d4867!important}
    body[data-rural-theme="sakura"] .input-area{background:#fff7fa!important;border-color:#ecc5d4!important}
    body[data-rural-theme="sakura"] .status{background:#fffafd!important;border-color:#ecc5d4!important}
    body[data-rural-theme="ocean"]{background:#eaf6fb!important;color:#193b4a!important}
    body[data-rural-theme="ocean"] .app-header{background:#17617a!important}
    body[data-rural-theme="ocean"] .setup-panel{background:linear-gradient(145deg,#f2fbff,#d8eef7)!important}
    body[data-rural-theme="ocean"] .chat-panel,body[data-rural-theme="ocean"] .map-panel{border-color:#b8dae6!important}
    body[data-rural-theme="ocean"] .users-panel{background:#f2fbff!important;border-color:#b8dae6!important}
    body[data-rural-theme="ocean"] .message{background:#edf8fc!important}.message.own{border-left-color:#17617a!important}
    body[data-rural-theme="ocean"] .input-area{background:#f2fbff!important;border-color:#b8dae6!important}
    body[data-rural-theme="ocean"] .status{background:#fafdff!important;border-color:#b8dae6!important}
    body[data-rural-theme="night"]{background:#151c24!important;color:#e9f0f4!important}
    body[data-rural-theme="night"] .app-header{background:#202f42!important}
    body[data-rural-theme="night"] .chat-panel,body[data-rural-theme="night"] .map-panel{background:#202b35!important;border-color:#3b4b59!important}
    body[data-rural-theme="night"] .setup-panel{background:linear-gradient(145deg,#23313d,#17232d)!important}
    body[data-rural-theme="night"] .users-panel{background:#1b2731!important;border-color:#3b4b59!important}
    body[data-rural-theme="night"] .users-panel li{background:#24313c!important;border-color:#3b4b59!important}
    body[data-rural-theme="night"] .messages{background:#202b35!important}
    body[data-rural-theme="night"] .message{background:#2a3742!important;color:#e9f0f4!important}.message-header{color:#a9bbc6!important}
    body[data-rural-theme="night"] .input-area,body[data-rural-theme="night"] .status{background:#19242e!important;border-color:#3b4b59!important;color:#b9c8d0!important}
    body[data-rural-theme="night"] .input-area input{background:#26343f!important;color:#fff!important;border-color:#4a5c69!important}
    body[data-rural-theme="matsuri"]{background:#fff7e9!important;color:#4d3020!important}
    body[data-rural-theme="matsuri"] .app-header{background:#9b3f25!important}
    body[data-rural-theme="matsuri"] .setup-panel{background:linear-gradient(145deg,#fffaf0,#ffe4bd)!important}
    body[data-rural-theme="matsuri"] .chat-panel,body[data-rural-theme="matsuri"] .map-panel{border-color:#e8c89d!important}
    body[data-rural-theme="matsuri"] .users-panel{background:#fffaf0!important;border-color:#e8c89d!important}
    body[data-rural-theme="matsuri"] .message{background:#fff3d8!important}.message.own{border-left-color:#9b3f25!important}
    body[data-rural-theme="matsuri"] .input-area{background:#fffaf0!important;border-color:#e8c89d!important}
    body[data-rural-theme="matsuri"] .status{background:#fffdf7!important;border-color:#e8c89d!important}
  `;
  document.head.appendChild(style);

  const modal = document.createElement('div');
  modal.className = 'theme-shop-modal';
  modal.innerHTML = `<div class="theme-shop-backdrop"></div><div class="theme-shop-box" role="dialog" aria-modal="true" aria-labelledby="theme-shop-title"><div class="theme-shop-head"><h2 id="theme-shop-title">🎨 地域ポイント交換所</h2><button type="button" class="theme-shop-close" aria-label="閉じる">×</button></div><div id="theme-shop-balance" class="theme-shop-balance">⭐ 地域ポイント：0pt</div><div id="theme-shop-grid" class="theme-shop-grid"></div><div class="theme-shop-note">地域ポイントは、他の人の「助け合い」投稿で実際に手伝い、投稿者から「来た！」と確認されると10pt獲得できます。購入済みのテーマは何度でも無料で切り替えられます。</div></div>`;
  document.body.appendChild(modal);

  const balanceEl = modal.querySelector('#theme-shop-balance');
  const gridEl = modal.querySelector('#theme-shop-grid');
  let state = { points: 0, themes: ['forest'], currentTheme: 'forest' };
  let catalog = themes;

  function applyTheme(themeId) {
    const safeTheme = themes[themeId] ? themeId : 'forest';
    document.body.dataset.ruralTheme = safeTheme;
    localStorage.setItem('rural-theme', safeTheme);
  }

  function render() {
    const points = Math.max(0, Math.floor(Number(state.points || 0)));
    balanceEl.textContent = `⭐ 地域ポイント：${points}pt`;
    gridEl.innerHTML = Object.entries(catalog).map(([id, info]) => {
      const owned = state.themes.includes(id);
      const current = state.currentTheme === id;
      const costText = id === 'forest' ? '無料' : `${Number(info.cost)}pt`;
      const buttonText = current ? '✅ 使用中' : owned ? 'このテーマを使う' : `⭐ ${costText}で交換`;
      const disabled = current ? 'disabled' : '';
      const className = owned && !current ? 'secondary' : '';
      return `<div class="theme-card"><h3>${info.name}</h3><p>${info.description}</p>${owned ? '<div class="theme-owned">✓ 交換済み</div>' : ''}<button type="button" class="${className}" data-theme-id="${id}" ${disabled}>${buttonText}</button></div>`;
    }).join('');
  }

  function open() { modal.classList.add('is-open'); render(); }
  function close() { modal.classList.remove('is-open'); }

  button.addEventListener('click', open);
  modal.querySelector('.theme-shop-backdrop').addEventListener('click', close);
  modal.querySelector('.theme-shop-close').addEventListener('click', close);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && modal.classList.contains('is-open')) close(); });

  gridEl.addEventListener('click', event => {
    const action = event.target.closest('[data-theme-id]');
    if (!action) return;
    const themeId = action.dataset.themeId;
    if (!currentUsername || !socket?.connected) {
      alert('先にチャットへ参加してください。');
      return;
    }
    action.disabled = true;
    socket.emit(state.themes.includes(themeId) ? 'select-theme' : 'exchange-theme', { themeId }, result => {
      action.disabled = false;
      if (!result?.ok) {
        const messages = {
          'insufficient-points': `地域ポイントが足りません。（必要：${result.cost}pt / 所持：${result.points}pt）`,
          'not-owned': 'このテーマはまだ交換していません。',
          'server-error': '交換中にエラーが発生しました。しばらくしてから再試行してください。'
        };
        alert(messages[result.reason] || 'テーマの変更に失敗しました。');
      }
    });
  });

  socket.on('theme-state', data => {
    if (!data || data.username !== currentUsername) return;
    state = { points: Number(data.points || 0), themes: Array.isArray(data.themes) ? data.themes : ['forest'], currentTheme: data.currentTheme || 'forest' };
    catalog = data.catalog || catalog;
    applyTheme(state.currentTheme);
    render();
  });

  const savedTheme = localStorage.getItem('rural-theme');
  if (themes[savedTheme]) applyTheme(savedTheme);
})();
