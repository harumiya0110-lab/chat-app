(() => {
  const ownerMarkers = new Set();
  let markerCounter = 0;

  function sameLocation(a, b) {
    if (!a || !b) return false;
    return Math.abs(Number(a.lat) - Number(b.lat)) < 0.000001 &&
      Math.abs(Number(a.lng) - Number(b.lng)) < 0.000001;
  }

  function findMarkerForMessage(data) {
    const loc = data?.locationData;
    if (!loc || typeof map === 'undefined') return null;

    const candidates = [];
    map.eachLayer(layer => {
      if (!(layer instanceof L.Marker)) return;
      const point = layer.getLatLng?.();
      if (!point || !sameLocation({ lat: point.lat, lng: point.lng }, loc)) return;
      const content = String(layer.getPopup?.()?.getContent?.() || '');
      const text = String(data.message || data.text || '');
      if (text && content.includes(text)) candidates.push(layer);
      else candidates.push(layer);
    });

    return candidates[candidates.length - 1] || null;
  }

  function addDeleteControl(marker) {
    if (!marker || marker.__deleteControlReady || !marker.getPopup?.()) return;
    marker.__deleteControlReady = true;

    const popup = marker.getPopup();
    const originalContent = String(popup.getContent() || '');
    marker.__originalPopupContent = originalContent;

    popup.setContent(`${originalContent}<div class="map-pin-actions" data-delete-owner="${marker.__deleteOwnerId || ''}"></div>`);

    marker.on('popupopen', () => {
      const popupElement = marker.getPopup()?.getElement?.();
      if (!popupElement) return;

      const actions = popupElement.querySelector('.map-pin-actions');
      if (!actions) return;
      actions.innerHTML = '';

      // 削除ボタンは投稿者本人のブラウザにだけ表示します。
      if (marker.__deleteOwnerId !== socket.id) return;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'map-delete-btn';
      button.textContent = '🗑 このピンを削除';
      button.addEventListener('click', () => {
        if (!window.confirm('この投稿の地図ピンを削除しますか？')) return;
        marker.__deletedByOwner = true;
        map.removeLayer(marker);
        if (typeof setStatus === 'function') setStatus('投稿したピンを削除しました。');
      });
      actions.appendChild(button);
    });
  }

  // 今後作成されるマーカーに識別番号を付けます。
  const originalMarker = L.marker.bind(L);
  L.marker = function(latlng, options = {}) {
    const marker = originalMarker(latlng, options);
    marker.__deleteMarkerId = `map-pin-${++markerCounter}`;
    marker.__deleteOwnerId = null;
    return marker;
  };

  socket.on('receive-message', data => {
    if (!data?.locationData) return;
    setTimeout(() => {
      const marker = findMarkerForMessage(data);
      if (!marker) return;

      marker.__deleteOwnerId = data.userId || null;
      ownerMarkers.add(marker);
      addDeleteControl(marker);
    }, 0);
  });

  // 表示切替のたびに、削除済みピンが復活しないようにします。
  document.addEventListener('click', event => {
    if (!event.target.closest('.map-filter') || typeof map === 'undefined') return;
    setTimeout(() => {
      ownerMarkers.forEach(marker => {
        if (marker.__deletedByOwner && map.hasLayer(marker)) {
          map.removeLayer(marker);
        }
      });
    }, 0);
  });
})();
