(() => {
  if (window.__ruralSocialFeaturesInitialized) return;
  window.__ruralSocialFeaturesInitialized = true;

  const $ = id => document.getElementById(id);
  const messagesEl = $('messages');
  const notifyBtn = $('notify-btn');
  const leaderboardBtn = $('leaderboard-btn');
  const blockedUsersBtn = $('blocked-users-btn');
  const unreadBtn = $('unread-btn');
  const unreadCountEl = $('unread-count');
  const loadMoreBtn = $('load-more-btn');
  const replyPreview = $('reply-preview');
  const replyPreviewUser = $('reply-preview-user');
  const replyPreviewText = $('reply-preview-text');
  const replyCancel = $('reply-cancel');
  const mobileTabs = document.querySelectorAll('.mobile-view-tab');

  if (!messagesEl || typeof socket === 'undefined') return;

  const REACTION_TYPES = [
    { key: 'like', label: '👍', title: 'いいね' },
    { key: 'thanks', label: '🙏', title: 'ありがとう' },
    { key: 'helpful', label: '👌', title: 'グッド' }
  ];
  const BLOCKED_KEY = 'rural-blocked-users-v1';
  let unreadCount = 0;
  let loadMoreBusy = false;
  let hasMoreHistory = false;
  let clusters = [];
  let clusterRefreshTimer = null;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>\"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  }

  function injectStyles() {
    if ($('rural-social-features-style')) return;
    const style = document.createElement('style');
    style.id = 'rural-social-features-style';
    style.textContent = `
      .chat-toolbar{padding:9px 10px;border-bottom:1px solid var(--chat-border,#e3e9e0);background:var(--chat-panel-soft,#f8faf7)}
      .chat-toolbar-actions{display:flex;gap:6px;align-items:center}
      .chat-tool-action{border:1px solid var(--chat-input,#bdcbbd);border-radius:8px;padding:8px 9px;background:var(--chat-input-bg,#fff);color:var(--chat-text,#294237);cursor:pointer;font:inherit;font-size:11px;font-weight:700;white-space:nowrap}
      .chat-tool-action:hover{background:var(--chat-surface,#eef4ec)}
      .unread-btn{background:var(--rural-chat,#2f7d4a);color:#fff;border-color:var(--rural-chat,#2f7d4a)}
      .load-more-btn{display:block;width:calc(100% - 20px);margin:8px 10px 0;border:1px solid var(--chat-input,#bdcbbd);border-radius:8px;background:var(--chat-input-bg,#fff);color:var(--chat-text,#294237);padding:7px 10px;font:inherit;font-size:11px;font-weight:700;cursor:pointer}
      .load-more-btn:disabled{opacity:.6;cursor:wait}
      .message{position:relative;transition:box-shadow .16s ease,opacity .16s ease}
      .message.rural-highlight{box-shadow:0 0 0 3px color-mix(in srgb,var(--rural-chat,#2f7d4a) 25%,transparent)}
      .message.rural-blocked{display:none!important}
      .message-type-badge,.message-resolved-badge{display:inline-flex;align-items:center;gap:3px;border-radius:999px;padding:2px 7px;color:#fff;font-size:10px;font-weight:800;margin-right:5px}
      .message-resolved-badge{background:#4d8762}
      .message-badges{min-height:0;margin-bottom:4px}
      .message-reply{display:flex;flex-direction:column;gap:2px;margin-bottom:6px;padding:7px 9px;border-left:3px solid var(--rural-chat,#2f7d4a);border-radius:6px;background:var(--chat-panel-soft,#f3f7f1);color:var(--chat-text-soft,#65726b);font-size:11px;cursor:pointer;transition:background-color .15s ease,transform .15s ease}
      .message-reply:hover{background:var(--chat-surface,#e9f3ea);transform:translateY(-1px)}
      .message-reply:focus-visible{outline:2px solid var(--rural-chat,#2f7d4a);outline-offset:2px}
      .message-reply-label{font-size:10px;font-weight:800;color:var(--rural-chat-strong,#265b3b)}
      .message-reply-quote{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
      .message-replies{margin:8px 0 0 12px;padding:7px 0 0 10px;border-left:2px solid var(--rural-chat,#2f7d4a)}
      .message-replies-toggle{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--chat-input,#c3cec1);border-radius:999px;background:var(--chat-input-bg,#fff);color:var(--chat-text-soft,#64746b);padding:3px 8px;margin:0 0 6px;font:inherit;font-size:10px;font-weight:800;cursor:pointer}
      .message-replies-toggle:hover{background:var(--chat-surface,#edf3eb)}
      .message-replies-toggle.collapsed{opacity:.82}
      .message-replies-list{display:flex;flex-direction:column;gap:5px}
      .message-replies-list[hidden]{display:none}
      .message.reply-message{margin:0;padding:7px 9px;background:color-mix(in srgb,var(--rural-chat,#2f7d4a) 6%,var(--chat-surface,#f1f5ee));border:1px solid color-mix(in srgb,var(--rural-chat,#2f7d4a) 20%,var(--chat-input,#c3cec1));border-left:3px solid var(--rural-chat,#2f7d4a);border-radius:8px;font-size:11px}
      .message.reply-message .message-header{font-size:10px;margin-bottom:3px}
      .message.reply-message .message-bubble{font-size:11px;line-height:1.4}
      .message.reply-message .message-reply{margin:0 0 4px;padding:3px 6px;border-left-width:2px;border-radius:4px;font-size:9px}
      .message.reply-message .message-reply-label{font-size:9px}
      .message.reply-message .message-reply-quote{font-size:9px}
      .message.reply-message .message-actions{margin-top:4px;gap:3px}
      .message.reply-message .message-action-btn{font-size:9px;padding:3px 6px}
      .message-actions{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:7px}
      .map-post-reactions{margin-top:8px;padding-top:7px;border-top:1px solid var(--theme-border-soft,#dce6db)}
      .map-post-reactions-title{margin-bottom:5px;color:var(--theme-text-soft,#64746b);font-size:10px;font-weight:800}
      .map-post-reactions-row{display:flex;flex-wrap:wrap;align-items:center;gap:5px}
      .message-action-btn{border:1px solid var(--chat-input,#c3cec1);border-radius:999px;padding:4px 7px;background:var(--chat-input-bg,#fff);color:var(--chat-text,#30483b);font:inherit;font-size:10px;cursor:pointer}
      .message-action-btn:hover{background:var(--chat-surface,#edf3eb)}
      .message-action-btn:disabled{opacity:.55;cursor:wait}
      .message-action-btn.active{border-color:var(--rural-chat,#2f7d4a);background:var(--chat-surface,#e9f3ea);color:var(--rural-chat-strong,#265b3b);font-weight:800}
      .message-actions-spacer{flex:1}
      .message-more-actions{font-size:10px}
      .reply-preview{display:flex;align-items:center;justify-content:space-between;gap:9px;padding:7px 10px;background:var(--chat-panel-soft,#f3f7f1);border-top:1px solid var(--chat-border,#e3e9e0);color:var(--chat-text-soft,#66746c)}
      .reply-preview>div{min-width:0;overflow:hidden}
      .reply-preview span{font-size:10px}
      .reply-preview strong{color:var(--chat-text,#294237);font-size:11px}
      .reply-preview p{margin:2px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px}
      .reply-preview>button{flex:0 0 auto;border:0;border-radius:7px;background:var(--chat-input-bg,#fff);color:var(--chat-text,#294237);font-size:17px;width:28px;height:28px;cursor:pointer}
      .rural-modal{position:fixed;inset:0;z-index:11000;display:grid;place-items:center;padding:18px}
      .rural-modal[hidden]{display:none}
      .rural-modal-backdrop{position:absolute;inset:0;background:rgba(15,28,20,.48);backdrop-filter:blur(2px)}
      .rural-modal-box{position:relative;z-index:1;width:min(560px,100%);max-height:min(78vh,720px);overflow:auto;background:var(--theme-panel,#fff);color:var(--theme-text,#294237);border:1px solid var(--theme-border-soft,#d7e2d4);border-radius:16px;box-shadow:0 20px 60px rgba(15,35,24,.28)}
      .rural-modal-head{display:flex;align-items:center;justify-content:space-between;padding:15px 17px;border-bottom:1px solid var(--theme-border-soft,#e3e9e0);position:sticky;top:0;background:var(--theme-panel,#fff);z-index:2}
      .rural-modal-head h2{margin:0;font-size:18px;color:var(--theme-text,#294237)}
      .rural-modal-close{border:0;background:var(--theme-main-soft,#edf3eb);color:var(--theme-text,#294237);width:34px;height:34px;border-radius:9px;cursor:pointer;font-size:18px}
      .rural-modal-body{padding:15px 17px}
      .leader-row{display:grid;grid-template-columns:38px 1fr auto;align-items:center;gap:10px;padding:11px 5px;border-bottom:1px solid var(--theme-border-soft,#edf1eb)}
      .leader-rank{font-weight:900;text-align:center;color:var(--theme-main,#2f7d4a)}
      .leader-name{font-size:13px;font-weight:700}
      .leader-points{font-size:13px;font-weight:900}
      .blocked-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid var(--theme-border-soft,#edf1eb)}
      .blocked-row button{border:1px solid var(--theme-border,#c5d2c2);border-radius:8px;background:var(--theme-panel,#fff);color:var(--theme-text,#294237);padding:6px 9px;cursor:pointer;font:inherit;font-size:11px}
      .pin-cluster-label{background:transparent!important;border:0!important;color:#fff!important;box-shadow:none!important;font-size:12px!important;font-weight:900!important;text-shadow:0 1px 3px rgba(0,0,0,.5)}
      .pin-cluster-label:before{display:none!important}
      .rural-cluster-number{display:grid;place-items:center;width:42px;height:42px;border-radius:50%;background:var(--theme-main,#2f7d4a);border:3px solid var(--theme-panel,#fff);box-shadow:0 4px 12px rgba(20,50,30,.22);color:#fff;font-size:12px;font-weight:900}
      @media(max-width:650px){
        .chat-toolbar{padding:7px 7px}
        .chat-tool-action{padding:7px 8px;font-size:10px}
        .chat-tool-action:first-child{font-size:0}
        .chat-tool-action:first-child:after{content:'🔔';font-size:14px}
        .chat-toolbar-actions{gap:4px}
        .message-action-btn{font-size:10px;padding:5px 7px}
        .map-post-reactions-row{gap:4px}
      }
      @media(min-width:951px){.mobile-view-tabs{display:none!important}}
      @media(max-width:950px){
        .mobile-view-tabs{position:sticky;bottom:0;z-index:3000;display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:7px;background:var(--theme-panel,#fff);border-top:1px solid var(--theme-border-soft,#dfe7dc)}
        .mobile-view-tab{border:1px solid var(--theme-border,#c8d3c6);border-radius:9px;background:var(--theme-main-pale,#f3f7f1);color:var(--theme-text,#294237);padding:9px;font:inherit;font-weight:800;cursor:pointer}
        .mobile-view-tab.active{background:var(--theme-main,#2f7d4a);color:#fff;border-color:var(--theme-main,#2f7d4a)}
        body.mobile-map-view .chat-panel{display:none!important}
        body.mobile-map-view .map-panel{display:block!important}
        body:not(.mobile-map-view) .map-panel{display:none!important}
      }
      @media(max-width:650px){body.pre-auth .mobile-view-tabs{display:none!important}}
    `;
    document.head.appendChild(style);
  }

  function isNearBottom() {
    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 42;
  }

  function resetUnread() {
    unreadCount = 0;
    unreadBtn.hidden = true;
    if (unreadCountEl) unreadCountEl.textContent = '0';
    document.title = 'チャットマップ';
  }

  function markUnread(data) {
    if (data?.username === currentUsername) return;
    if (isNearBottom() && !document.hidden) return;
    unreadCount += 1;
    if (unreadCountEl) unreadCountEl.textContent = String(unreadCount);
    unreadBtn.hidden = false;
    document.title = `(${unreadCount}) チャットマップ`;
    if (localStorage.getItem('rural-notifications-enabled') === '1' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(`${data?.username || '新しい投稿'}さんの新着投稿`, { body: String(data?.message || '').slice(0, 100) });
      } catch {}
    }
  }

  function getBlockedUsers() {
    try {
      const list = JSON.parse(localStorage.getItem(BLOCKED_KEY) || '[]');
      return new Set(Array.isArray(list) ? list.map(v => String(v).trim()).filter(Boolean) : []);
    } catch { return new Set(); }
  }
  function saveBlockedUsers(set) {
    try { localStorage.setItem(BLOCKED_KEY, JSON.stringify([...set].slice(0, 100))); } catch {}
  }
  function isBlocked(username) {
    return getBlockedUsers().has(String(username || '').trim());
  }

  function filterBlockedMessages() {
    const blocked = getBlockedUsers();
    messagesEl.querySelectorAll('.message').forEach(item => {
      item.classList.toggle('rural-blocked', blocked.has(item.dataset.username || ''));
    });
  }

  function getReactions(item) {
    try {
      const raw = JSON.parse(item.dataset.reactions || '{}');
      return {
        like: Array.isArray(raw.like) ? raw.like : [],
        helpful: Array.isArray(raw.helpful) ? raw.helpful : [],
        thanks: Array.isArray(raw.thanks) ? raw.thanks : []
      };
    } catch { return { like: [], helpful: [], thanks: [] }; }
  }

  function ensureMapPostReactionControls(item) {
    if (!item || item.dataset.location !== '1') return null;

    let host = item.querySelector(':scope > .map-post-reactions');
    if (!host) {
      host = document.createElement('div');
      host.className = 'map-post-reactions';
      const bubble = item.querySelector(':scope > .message-bubble');
      if (bubble) bubble.insertAdjacentElement('afterend', host);
      else item.appendChild(host);
    }
    return host;
  }

  function getReactionRenderHost(item) {
    if (!item) return null;
    if (item.dataset.location === '1') return ensureMapPostReactionControls(item);
    return item.querySelector(':scope > .message-actions');
  }

  function renderReactionControls(item) {
    const host = getReactionRenderHost(item);
    if (!host) return;

    if (item.dataset.location === '1') {
      host.replaceChildren();
      const label = document.createElement('div');
      label.className = 'map-post-reactions-title';
      label.textContent = 'この投稿への意思表示';
      host.appendChild(label);

      const row = document.createElement('div');
      row.className = 'map-post-reactions-row';
      host.appendChild(row);

      for (const info of REACTION_TYPES) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'message-action-btn';
        button.dataset.reaction = info.key;
        row.appendChild(button);
      }
    }

    host.querySelectorAll('[data-reaction]').forEach(button => {
      const type = button.dataset.reaction;
      const reactions = getReactions(item);
      const users = reactions[type] || [];
      const me = typeof currentUsername === 'string' ? currentUsername : '';
      const active = me && users.includes(me);
      const info = REACTION_TYPES.find(r => r.key === type);
      button.textContent = String(info?.label || '') + (users.length ? ' ' + users.length : '');
      button.title = String(info?.title || '') + '（' + users.length + '人）';
      button.classList.toggle('active', Boolean(active));
    });
  }
  function ensureMessageActions(item) {
    if (!item || !item.dataset.messageId || item.dataset.messageId === '') return;
    const id = String(item.dataset.messageId || '').trim();
    const username = String(item.dataset.username || '').trim();
    if (!id || !username) return;

    // buildMessageElement() が自分の通常投稿に削除ボタン用の
    // .message-actions を先に作る場合があるため、操作欄の存在だけで
    // 処理を終了せず、不足している返信・リアクション操作を追加します。
    let actions = item.querySelector(':scope > .message-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'message-actions';
      item.appendChild(actions);
    }

    if (!actions.querySelector('[data-action="reply"]')) {
      const replyBtn = document.createElement('button');
      replyBtn.type = 'button';
      replyBtn.className = 'message-action-btn';
      replyBtn.textContent = '↩︎ 返信';
      replyBtn.dataset.action = 'reply';
      actions.insertBefore(replyBtn, actions.querySelector('.message-actions-spacer') || null);
    }

    if (item.dataset.location === '1') {
      ensureMapPostReactionControls(item);
    } else {
      for (const info of REACTION_TYPES) {
        if (actions.querySelector(`[data-reaction="${info.key}"]`)) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'message-action-btn';
        button.dataset.reaction = info.key;
        const spacer = actions.querySelector('.message-actions-spacer');
        if (spacer) actions.insertBefore(button, spacer);
        else actions.appendChild(button);
      }
    }
    let spacer = actions.querySelector('.message-actions-spacer');
    if (!spacer) {
      spacer = document.createElement('span');
      spacer.className = 'message-actions-spacer';
      actions.appendChild(spacer);
    }

    if (item.dataset.location === '1' && username === currentUsername && !actions.querySelector('[data-action="resolve"]')) {
      const resolveBtn = document.createElement('button');
      resolveBtn.type = 'button';
      resolveBtn.className = 'message-action-btn';
      resolveBtn.dataset.action = 'resolve';
      actions.appendChild(resolveBtn);
    }

    if (username !== currentUsername) {
      if (!actions.querySelector('[data-action="report"]')) {
        const reportBtn = document.createElement('button');
        reportBtn.type = 'button';
        reportBtn.className = 'message-action-btn';
        reportBtn.textContent = '⚠️ 通報';
        reportBtn.dataset.action = 'report';
        actions.appendChild(reportBtn);
      }

      if (!actions.querySelector('[data-action="block"]')) {
        const blockBtn = document.createElement('button');
        blockBtn.type = 'button';
        blockBtn.className = 'message-action-btn';
        blockBtn.textContent = isBlocked(username) ? '🚫 ブロック中' : '🚫 ブロック';
        blockBtn.dataset.action = 'block';
        blockBtn.disabled = isBlocked(username);
        actions.appendChild(blockBtn);
      }
    }

    if (item.dataset.location === '1') ensureMapPostReactionControls(item);
    renderReactionControls(item);
    updateResolveButton(item);
    if (isBlocked(username)) item.classList.add('rural-blocked');
  }

  window.ruralEnhanceMessage = ensureMessageActions;

  function updateResolveButton(item) {
    const button = item.querySelector('[data-action="resolve"]');
    if (!button) return;
    const resolved = item.dataset.status === 'resolved';
    button.textContent = resolved ? '↩︎ 未解決に戻す' : '✅ 解決済みにする';
  }

  function enhanceAllMessages() {
    messagesEl.querySelectorAll('.message').forEach(ensureMessageActions);
    filterBlockedMessages();
  }

  function focusMessage(id) {
    if (!id) return false;
    const safeId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(String(id)) : String(id).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    const item = messagesEl.querySelector(`.message[data-message-id="${safeId}"]`);
    if (!item) return false;
    item.classList.remove('rural-highlight');
    void item.offsetWidth;
    item.classList.add('rural-highlight');
    item.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => item.classList.remove('rural-highlight'), 3200);
    return true;
  }

  async function focusMessageById(id) {
    const targetId = String(id || '').trim();
    if (!targetId) return false;

    if (focusMessage(targetId)) return true;

    // 通報された投稿が最初の50件より古い場合は、履歴を追加読み込みして探します。
    for (let attempt = 0; attempt < 20 && hasMoreHistory; attempt += 1) {
      loadMoreHistory();
      await new Promise(resolve => {
        const wait = () => {
          if (!loadMoreBusy) resolve();
          else window.setTimeout(wait, 80);
        };
        wait();
      });
      if (focusMessage(targetId)) return true;
    }

    return false;
  }

  window.ruralFocusMessageById = focusMessageById;

  function focusMapForMessage(id) {
    if (!id || typeof map === 'undefined') return;
    const marker = window.ruralMarkerByMessageId?.get(id);
    if (!marker) {
      setStatusText('この投稿の地図ピンが見つかりません。');
      return;
    }
    const point = marker.getLatLng?.();
    if (!point) return;
    document.body.classList.add('mobile-map-view');
    document.querySelectorAll('.mobile-view-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.mobileView === 'map'));
    if (!map.hasLayer(marker)) map.addLayer(marker);
    map.setView(point, Math.max(14, map.getZoom()), { animate: true });
    window.setTimeout(() => marker.openPopup?.(), 350);
  }

  function setStatusText(text) {
    const status = $('status');
    if (status) status.textContent = text;
  }

  function applySearch() {
    filterBlockedMessages();
    if (hasMoreHistory) setStatusText('過去の投稿も読み込めます。');
  }

  function closeInlineReplyEditors() {
    messagesEl.querySelectorAll('.inline-reply-composer').forEach(editor => editor.remove());
  }

  function createInlineReplyEditor(item, target) {
    closeInlineReplyEditors();
    const editor = document.createElement('div');
    editor.className = 'inline-reply-composer';
    editor.innerHTML = `
      <div class="inline-reply-label">↩︎ ${escapeHtml(target.username || '投稿者')}さんに返信</div>
      <div class="inline-reply-row">
        <input type="text" class="inline-reply-input" maxlength="2000" placeholder="返信を入力…" autocomplete="off">
        <button type="button" class="inline-reply-send">返信</button>
        <button type="button" class="inline-reply-cancel" aria-label="返信を閉じる">×</button>
      </div>`;
    item.appendChild(editor);

    const input = editor.querySelector('.inline-reply-input');
    const send = editor.querySelector('.inline-reply-send');
    const cancel = editor.querySelector('.inline-reply-cancel');

    cancel?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      window.ruralSetReplyTarget?.(null);
    });

    send?.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      const text = String(input?.value || '').trim();
      if (!text) {
        input?.focus();
        return;
      }
      if (!window.ruralSendTextMessage) {
        setStatusText('返信機能を読み込めませんでした。ページを更新してください。');
        return;
      }
      send.disabled = true;
      try {
        const ok = await window.ruralSendTextMessage(text, target);
        if (ok && input) input.value = '';
      } finally {
        send.disabled = false;
      }
    });

    input?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        send?.click();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancel?.click();
      }
    });
    input?.focus();
    return editor;
  }

  function setReplyTarget(item) {
    const target = {
      id: item.dataset.messageId,
      username: item.dataset.username || '投稿者',
      message: item.dataset.messageText || ''
    };
    const currentTarget = window.ruralGetReplyTarget?.();
    if (currentTarget?.id === target.id && item.querySelector('.inline-reply-composer')) {
      window.ruralSetReplyTarget?.(null);
      return;
    }
    window.ruralSetReplyTarget?.(target);
    createInlineReplyEditor(item, target);
  }

  function updateReplyPreviewUi(target) {
    if (!target) {
      closeInlineReplyEditors();
      if (replyPreviewUser) replyPreviewUser.textContent = '';
      if (replyPreviewText) replyPreviewText.textContent = '';
      if (replyPreview) replyPreview.hidden = true;
      return;
    }
    if (replyPreview) replyPreview.hidden = true;
  }

  function notifyStatus() {
    if (!notifyBtn) return;
    const enabled = localStorage.getItem('rural-notifications-enabled') === '1';
    notifyBtn.textContent = enabled ? '🔕 通知OFF' : '🔔 通知';
  }

  async function toggleNotifications() {
    if (!('Notification' in window)) {
      setStatusText('このブラウザでは通知を利用できません。');
      return;
    }
    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatusText('ブラウザの通知が許可されませんでした。');
        notifyStatus();
        return;
      }
    }
    if (Notification.permission !== 'granted') {
      setStatusText('ブラウザの通知設定から許可してください。');
      return;
    }
    const next = localStorage.getItem('rural-notifications-enabled') !== '1';
    if (next) localStorage.setItem('rural-notifications-enabled', '1');
    else localStorage.removeItem('rural-notifications-enabled');
    notifyStatus();
    setStatusText(next ? '🔔 新着投稿の通知をONにしました。' : '🔕 新着投稿の通知をOFFにしました。');
  }

  function createModal(id, title) {
    let modal = $(id);
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = id;
    modal.className = 'rural-modal';
    modal.hidden = true;
    modal.innerHTML = `<div class="rural-modal-backdrop"></div><section class="rural-modal-box" role="dialog" aria-modal="true"><div class="rural-modal-head"><h2>${escapeHtml(title)}</h2><button class="rural-modal-close" type="button" aria-label="閉じる">×</button></div><div class="rural-modal-body"></div></section>`;
    document.body.appendChild(modal);
    modal.querySelector('.rural-modal-backdrop').addEventListener('click', () => modal.hidden = true);
    modal.querySelector('.rural-modal-close').addEventListener('click', () => modal.hidden = true);
    return modal;
  }

  function openLeaderboard() {
    const modal = createModal('rural-leaderboard-modal', '🏆 地域ポイントランキング');
    const body = modal.querySelector('.rural-modal-body');
    body.innerHTML = '<div style="text-align:center;padding:22px;color:var(--theme-text-soft,#728078)">ランキングを読み込んでいます…</div>';
    modal.hidden = false;
    socket.timeout(8000).emit('request-points-leaderboard', {}, (err, result) => {
      if (modal.hidden) return;
      if (err || !result?.ok) {
        body.innerHTML = '<div style="text-align:center;padding:22px;color:var(--theme-text-soft,#728078)">ランキングを取得できませんでした。</div>';
        return;
      }
      const rows = Array.isArray(result.leaderboard) ? result.leaderboard : [];
      if (!rows.length) {
        body.innerHTML = '<div style="text-align:center;padding:22px;color:var(--theme-text-soft,#728078)">まだランキングに表示できるポイントがありません。</div>';
        return;
      }
      body.innerHTML = rows.map((row,index) => `<div class="leader-row"><div class="leader-rank">${index+1}</div><div class="leader-name">${escapeHtml(row.username)}</div><div class="leader-points">⭐ ${Number(row.points || 0)}pt</div></div>`).join('');
    });
  }

  function openBlockedManager() {
    const modal = createModal('rural-blocked-modal', '🚫 ブロックしたユーザー');
    const body = modal.querySelector('.rural-modal-body');
    const render = () => {
      const names = [...getBlockedUsers()];
      if (!names.length) {
        body.innerHTML = '<div style="text-align:center;padding:22px;color:var(--theme-text-soft,#728078)">ブロックしているユーザーはいません。</div>';
        return;
      }
      body.innerHTML = names.map(name => `<div class="blocked-row"><strong>${escapeHtml(name)}</strong><button type="button" data-unblock="${escapeHtml(name)}">ブロック解除</button></div>`).join('');
    };
    body.addEventListener('click', event => {
      const btn = event.target.closest('[data-unblock]');
      if (!btn) return;
      const set = getBlockedUsers();
      set.delete(btn.dataset.unblock || '');
      saveBlockedUsers(set);
      render();
      filterBlockedMessages();
      setStatusText(`${btn.dataset.unblock}さんのブロックを解除しました。`);
    });
    render();
    modal.hidden = false;
  }

  function reportMessage(item) {
    const reason = window.prompt('通報理由を入力してください。例：迷惑行為、危険な情報、不適切な内容など');
    const clean = String(reason || '').trim().slice(0, 100);
    if (!clean) return;

    const id = String(item.dataset.messageId || '').trim();
    const message = String(item.dataset.messageText || item.querySelector('.message-bubble')?.textContent || '').trim().slice(0, 2000);
    const targetUsername = String(item.dataset.username || '').trim().slice(0, 50);
    if (!id || !message) {
      setStatusText('通報対象のメッセージ情報を取得できませんでした。');
      return;
    }

    const button = item.querySelector('[data-action="report"]');
    if (button) { button.disabled = true; button.textContent = '送信中…'; }
    socket.timeout(10000).emit('submit-report', {
      id,
      reason: clean,
      message,
      targetUsername
    }, (err, result) => {
      if (err || !result?.ok) {
        if (button) { button.disabled = false; button.textContent = '⚠️ 通報'; }
        setStatusText(result?.message || '通報の送信に失敗しました。もう一度お試しください。');
        return;
      }
      if (button) { button.disabled = true; button.textContent = '✅ 通報済み'; }
      setStatusText('通報を受け付けました。管理者が確認します。');
    });
  }

  function blockMessageUser(item) {
    const username = item.dataset.username || '';
    if (!username || username === currentUsername) return;
    if (!window.confirm(`${username}さんの投稿を今後この端末で非表示にしますか？`)) return;
    const blocked = getBlockedUsers();
    blocked.add(username);
    saveBlockedUsers(blocked);
    filterBlockedMessages();
    setStatusText(`${username}さんをブロックしました。`);
  }

  function handleMessageAction(event) {
    const button = event.target.closest('[data-action],[data-reaction]');
    if (!button) return;
    const item = event.target.closest('.message');
    if (!item) return;
    event.preventDefault();
    event.stopPropagation();

    const id = item.dataset.messageId;
    if (!id) return;

    if (button.dataset.action === 'reply') return setReplyTarget(item);
    if (button.dataset.action === 'map') return focusMapForMessage(id);
    if (button.dataset.action === 'report') return reportMessage(item);
    if (button.dataset.action === 'block') return blockMessageUser(item);

    if (button.dataset.action === 'resolve') {
      button.disabled = true;
      socket.timeout(10000).emit('toggle-resolved', { id }, (err, result) => {
        button.disabled = false;
        if (err || !result?.ok) {
          setStatusText(result?.reason === 'not-owner' ? '投稿者本人だけが解決状態を変更できます。' : '解決状態の変更に失敗しました。');
          return;
        }
        item.dataset.status = result.status === 'resolved' ? 'resolved' : 'open';
        updateResolveButton(item);
        updateResolvedBadge(item);
      });
      return;
    }

    const reaction = button.dataset.reaction;
    if (reaction) {
      button.disabled = true;
      socket.timeout(10000).emit('toggle-reaction', { id, reaction }, (err, result) => {
        button.disabled = false;
        if (err || !result?.ok) {
          setStatusText('リアクションの更新に失敗しました。');
          return;
        }
        item.dataset.reactions = JSON.stringify(result.reactions || {});
        renderReactionControls(item);
      });
    }
  }

  function updateResolvedBadge(item) {
    const badges = item.querySelector('.message-badges');
    if (!badges) return;
    let badge = badges.querySelector('.message-resolved-badge');
    if (item.dataset.status === 'resolved') {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'message-resolved-badge';
        badges.appendChild(badge);
      }
      badge.textContent = '✅ 解決済み';
    } else if (badge) {
      badge.remove();
    }
  }

  function handleMessageClick(event) {
    if (event.target.closest('.message-actions,.message-replies-toggle')) return;

    const replyReference = event.target.closest('[data-reply-target]');
    if (replyReference) {
      const targetId = String(replyReference.dataset.replyTarget || '').trim();
      if (targetId) {
        event.preventDefault();
        event.stopPropagation();
        focusMessage(targetId);
      }
      return;
    }

    const item = event.target.closest('.message');
    if (!item || item.hidden || item.classList.contains('rural-blocked')) return;
    if (item.dataset.location === '1') {
      focusMapForMessage(item.dataset.messageId);
    }
  }

  function prependOlderMessages(items) {
    const fragment = document.createDocumentFragment();
    const built = [];
    for (const data of items) {
      const item = window.ruralBuildMessageElement?.(data);
      if (!item) continue;
      fragment.appendChild(item);
      built.push({ item, data });
      window.ruralAddMarker?.(data);
    }
    const firstMessage = messagesEl.querySelector('.message');
    const beforeHeight = messagesEl.scrollHeight;
    if (firstMessage) messagesEl.insertBefore(fragment, firstMessage);
    else messagesEl.appendChild(fragment);
    const afterHeight = messagesEl.scrollHeight;
    messagesEl.scrollTop += afterHeight - beforeHeight;
    built.forEach(({item}) => ensureMessageActions(item));
    window.ruralOrganizeReplies?.();
    filterBlockedMessages();
    applySearch();
  }

  function loadMoreHistory() {
    if (loadMoreBusy || !hasMoreHistory) return;
    loadMoreBusy = true;
    if (loadMoreBtn) { loadMoreBtn.disabled = true; loadMoreBtn.textContent = '⏳ 読み込み中…'; }
    socket.timeout(10000).emit('load-more-chat-history', {}, (err, result) => {
      loadMoreBusy = false;
      if (err || !result?.ok) {
        setStatusText('過去の投稿を読み込めませんでした。');
        if (loadMoreBtn) { loadMoreBtn.disabled = false; loadMoreBtn.textContent = '↑ 過去の投稿を読み込む'; }
        return;
      }
      prependOlderMessages(Array.isArray(result.messages) ? result.messages : []);
      hasMoreHistory = Boolean(result.hasMore);
      if (loadMoreBtn) {
        loadMoreBtn.hidden = !hasMoreHistory;
        loadMoreBtn.disabled = false;
        loadMoreBtn.textContent = '↑ 過去の投稿を読み込む';
      }
      setStatusText(hasMoreHistory ? '過去の投稿を追加しました。' : '過去の投稿をすべて読み込みました。');
    });
  }

  function removeClusters() {
    for (const cluster of clusters) {
      if (map?.hasLayer(cluster)) map.removeLayer(cluster);
    }
    clusters = [];
  }

  function refreshClusters() {
    if (typeof map === 'undefined') return;
    removeClusters();
    const markers = [...(window.ruralMarkerByMessageId?.values?.() || [])];
    const unique = [...new Set(markers)].filter(marker => marker && marker.__messageId);
    const activeFilter = document.querySelector('.map-filter.active')?.dataset.filter || 'all';

    unique.forEach(marker => {
      if (!marker) return;
      marker.__ruralClusterManaged = true;
      const allowed = activeFilter === 'all' || marker.__eventType === activeFilter;
      if (allowed) map.addLayer(marker);
      else if (map.hasLayer(marker)) map.removeLayer(marker);
    });

    if (map.getZoom() >= 12) return;
    const cellSize = map.getZoom() <= 9 ? 0.12 : 0.045;
    const groups = new Map();
    for (const marker of unique) {
      if (!map.hasLayer(marker)) continue;
      const p = marker.getLatLng?.();
      if (!p) continue;
      const key = `${Math.floor(p.lat/cellSize)}:${Math.floor(p.lng/cellSize)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(marker);
    }

    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const avg = members.reduce((acc,m)=>{const p=m.getLatLng();acc.lat+=p.lat;acc.lng+=p.lng;return acc;},{lat:0,lng:0});
      avg.lat/=members.length; avg.lng/=members.length;
      members.forEach(marker => { marker.__ruralClusterHidden = true; if (map.hasLayer(marker)) map.removeLayer(marker); });
      const cluster=L.circleMarker([avg.lat,avg.lng],{radius:19,color:getComputedStyle(document.body).getPropertyValue('--theme-main').trim()||'#2f7d4a',weight:3,fillColor:getComputedStyle(document.body).getPropertyValue('--theme-main').trim()||'#2f7d4a',fillOpacity:.95});
      cluster.bindTooltip(String(members.length),{permanent:true,direction:'center',className:'pin-cluster-label',offset:[0,0]});
      cluster.on('click',()=>map.fitBounds(L.latLngBounds(members.map(m=>m.getLatLng())),{padding:[35,35],maxZoom:15}));
      cluster.addTo(map);
      clusters.push(cluster);
    }
  }

  function scheduleClusterRefresh() {
    if (clusterRefreshTimer) window.clearTimeout(clusterRefreshTimer);
    clusterRefreshTimer=window.setTimeout(refreshClusters,120);
  }

  function handleMarkerClick(event) {
    const id=String(event?.detail?.messageId||'').trim();
    if (!id) return;
    window.setTimeout(()=>focusMessage(id),80);
  }

  function setupMobileTabs() {
    mobileTabs.forEach(tab=>{
      tab.addEventListener('click',()=>{
        const view=tab.dataset.mobileView||'chat';
        document.body.classList.toggle('mobile-map-view',view==='map');
        mobileTabs.forEach(btn=>btn.classList.toggle('active',btn===tab));
        if(view==='map') window.setTimeout(()=>map?.invalidateSize?.(true),100);
        else messagesEl?.focus?.();
      });
    });
  }

  injectStyles();
  setupMobileTabs();
  notifyStatus();

  unreadBtn?.addEventListener('click',()=>{resetUnread();messagesEl.scrollTo({top:messagesEl.scrollHeight,behavior:'smooth'});});
  messagesEl.addEventListener('scroll',()=>{if(isNearBottom()) resetUnread();});
  messagesEl.addEventListener('click',handleMessageAction);
  messagesEl.addEventListener('click',handleMessageClick);
  messagesEl.addEventListener('keydown',event=>{
    const ref=event.target.closest?.('[data-reply-target]');
    if(!ref) return;
    if(event.key==='Enter'||event.key===' '){
      event.preventDefault();
      event.stopPropagation();
      const targetId=String(ref.dataset.replyTarget||'').trim();
      if(targetId) focusMessage(targetId);
    }
  });
  loadMoreBtn?.addEventListener('click',loadMoreHistory);
  notifyBtn?.addEventListener('click',toggleNotifications);
  leaderboardBtn?.addEventListener('click',openLeaderboard);

  if (replyCancel) replyCancel.addEventListener('click',()=>window.ruralSetReplyTarget?.(null));
  window.addEventListener('rural-reply-target-changed',event=>updateReplyPreviewUi(event.detail||null));
  window.addEventListener('rural-map-marker-clicked',handleMarkerClick);

  socket.on('chat-history-meta',data=>{
    hasMoreHistory=Boolean(data?.hasMore);
    if(loadMoreBtn) loadMoreBtn.hidden=!hasMoreHistory;
  });
  socket.on('chat-history',()=>window.setTimeout(enhanceAllMessages,0));
  socket.on('chat-history-end',()=>{enhanceAllMessages();scheduleClusterRefresh();});
  socket.on('receive-message',data=>{
    window.setTimeout(enhanceAllMessages,0);
    markUnread(data);
    scheduleClusterRefresh();
  });
  socket.on('message-reactions-updated',data=>{
    const id=String(data?.id||'').trim(); if(!id)return;
    const item=messagesEl.querySelector(`.message[data-message-id="${CSS.escape(id)}"]`);
    if(!item)return;
    item.dataset.reactions=JSON.stringify(data.reactions||{});
    renderReactionControls(item);
  });
  socket.on('message-resolved-updated',data=>{
    const id=String(data?.id||'').trim(); if(!id)return;
    const item=messagesEl.querySelector(`.message[data-message-id="${CSS.escape(id)}"]`);
    if(!item)return;
    item.dataset.status=data.status==='resolved'?'resolved':'open';
    updateResolveButton(item);
    updateResolvedBadge(item);
  });
  socket.on('chat-message-deleted',()=>{window.setTimeout(()=>{enhanceAllMessages();scheduleClusterRefresh();},0);});
  socket.on('map-pin-deleted',()=>scheduleClusterRefresh());
  socket.on('map-pin-help-updated',()=>scheduleClusterRefresh());
  document.addEventListener('click',event=>{
    if(event.target.closest('.map-filter')) window.setTimeout(scheduleClusterRefresh,80);
  });
  map?.on?.('zoomend moveend',scheduleClusterRefresh);

  if (typeof MutationObserver !== 'undefined') {
    const observer=new MutationObserver(()=>enhanceAllMessages());
    observer.observe(messagesEl,{childList:true});
  }

  blockedUsersBtn?.addEventListener('click', openBlockedManager);

  window.__ruralToolbarHandlersReady = true;
})();

/* 親投稿の操作ボタンを押しやすいサイズに調整（返信側は従来の小型サイズを維持） */
.messages .message:not(.reply-message) .message-actions .message-action-btn{
  min-height:32px!important;
  padding:6px 10px!important;
  font-size:12px!important;
  line-height:1.15!important;
}

/* チャット内レイアウトを安定化：長文・返信・操作ボタンが横にはみ出さないよう調整 */
.messages .message{
  min-width:0!important;
  max-width:100%!important;
  overflow:hidden!important;
}
.messages .message-header{
  min-width:0!important;
}
.messages .message-header span{
  min-width:0!important;
  max-width:50%!important;
  overflow:hidden!important;
  text-overflow:ellipsis!important;
  white-space:nowrap!important;
}
.messages .message-bubble{
  min-width:0!important;
  max-width:100%!important;
  overflow-wrap:anywhere!important;
  word-break:break-word!important;
}
.messages .message-actions{
  width:100%!important;
  max-width:100%!important;
  min-width:0!important;
  box-sizing:border-box!important;
  display:flex!important;
  flex-wrap:wrap!important;
  align-items:center!important;
  gap:6px!important;
  overflow:visible!important;
}
.messages .message-actions .message-action-btn,
.messages .message-actions .chat-delete-btn{
  box-sizing:border-box!important;
  flex:0 0 auto!important;
  white-space:nowrap!important;
}
.messages .message-actions-spacer{
  flex:1 1 12px!important;
  min-width:12px!important;
}
.messages .message-replies{
  min-width:0!important;
  max-width:100%!important;
  box-sizing:border-box!important;
}
.messages .message-replies-list{
  min-width:0!important;
  max-width:100%!important;
}
.messages .message.reply-message{
  min-width:0!important;
  max-width:100%!important;
  box-sizing:border-box!important;
}
@media(max-width:650px){
  .messages .message-actions{
    gap:5px!important;
  }
  .messages .message-actions-spacer{
    display:none!important;
  }
  .messages .message:not(.reply-message) .message-actions .message-action-btn{
    min-height:30px!important;
    padding:5px 8px!important;
    font-size:11px!important;
  }
}
