(() => {
  if (window.__ruralChatBackgroundShopInitialized) return;
  window.__ruralChatBackgroundShopInitialized = true;
  if (typeof socket === 'undefined') return;

  const modal = document.querySelector('.theme-shop-modal');
  const box = modal?.querySelector('.theme-shop-box');
  if (!modal || !box) return;

  const catalog = {
    default: { name: '🌿 里山', description: '見やすい標準のチャット背景', cost: 0, css: 'default' },
    paper: { name: '📜 和紙', description: 'やわらかな和紙風の背景', cost: 40, css: 'paper' },
    sky: { name: '☁️ 青空', description: '明るく爽やかな空色', cost: 60, css: 'sky' },
    sakura: { name: '🌸 桜', description: '春らしい淡い桜色', cost: 80, css: 'sakura' },
    night: { name: '🌌 星空', description: '落ち着いた夜空イメージ', cost: 100, css: 'night' },
    sunset: { name: '🌇 夕焼け', description: 'あたたかい夕暮れ色', cost: 120, css: 'sunset' }
  };

  const oldNote = box.querySelector('.theme-shop-note');
  const section = document.createElement('div');
  section.className = 'theme-shop-section chat-background-section';
  section.innerHTML = '<h3>🖼️ チャット背景</h3><div id="chat-background-grid" class="theme-shop-grid"></div>';
  if (oldNote) box.insertBefore(section, oldNote); else box.appendChild(section);
  const grid = section.querySelector('#chat-background-grid');

  const style = document.createElement('style');
  style.textContent = `
    .chat-custom-preview{height:70px;border-radius:10px;margin:0 0 9px;border:1px solid rgba(0,0,0,.09);position:relative;overflow:hidden}
    .chat-custom-preview::after{content:'チャット';position:absolute;left:12px;bottom:9px;padding:4px 8px;border-radius:8px;background:rgba(255,255,255,.78);font-size:11px;font-weight:700}
    .chat-custom-preview.default{background:#f3f7ef}.chat-custom-preview.paper{background-color:#f3ecdc;background-image:radial-gradient(rgba(108,92,58,.09) .7px,transparent .7px);background-size:7px 7px}.chat-custom-preview.sky{background:linear-gradient(160deg,#dff5ff,#b9e4f6 52%,#e9faff)}.chat-custom-preview.sakura{background:linear-gradient(160deg,#fff2f7,#f9dbe8 55%,#fff7fa)}.chat-custom-preview.night{background:radial-gradient(circle at 18% 22%,#fff8b0 0 1px,transparent 2px),radial-gradient(circle at 72% 30%,#dbeeff 0 1px,transparent 2px),linear-gradient(160deg,#16243a,#263b57)}.chat-custom-preview.sunset{background:linear-gradient(160deg,#ffd9ac,#ef9b61 48%,#6e5a86)}
    body[data-rural-chat-background="default"] .messages{background:#f7faf5!important;color:#294238!important}
    body[data-rural-chat-background="paper"] .messages{background-color:#f3ecdc!important;background-image:radial-gradient(rgba(108,92,58,.08) .7px,transparent .7px)!important;background-size:7px 7px!important;color:#4a3a2a!important}
    body[data-rural-chat-background="sky"] .messages{background:linear-gradient(160deg,#e8f8ff,#d7f0fa)!important;color:#173f52!important}
    body[data-rural-chat-background="sakura"] .messages{background:linear-gradient(160deg,#fff4f8,#ffe7ef)!important;color:#633747!important}
    body[data-rural-chat-background="night"] .messages{background:radial-gradient(circle at 18% 22%,#fff8b0 0 1px,transparent 2px),radial-gradient(circle at 72% 30%,#dbeeff 0 1px,transparent 2px),linear-gradient(160deg,#172536,#23374f)!important;color:#edf5fb!important}
    body[data-rural-chat-background="night"] .message{background:rgba(48,64,80,.92)!important;color:#edf5fb!important}
    body[data-rural-chat-background="sunset"] .messages{background:linear-gradient(160deg,#ffe0bd,#f4b07a 45%,#75678a)!important;color:#493426!important}
    body[data-rural-chat-background="default"] .message{color:#294238!important}body[data-rural-chat-background="paper"] .message{color:#4a3a2a!important}body[data-rural-chat-background="sky"] .message{color:#173f52!important}body[data-rural-chat-background="sakura"] .message{color:#633747!important}body[data-rural-chat-background="sunset"] .message{color:#493426!important}
  `;
  document.head.appendChild(style);

  const state = { points: 0, backgrounds: ['default'], currentBackground: 'default' };
  let busy = false;
  const status = text => { if (typeof setStatus === 'function') setStatus(text); };
  const apply = () => { document.body.dataset.ruralChatBackground = state.currentBackground || 'default'; };

  function render() {
    grid.innerHTML = Object.entries(catalog).map(([id, info]) => {
      const owned = state.backgrounds.includes(id), current = state.currentBackground === id;
      const label = current ? '✅ 使用中' : owned ? 'この背景を使う' : `⭐ ${id === 'default' ? '無料' : `${info.cost}pt`}で交換`;
      return `<div class="theme-card"><div class="chat-custom-preview ${info.css}"></div><h4>${info.name}</h4><p>${info.description}</p>${owned ? '<div class="theme-owned">✓ 交換済み</div>' : ''}<button type="button" data-chat-bg="${id}" class="${owned && !current ? 'secondary' : ''}" ${current || busy ? 'disabled' : ''}>${label}</button></div>`;
    }).join('');
    apply();
  }

  function handleResult(result) {
    busy = false;
    if (!result?.ok) {
      if (result.reason === 'insufficient-points') status(`⭐ 地域ポイントが足りません（必要 ${Number(result.cost || 0)}pt / 所持 ${Number(result.points || 0)}pt）`);
      else status(result.message || '交換処理に失敗しました。');
      render();
      return;
    }
    state.points = Number(result.points ?? state.points);
    state.backgrounds = Array.isArray(result.backgrounds) ? result.backgrounds : state.backgrounds;
    state.currentBackground = result.currentBackground || state.currentBackground;
    render();
    status(result.purchased ? '🎉 背景を交換しました。' : '背景を切り替えました。');
  }

  function exchange(eventName, id, button) {
    if (busy || !socket.connected) { if (!socket.connected) status('⚠️ サーバーに接続されていません。'); return; }
    busy = true;
    if (button) button.textContent = '⏳ 処理中…';
    render();
    let settled = false;
    const timer = setTimeout(() => { if (settled) return; settled = true; busy = false; status('⚠️ サーバーからの応答がタイムアウトしました。'); render(); }, 12000);
    socket.emit(eventName, { id }, result => { if (settled) return; settled = true; clearTimeout(timer); handleResult(result); });
  }

  socket.on('chat-background-state', result => {
    if (!result) return;
    if (result.backgroundCatalog) Object.assign(catalog, result.backgroundCatalog);
    state.points = Number(result.points ?? state.points);
    state.backgrounds = Array.isArray(result.backgrounds) ? result.backgrounds : ['default'];
    state.currentBackground = result.currentBackground || 'default';
    render();
  });

  grid.addEventListener('click', event => {
    const button = event.target.closest('[data-chat-bg]');
    if (!button) return;
    const id = button.dataset.chatBg;
    exchange(state.backgrounds.includes(id) ? 'select-chat-background' : 'exchange-chat-background', id, button);
  });

  render();
})();
