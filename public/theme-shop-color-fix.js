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

    /* チャット背景ごとに文字色・吹き出し色を最適化 */
    body[data-rural-chat-background="default"] .messages,
    body[data-rural-chat-background="default"] .messages .message,
    body[data-rural-chat-background="default"] .messages .message-bubble { color:#21342c!important; }
    body[data-rural-chat-background="default"] .messages .message-header { color:#53655b!important; }

    body[data-rural-chat-background="paper"] .messages,
    body[data-rural-chat-background="paper"] .messages .message,
    body[data-rural-chat-background="paper"] .messages .message-bubble { color:#433b2e!important; }
    body[data-rural-chat-background="paper"] .messages .message-header { color:#6f624d!important; }

    body[data-rural-chat-background="sky"] .messages,
    body[data-rural-chat-background="sky"] .messages .message,
    body[data-rural-chat-background="sky"] .messages .message-bubble { color:#163a49!important; }
    body[data-rural-chat-background="sky"] .messages .message-header { color:#416472!important; }

    body[data-rural-chat-background="sakura"] .messages,
    body[data-rural-chat-background="sakura"] .messages .message,
    body[data-rural-chat-background="sakura"] .messages .message-bubble { color:#542f40!important; }
    body[data-rural-chat-background="sakura"] .messages .message-header { color:#815766!important; }

    body[data-rural-chat-background="night"] .messages,
    body[data-rural-chat-background="night"] .messages .message,
    body[data-rural-chat-background="night"] .messages .message-bubble { color:#f1f6fa!important; }
    body[data-rural-chat-background="night"] .messages .message-header { color:#c7d6df!important; }
    body[data-rural-chat-background="night"] .messages .message-bubble {
      background:rgba(48,64,80,.94)!important;
      border-color:rgba(177,201,216,.18)!important;
    }

    body[data-rural-chat-background="sunset"] .messages,
    body[data-rural-chat-background="sunset"] .messages .message,
    body[data-rural-chat-background="sunset"] .messages .message-bubble { color:#472f27!important; }
    body[data-rural-chat-background="sunset"] .messages .message-header { color:#76564b!important; }

    /* 入力欄・状態表示も背景に合わせて読みやすくする */
    body[data-rural-chat-background="default"] .status,
    body[data-rural-chat-background="default"] .input-area { color:#31513f!important; }
    body[data-rural-chat-background="paper"] .status,
    body[data-rural-chat-background="paper"] .input-area { color:#544637!important; }
    body[data-rural-chat-background="sky"] .status,
    body[data-rural-chat-background="sky"] .input-area { color:#245267!important; }
    body[data-rural-chat-background="sakura"] .status,
    body[data-rural-chat-background="sakura"] .input-area { color:#684254!important; }
    body[data-rural-chat-background="night"] .status,
    body[data-rural-chat-background="night"] .input-area { color:#dbe7ee!important; }
    body[data-rural-chat-background="sunset"] .status,
    body[data-rural-chat-background="sunset"] .input-area { color:#5c4035!important; }
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
