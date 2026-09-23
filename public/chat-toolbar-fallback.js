(() => {
  if (window.__ruralToolbarFallbackBound) return;

  const setup = () => {
    if (window.__ruralToolbarHandlersReady) return;
    if (window.__ruralToolbarFallbackBound) return;
    window.__ruralToolbarFallbackBound = true;

    const $ = id => document.getElementById(id);
    const setStatus = text => {
      const el = $('status');
      if (el) el.textContent = text;
    };

    const ensureModalStyles = () => {
      if ($('rural-toolbar-fallback-style')) return;
      const style = document.createElement('style');
      style.id = 'rural-toolbar-fallback-style';
      style.textContent = `
        .rural-toolbar-fallback-modal{position:fixed;inset:0;z-index:20000;display:grid;place-items:center;padding:18px;background:rgba(15,28,20,.48)}
        .rural-toolbar-fallback-box{width:min(560px,100%);max-height:min(78vh,720px);overflow:auto;background:#fff;color:#294237;border-radius:16px;box-shadow:0 20px 60px rgba(15,35,24,.28)}
        .rural-toolbar-fallback-head{display:flex;align-items:center;justify-content:space-between;padding:15px 17px;border-bottom:1px solid #e3e9e0;position:sticky;top:0;background:#fff}
        .rural-toolbar-fallback-head h2{margin:0;font-size:18px}
        .rural-toolbar-fallback-close{border:0;background:#edf3eb;color:#294237;width:34px;height:34px;border-radius:9px;cursor:pointer;font-size:18px}
        .rural-toolbar-fallback-body{padding:15px 17px}
      `;
      document.head.appendChild(style);
    };

    const closeModal = modal => {
      if (modal) modal.remove();
    };

    const openModal = (title, bodyHtml) => {
      ensureModalStyles();
      document.querySelectorAll('.rural-toolbar-fallback-modal').forEach(closeModal);
      const modal = document.createElement('div');
      modal.className = 'rural-toolbar-fallback-modal';
      modal.innerHTML = `
        <section class="rural-toolbar-fallback-box" role="dialog" aria-modal="true">
          <div class="rural-toolbar-fallback-head">
            <h2>${title}</h2>
            <button type="button" class="rural-toolbar-fallback-close" aria-label="閉じる">×</button>
          </div>
          <div class="rural-toolbar-fallback-body">${bodyHtml}</div>
        </section>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', event => {
        if (event.target === modal || event.target.closest('.rural-toolbar-fallback-close')) closeModal(modal);
      });
      return modal;
    };

    const notify = async () => {
      if (!('Notification' in window)) {
        setStatus('このブラウザでは通知を利用できません。');
        return;
      }
      try {
        if (Notification.permission === 'default') {
          const permission = await Notification.requestPermission();
          if (permission !== 'granted') {
            setStatus('ブラウザの通知が許可されませんでした。');
            return;
          }
        }
        if (Notification.permission !== 'granted') {
          setStatus('ブラウザの通知設定から許可してください。');
          return;
        }
        const next = localStorage.getItem('rural-notifications-enabled') !== '1';
        if (next) localStorage.setItem('rural-notifications-enabled', '1');
        else localStorage.removeItem('rural-notifications-enabled');
        const btn = $('notify-btn');
        if (btn) btn.textContent = next ? '🔕 通知OFF' : '🔔 通知';
        setStatus(next ? '🔔 新着投稿の通知をONにしました。' : '🔕 新着投稿の通知をOFFにしました。');
      } catch (error) {
        console.error('通知設定に失敗:', error);
        setStatus('通知設定を変更できませんでした。');
      }
    };

    const leaderboard = () => {
      const modal = openModal('🏆 地域ポイントランキング', '<div style="text-align:center;padding:22px">ランキングを読み込んでいます…</div>');
      const body = modal.querySelector('.rural-toolbar-fallback-body');
      if (typeof socket === 'undefined') {
        body.innerHTML = '<div style="text-align:center;padding:22px">通信機能を利用できません。</div>';
        return;
      }
      socket.timeout(8000).emit('request-points-leaderboard', {}, (err, result) => {
        if (!document.body.contains(modal)) return;
        if (err || !result?.ok) {
          body.innerHTML = '<div style="text-align:center;padding:22px">ランキングを取得できませんでした。</div>';
          return;
        }
        const rows = Array.isArray(result.leaderboard) ? result.leaderboard : [];
        body.innerHTML = rows.length
          ? rows.map((row,index) => `<div style="display:grid;grid-template-columns:38px 1fr auto;gap:10px;align-items:center;padding:11px 5px;border-bottom:1px solid #edf1eb"><strong style="text-align:center;color:#2f7d4a">${index+1}</strong><strong>${String(row.username || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</strong><strong>⭐ ${Number(row.points || 0)}pt</strong></div>`).join('')
          : '<div style="text-align:center;padding:22px">まだランキングに表示できるポイントがありません。</div>';
      });
    };

    const unread = () => {
      const messages = $('messages');
      const btn = $('unread-btn');
      if (messages) messages.scrollTo({top: messages.scrollHeight, behavior: 'smooth'});
      if (btn) btn.hidden = true;
      const count = $('unread-count');
      if (count) count.textContent = '0';
      document.title = 'チャットマップ';
    };

    const blocked = () => {
      let names = [];
      try {
        const raw = JSON.parse(localStorage.getItem('rural-blocked-users-v1') || '[]');
        if (Array.isArray(raw)) names = raw.map(v => String(v).trim()).filter(Boolean);
      } catch {}
      const body = names.length
        ? names.map(name => `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid #edf1eb"><strong>${name.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</strong><button type="button" data-unblock="${name.replace(/["\\]/g,'\\$&')}" style="border:1px solid #c5d2c2;border-radius:8px;background:#fff;color:#294237;padding:6px 9px;cursor:pointer">ブロック解除</button></div>`).join('')
        : '<div style="text-align:center;padding:22px">ブロックしているユーザーはいません。</div>';
      const modal = openModal('🚫 ブロックしたユーザー', body);
      modal.addEventListener('click', event => {
        const button = event.target.closest('[data-unblock]');
        if (!button) return;
        const target = button.dataset.unblock || '';
        names = names.filter(name => name !== target);
        try { localStorage.setItem('rural-blocked-users-v1', JSON.stringify(names)); } catch {}
        button.parentElement?.remove();
        if (!names.length) modal.querySelector('.rural-toolbar-fallback-body').innerHTML = '<div style="text-align:center;padding:22px">ブロックしているユーザーはいません。</div>';
      });
    };

    const bind = (id, handler) => {
      const btn = $(id);
      if (!btn || btn.dataset.toolbarFallbackBound === '1') return;
      btn.dataset.toolbarFallbackBound = '1';
      btn.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        handler();
      }, true);
    };

    bind('notify-btn', notify);
    bind('leaderboard-btn', leaderboard);
    bind('unread-btn', unread);
    bind('blocked-users-btn', blocked);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup, {once:true});
  } else {
    setup();
  }
})();
