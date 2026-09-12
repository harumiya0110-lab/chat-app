(() => {
  if (window.__ruralChatCustomizationUIOptimized) return;
  window.__ruralChatCustomizationUIOptimized = true;
  if (typeof socket === 'undefined') return;

  const modal = document.querySelector('.theme-shop-modal');
  const box = modal?.querySelector('.theme-shop-box');
  if (!modal || !box) return;

  const backgroundCatalog = {
    default: { name: '🌿 里山', description: '見やすい標準のチャット背景', cost: 0, css: 'default' },
    paper: { name: '📜 和紙', description: 'やわらかな和紙風の背景', cost: 40, css: 'paper' },
    sky: { name: '☁️ 青空', description: '明るく爽やかな空色', cost: 60, css: 'sky' },
    sakura: { name: '🌸 桜', description: '春らしい淡い桜色', cost: 80, css: 'sakura' },
    night: { name: '🌌 星空', description: '落ち着いた夜空イメージ', cost: 100, css: 'night' },
    sunset: { name: '🌇 夕焼け', description: 'あたたかい夕暮れ色', cost: 120, css: 'sunset' }
  };
  const iconFrameCatalog = {
    default: { name: '🌿 里山フレーム', description: '標準のやさしい緑', cost: 0, css: 'default' },
    gold: { name: '✨ ゴールド', description: '特別感のある金色フレーム', cost: 40, css: 'gold' },
    sakura: { name: '🌸 桜フレーム', description: 'かわいい桜色フレーム', cost: 60, css: 'sakura' },
    ocean: { name: '🌊 海フレーム', description: '爽やかな青色フレーム', cost: 70, css: 'ocean' },
    leaf: { name: '🍃 葉っぱフレーム', description: '自然を感じるフレーム', cost: 80, css: 'leaf' },
    matsuri: { name: '🏮 お祭りフレーム', description: '地域のお祭りをイメージ', cost: 100, css: 'matsuri' }
  };

  const oldNote = box.querySelector('.theme-shop-note');
  const makeSection = (title, gridId) => {
    const section = document.createElement('div');
    section.className = 'theme-shop-section chat-custom-section';
    section.innerHTML = `<h3>${title}</h3><div id="${gridId}" class="theme-shop-grid"></div>`;
    if (oldNote) box.insertBefore(section, oldNote); else box.appendChild(section);
    return section.querySelector(`#${gridId}`);
  };
  const bgGrid = makeSection('🖼️ チャット背景', 'chat-background-grid');
  const frameGrid = makeSection('⭕ チャットアイコン枠', 'chat-icon-frame-grid');

  const style = document.createElement('style');
  style.id = 'chat-customization-shop-style';
  style.textContent = `
    .chat-custom-preview{height:70px;border-radius:10px;margin:0 0 9px;border:1px solid rgba(0,0,0,.09);position:relative;overflow:hidden}
    .chat-custom-preview::after{content:'チャット';position:absolute;left:12px;bottom:9px;padding:4px 8px;border-radius:8px;background:rgba(255,255,255,.78);color:#31513f;font-size:11px;font-weight:700}
    .chat-custom-preview.default{background:#f3f7ef}
    .chat-custom-preview.paper{background-color:#f3ecdc;background-image:radial-gradient(rgba(108,92,58,.09) .7px,transparent .7px);background-size:7px 7px}
    .chat-custom-preview.sky{background:linear-gradient(160deg,#dff5ff,#b9e4f6 52%,#e9faff)}
    .chat-custom-preview.sakura{background:linear-gradient(160deg,#fff2f7,#f9dbe8 55%,#fff7fa)}
    .chat-custom-preview.night{background:radial-gradient(circle at 18% 22%,#fff8b0 0 1px,transparent 2px),radial-gradient(circle at 72% 30%,#dbeeff 0 1px,transparent 2px),linear-gradient(160deg,#16243a,#263b57)}
    .chat-custom-preview.sunset{background:linear-gradient(160deg,#ffd9ac,#ef9b61 48%,#6e5a86)}
    .chat-frame-preview{height:70px;display:grid;place-items:center;background:#f5f8f4;border-radius:10px;margin-bottom:9px}
    .chat-avatar.demo{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;font-weight:800;color:#fff;background:#2f7d4a;border:3px solid #86b98f;box-shadow:0 0 0 2px rgba(255,255,255,.85),0 2px 5px rgba(0,0,0,.12)}
    .chat-avatar.demo.gold{border-color:#e1b84a;box-shadow:0 0 0 2px #fff,0 0 0 4px #e1b84a}
    .chat-avatar.demo.sakura{border-color:#df7ea3;box-shadow:0 0 0 2px #fff,0 0 0 4px #f4b0c8}
    .chat-avatar.demo.ocean{border-color:#54a6d1;box-shadow:0 0 0 2px #fff,0 0 0 4px #9ed7ee}
    .chat-avatar.demo.leaf{border-color:#5da46d;box-shadow:0 0 0 2px #fff,0 0 0 4px #92c59c}
    .chat-avatar.demo.matsuri{border-color:#e36e39;box-shadow:0 0 0 2px #fff,0 0 0 4px #f2ae7e}
    .chat-avatar{width:28px;height:28px;flex:0 0 28px;border-radius:50%;display:inline-grid;place-items:center;font-size:12px;font-weight:800;color:#fff;background:#2f7d4a;margin-right:7px;vertical-align:middle}
    .chat-avatar[data-frame="gold"]{border:2px solid #e1b84a;box-shadow:0 0 0 1px #fff,0 0 0 3px #e1b84a}
    .chat-avatar[data-frame="sakura"]{border:2px solid #df7ea3;box-shadow:0 0 0 1px #fff,0 0 0 3px #f4b0c8}
    .chat-avatar[data-frame="ocean"]{border:2px solid #54a6d1;box-shadow:0 0 0 1px #fff,0 0 0 3px #9ed7ee}
    .chat-avatar[data-frame="leaf"]{border:2px solid #5da46d;box-shadow:0 0 0 1px #fff,0 0 0 3px #92c59c}
    .chat-avatar[data-frame="matsuri"]{border:2px solid #e36e39;box-shadow:0 0 0 1px #fff,0 0 0 3px #f2ae7e}
    body[data-rural-chat-background="default"] .messages{background:#f7faf5!important}
    body[data-rural-chat-background="paper"] .messages{background-color:#f3ecdc!important;background-image:radial-gradient(rgba(108,92,58,.08) .7px,transparent .7px)!important;background-size:7px 7px!important}
    body[data-rural-chat-background="sky"] .messages{background:linear-gradient(160deg,#e8f8ff,#d7f0fa)!important}
    body[data-rural-chat-background="sakura"] .messages{background:linear-gradient(160deg,#fff4f8,#ffe7ef)!important}
    body[data-rural-chat-background="night"] .messages{background:radial-gradient(circle at 18% 22%,#fff8b0 0 1px,transparent 2px),radial-gradient(circle at 72% 30%,#dbeeff 0 1px,transparent 2px),linear-gradient(160deg,#172536,#23374f)!important}
    body[data-rural-chat-background="sunset"] .messages{background:linear-gradient(160deg,#ffe0bd,#f4b07a 45%,#75678a)!important}
    body[data-rural-chat-background="night"] .message{background:rgba(48,64,80,.92)!important}
  `;
  document.head.appendChild(style);

  const customState = { points: 0, backgrounds: ['default'], currentBackground: 'default', iconFrames: ['default'], currentIconFrame: 'default' };
  let busy = false;
  let decorateFrame = 0;

  const status = text => { if (typeof setStatus === 'function') setStatus(text); };

  const applyVisuals = () => {
    document.body.dataset.ruralChatBackground = customState.currentBackground || 'default';
    document.body.dataset.ruralChatIconFrame = customState.currentIconFrame || 'default';
    refreshOwnAvatarFrames();
  };

  function avatarInitial(name) {
    const text = String(name || '?').trim();
    return text ? text.slice(0, 1) : '?';
  }

  function decorateMessageItem(item) {
    if (!(item instanceof Element) || !item.matches('.message')) return;
    const header = item.querySelector('.message-header');
    if (!header || header.dataset.avatarDecorated === '1') return;
    const name = header.querySelector('.message-username') || header.querySelector('span');
    if (!name || name.classList.contains('chat-avatar')) {
      header.dataset.avatarDecorated = '1';
      return;
    }
    const username = name.textContent.replace(/\s+あなた$/, '').trim();
    const avatar = document.createElement('span');
    avatar.className = 'chat-avatar';
    avatar.textContent = avatarInitial(username);
    avatar.dataset.frame = username === currentUsername ? (customState.currentIconFrame || 'default') : 'default';
    header.insertBefore(avatar, name);
    name.classList.add('message-username');
    header.dataset.avatarDecorated = '1';
  }

  function decorateUserItem(li) {
    if (!(li instanceof Element) || !li.matches('#users-list li')) return;
    if (li.dataset.avatarDecorated === '1') return;
    const name = li.querySelector('span:not(.chat-avatar)');
    if (!name || li.querySelector('.chat-avatar')) {
      li.dataset.avatarDecorated = '1';
      return;
    }
    const username = name.textContent.replace(/\s+あなた$/, '').trim();
    const avatar = document.createElement('span');
    avatar.className = 'chat-avatar';
    avatar.textContent = avatarInitial(username);
    avatar.dataset.frame = username === currentUsername ? (customState.currentIconFrame || 'default') : 'default';
    li.insertBefore(avatar, name);
    li.dataset.avatarDecorated = '1';
  }

  function processAddedNodes(nodes) {
    for (const node of nodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches('.message')) decorateMessageItem(node);
      else if (node.matches('#users-list li')) decorateUserItem(node);
      node.querySelectorAll('.message').forEach(decorateMessageItem);
      node.querySelectorAll('#users-list li').forEach(decorateUserItem);
    }
  }

  function refreshOwnAvatarFrames() {
    const frame = customState.currentIconFrame || 'default';
    document.querySelectorAll('#messages .message.own .chat-avatar').forEach(avatar => { avatar.dataset.frame = frame; });
    document.querySelectorAll('#users-list li .chat-avatar').forEach(avatar => {
      const li = avatar.closest('li');
      const name = li?.querySelector('span:not(.chat-avatar)')?.textContent?.replace(/\s+あなた$/, '').trim();
      avatar.dataset.frame = name === currentUsername ? frame : 'default';
    });
  }

  function scheduleAddedNodeProcessing(nodes) {
    const queue = Array.from(nodes || []).filter(node => node instanceof Element);
    if (!queue.length) return;
    if (decorateFrame) cancelAnimationFrame(decorateFrame);
    decorateFrame = requestAnimationFrame(() => {
      decorateFrame = 0;
      processAddedNodes(queue);
    });
  }

  function render() {
    bgGrid.innerHTML = Object.entries(backgroundCatalog).map(([id, info]) => {
      const owned = customState.backgrounds.includes(id), current = customState.currentBackground === id;
      const text = current ? '✅ 使用中' : owned ? 'この背景を使う' : `⭐ ${id === 'default' ? '無料' : `${info.cost}pt`}で交換`;
      return `<div class="theme-card"><div class="chat-custom-preview ${info.css}"></div><h4>${info.name}</h4><p>${info.description}</p>${owned ? '<div class="theme-owned">✓ 交換済み</div>' : ''}<button type="button" data-custom-bg="${id}" class="${owned && !current ? 'secondary' : ''}" ${current || busy ? 'disabled' : ''}>${text}</button></div>`;
    }).join('');
    frameGrid.innerHTML = Object.entries(iconFrameCatalog).map(([id, info]) => {
      const owned = customState.iconFrames.includes(id), current = customState.currentIconFrame === id;
      const text = current ? '✅ 使用中' : owned ? 'この枠を使う' : `⭐ ${id === 'default' ? '無料' : `${info.cost}pt`}で交換`;
      return `<div class="theme-card"><div class="chat-frame-preview"><span class="chat-avatar demo ${info.css}">地</span></div><h4>${info.name}</h4><p>${info.description}</p>${owned ? '<div class="theme-owned">✓ 交換済み</div>' : ''}<button type="button" data-custom-frame="${id}" class="${owned && !current ? 'secondary' : ''}" ${current || busy ? 'disabled' : ''}>${text}</button></div>`;
    }).join('');
    applyVisuals();
  }

  function handleResult(result) {
    busy = false;
    if (!result?.ok) {
      if (result.reason === 'insufficient-points') status(`⭐ 地域ポイントが足りません（必要 ${Number(result.cost || 0)}pt / 所持 ${Number(result.points || 0)}pt）`);
      else status(result.message || '交換処理に失敗しました。');
      render();
      return;
    }
    customState.points = Number(result.points ?? customState.points);
    customState.backgrounds = Array.isArray(result.backgrounds) ? result.backgrounds : customState.backgrounds;
    customState.currentBackground = result.currentBackground || customState.currentBackground;
    customState.iconFrames = Array.isArray(result.iconFrames) ? result.iconFrames : customState.iconFrames;
    customState.currentIconFrame = result.currentIconFrame || customState.currentIconFrame;
    render();
    status(result.purchased ? '🎉 交換しました。' : '見た目を切り替えました。');
  }

  function exchange(eventName, id, button) {
    if (busy || !socket.connected) {
      if (!socket.connected) status('⚠️ サーバーに接続されていません。');
      return;
    }
    busy = true;
    if (button) button.textContent = '⏳ 処理中…';
    render();
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      busy = false;
      status('⚠️ サーバーからの応答がタイムアウトしました。');
      render();
    }, 12000);
    socket.emit(eventName, { id }, result => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      handleResult(result);
    });
  }

  socket.on('chat-customization-state', result => {
    if (!result) return;
    if (result.backgroundCatalog) Object.assign(backgroundCatalog, result.backgroundCatalog);
    if (result.iconFrameCatalog) Object.assign(iconFrameCatalog, result.iconFrameCatalog);
    customState.points = Number(result.points || 0);
    customState.backgrounds = Array.isArray(result.backgrounds) ? result.backgrounds : ['default'];
    customState.currentBackground = result.currentBackground || 'default';
    customState.iconFrames = Array.isArray(result.iconFrames) ? result.iconFrames : ['default'];
    customState.currentIconFrame = result.currentIconFrame || 'default';
    render();
  });

  bgGrid.addEventListener('click', event => {
    const button = event.target.closest('[data-custom-bg]');
    if (!button) return;
    const id = button.dataset.customBg;
    exchange(customState.backgrounds.includes(id) ? 'select-chat-background' : 'exchange-chat-background', id, button);
  });
  frameGrid.addEventListener('click', event => {
    const button = event.target.closest('[data-custom-frame]');
    if (!button) return;
    const id = button.dataset.customFrame;
    exchange(customState.iconFrames.includes(id) ? 'select-chat-icon-frame' : 'exchange-chat-icon-frame', id, button);
  });

  const messagesEl = document.getElementById('messages');
  const usersEl = document.getElementById('users-list');
  const observer = new MutationObserver(records => {
    const added = [];
    records.forEach(record => record.addedNodes.forEach(node => { if (node instanceof Element) added.push(node); }));
    scheduleAddedNodeProcessing(added);
  });
  if (messagesEl) observer.observe(messagesEl, { childList: true });
  if (usersEl) observer.observe(usersEl, { childList: true });

  render();
})();
