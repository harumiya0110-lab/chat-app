(() => {
  if (window.__ruralThemeShopColorFixInitialized) return;
  window.__ruralThemeShopColorFixInitialized = true;

  const style = document.createElement('style');
  style.id = 'theme-shop-color-fix';
  style.textContent = `
    /* 地域ポイント交換所はテーマ変更後も読みやすい文字色を維持 */
    .theme-shop-modal .theme-shop-box {
      color: #31513f !important;
      background: #fff !important;
    }
    .theme-shop-modal .theme-shop-head h2,
    .theme-shop-modal .theme-shop-section h3,
    .theme-shop-modal .theme-card h4 {
      color: #31513f !important;
    }
    .theme-shop-modal .theme-shop-balance {
      color: #31513f !important;
      background: #f5f8f4 !important;
    }
    .theme-shop-modal .theme-card p,
    .theme-shop-modal .theme-shop-note {
      color: #68796e !important;
    }
    .theme-shop-modal .theme-card button.secondary {
      color: #31513f !important;
      background: #eef2ee !important;
    }
    .theme-shop-modal .theme-card .theme-owned {
      color: #2d8a57 !important;
    }
    .theme-shop-modal .theme-shop-close {
      color: #31513f !important;
      background: #eef2ee !important;
    }
  `;
  document.head.appendChild(style);

  // チャットの見た目交換機能が常時DOM全体を走査し続けないようにします。
  // 既存UIの動作を変えず、問題の重い1.5秒ごとの走査だけを停止します。
  const nativeSetInterval = window.setInterval.bind(window);
  window.setInterval = (handler, delay, ...args) => {
    const source = typeof handler === 'function' ? Function.prototype.toString.call(handler) : '';
    if (delay === 1500 && source.includes('decorateAvatars')) return 0;
    return nativeSetInterval(handler, delay, ...args);
  };

  // decorateAvatars用MutationObserverは、同一フレーム内の大量DOM変更を1回にまとめます。
  const NativeMutationObserver = window.MutationObserver;
  if (NativeMutationObserver) {
    window.MutationObserver = class RuralMutationObserverThrottle extends NativeMutationObserver {
      constructor(callback) {
        let frameId = 0;
        let pendingRecords = [];
        const throttledCallback = (records, observer) => {
          const source = typeof callback === 'function' ? Function.prototype.toString.call(callback) : '';
          if (!source.includes('decorateAvatars')) {
            callback(records, observer);
            return;
          }
          pendingRecords.push(...records);
          if (frameId) return;
          frameId = requestAnimationFrame(() => {
            frameId = 0;
            const batch = pendingRecords;
            pendingRecords = [];
            callback(batch, observer);
          });
        };
        super(throttledCallback);
      }
    };
  }
})();
