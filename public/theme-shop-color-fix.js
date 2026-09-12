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
})();
