(() => {
  const messages = document.getElementById('messages');
  if (!messages) return;

  const normalizeText = value => String(value || '')
    .replace(/\s+/gu, ' ')
    .trim();

  function getMessageText(article) {
    const bubble = article?.querySelector('.message-bubble');
    if (!bubble) return '';

    const clone = bubble.cloneNode(true);
    clone.querySelectorAll('span').forEach(el => el.remove());
    return normalizeText(clone.textContent);
  }

  function findMarkerForMessageText(messageText) {
    const map = window.ruralMap;
    if (!map || !messageText) return null;

    const candidates = [];
    map.eachLayer(layer => {
      if (!(layer instanceof L.Marker)) return;
      const popupText = normalizeText(layer.getPopup?.()?.getContent?.()
        ?.replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' '));
      if (popupText && popupText.includes(messageText)) candidates.push(layer);
    });

    return candidates[candidates.length - 1] || null;
  }

  function attachMapLink(article) {
    if (!article || article.dataset.mapLinkReady === 'true') return;

    const messageText = getMessageText(article);
    if (!messageText) return;

    const marker = findMarkerForMessageText(messageText);
    if (!marker) return;

    article.dataset.mapLinkReady = 'true';
    article.classList.add('has-map-link');

    const bubble = article.querySelector('.message-bubble');
    if (!bubble) return;

    bubble.title = 'クリックすると地図上の場所を表示します';
    bubble.setAttribute('role', 'button');
    bubble.tabIndex = 0;

    const openMap = () => {
      const map = window.ruralMap;
      if (!map || !marker.getLatLng) return;

      const latLng = marker.getLatLng();
      if (typeof window.setMapEventFilter === 'function') {
        window.setMapEventFilter('all');
      }

      map.setView(latLng, Math.max(map.getZoom(), 16), { animate: true });
      marker.openPopup();
    };

    bubble.addEventListener('click', openMap);
    bubble.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openMap();
      }
    });
  }

  function scanMessages() {
    messages.querySelectorAll('.message').forEach(attachMapLink);
  }

  const style = document.createElement('style');
  style.textContent = `
    .message.has-map-link .message-bubble {
      cursor: pointer;
      transition: box-shadow .15s ease, transform .15s ease;
    }
    .message.has-map-link .message-bubble:hover {
      box-shadow: 0 3px 12px rgba(0, 0, 0, .12);
      transform: translateY(-1px);
    }
    .message.has-map-link .message-bubble:focus-visible {
      outline: 2px solid #2f80ed;
      outline-offset: 2px;
    }
    .message.has-map-link .message-bubble::after {
      content: '  🗺️ 地図で見る';
      display: inline-block;
      margin-left: 6px;
      font-size: 11px;
      font-weight: 700;
      opacity: .65;
    }
  `;
  document.head.appendChild(style);

  const observer = new MutationObserver(() => {
    scanMessages();
  });
  observer.observe(messages, { childList: true, subtree: true });

  // マーカー生成とチャット表示が同じイベント内で行われるため、初回走査を少し遅らせます。
  setTimeout(scanMessages, 0);
})();
