(() => {
  if (window.__ruralPointsHistoryInitialized) return;
  window.__ruralPointsHistoryInitialized = true;
  const pointsEl = document.getElementById('regional-points');
  if (!pointsEl || typeof socket === 'undefined') return;

  let modal = null;
  let loading = false;

  function ensureStyles() {
    if (document.getElementById('points-history-style')) return;
    const style = document.createElement('style');
    style.id = 'points-history-style';
    style.textContent = `
      #points-history-modal{position:fixed;inset:0;z-index:5000;display:grid;place-items:center;padding:18px}
      #points-history-modal[hidden]{display:none}
      .points-history-backdrop{position:absolute;inset:0;background:rgba(20,35,27,.42);backdrop-filter:blur(2px)}
      .points-history-box{position:relative;z-index:1;width:min(560px,100%);max-height:min(78vh,720px);overflow:auto;background:#fff;border:1px solid #d7e2d4;border-radius:16px;box-shadow:0 18px 50px rgba(20,45,30,.22);color:#294235}
      .points-history-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:17px 18px;border-bottom:1px solid #e7ede5;position:sticky;top:0;background:#fff;z-index:2}
      .points-history-head h2{margin:0;font-size:19px;color:#234d3c}
      .points-history-close{border:0;background:#eef2ee;color:#31513f;width:34px;height:34px;border-radius:9px;cursor:pointer;font-size:18px}
      .points-history-balance{margin:14px 18px 10px;padding:12px 14px;background:#f4f8f2;border:1px solid #dfe9dc;border-radius:11px;font-weight:700;color:#31513f}
      .points-history-list{padding:4px 18px 18px}
      .points-history-empty,.points-history-loading{padding:22px 8px;text-align:center;color:#728078;font-size:13px}
      .points-history-item{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 6px;border-bottom:1px solid #edf1eb}
      .points-history-main{min-width:0}
      .points-history-reason{font-size:14px;font-weight:700;color:#31513f}
      .points-history-date{margin-top:4px;font-size:11px;color:#89958e}
      .points-history-points{flex:0 0 auto;font-size:15px;font-weight:800;color:#2d8a57}
    `;
    document.head.appendChild(style);
  }

  function createModal() {
    ensureStyles();
    const wrapper = document.createElement('div');
    wrapper.id = 'points-history-modal';
    wrapper.hidden = true;
    wrapper.innerHTML = `
      <div class="points-history-backdrop"></div>
      <section class="points-history-box" role="dialog" aria-modal="true" aria-labelledby="points-history-title">
        <div class="points-history-head">
          <h2 id="points-history-title">⭐ 地域ポイント履歴</h2>
          <button type="button" class="points-history-close" aria-label="閉じる">×</button>
        </div>
        <div class="points-history-balance">現在のポイント：<span class="points-history-current">0</span>pt</div>
        <div class="points-history-list"></div>
      </section>
    `;
    document.body.appendChild(wrapper);
    wrapper.querySelector('.points-history-backdrop').addEventListener('click', close);
    wrapper.querySelector('.points-history-close').addEventListener('click', close);
    return wrapper;
  }

  function close() {
    if (modal) modal.hidden = true;
    loading = false;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('ja-JP', { year:'numeric', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' });
  }

  function renderHistory(items, points) {
    const list = modal.querySelector('.points-history-list');
    modal.querySelector('.points-history-current').textContent = String(Number(points || 0));
    if (!Array.isArray(items) || !items.length) {
      list.innerHTML = '<div class="points-history-empty">まだ地域ポイントを獲得した履歴はありません。</div>';
      return;
    }
    list.innerHTML = items.map(item => `
      <div class="points-history-item">
        <div class="points-history-main">
          <div class="points-history-reason">${escapeHtml(item.reason || '地域活動への協力')}</div>
          <div class="points-history-date">${escapeHtml(formatDate(item.createdAt))}</div>
        </div>
        <div class="points-history-points">+${Number(item.points || 0)}pt</div>
      </div>
    `).join('');
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>\"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  }

  function open() {
    if (!modal) modal = createModal();
    modal.hidden = false;
    const list = modal.querySelector('.points-history-list');
    list.innerHTML = '<div class="points-history-loading">履歴を読み込んでいます…</div>';
    loading = true;
    socket.timeout(8000).emit('request-points-history', {}, (err, result) => {
      loading = false;
      if (modal.hidden) return;
      if (err || !result?.ok) {
        list.innerHTML = '<div class="points-history-empty">履歴を取得できませんでした。しばらくしてから再度お試しください。</div>';
        return;
      }
      renderHistory(result.history || [], result.points || 0);
    });
  }

  pointsEl.style.cursor = 'pointer';
  pointsEl.setAttribute('role', 'button');
  pointsEl.setAttribute('tabindex', '0');
  pointsEl.setAttribute('aria-label', '地域ポイントの獲得履歴を表示');
  pointsEl.title = 'クリックすると地域ポイントの獲得履歴を表示';
  pointsEl.addEventListener('click', open);
  pointsEl.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && modal && !modal.hidden) close();
  });
})();
