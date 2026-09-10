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

  function renderHelpStatus(actions, marker) {
    const helpUsers = Array.isArray(marker.__helpUsers) ? marker.__helpUsers : [];
    const confirmedUsers = Array.isArray(marker.__helpConfirmedUsers) ? marker.__helpConfirmedUsers : [];
    const isOwner = marker.__deleteOwnerName === currentUsername;
    const helping = !isOwner && helpUsers.includes(currentUsername);
    const names = helpUsers.slice(0, 8).map(name => String(name)).join('、');
    const extra = helpUsers.length > 8 ? ` ほか${helpUsers.length - 8}人` : '';

    actions.innerHTML = '';

    const block = document.createElement('div');
    block.className = 'map-help-block';

    const count = document.createElement('div');
    count.className = 'map-help-count';
    count.textContent = `🙋 手伝える人：${helpUsers.length}人`;
    block.appendChild(count);

    if (helpUsers.length) {
      const people = document.createElement('div');
      people.className = 'map-help-people';
      people.textContent = `参加者：${names}${extra}`;
      block.appendChild(people);
    } else {
      const empty = document.createElement('div');
      empty.className = 'map-help-people';
      empty.textContent = 'まだ手伝える人はいません。';
      block.appendChild(empty);
    }

    if (isOwner && helpUsers.length) {
      const confirmTitle = document.createElement('div');
      confirmTitle.className = 'map-help-people';
      confirmTitle.textContent = '実際に手伝いに来た人を確認してください。';
      block.appendChild(confirmTitle);

      helpUsers.forEach(helperUsername => {
        const row = document.createElement('div');
        row.className = 'map-help-confirm-row';

        const name = document.createElement('span');
        name.className = 'map-help-confirm-name';
        name.textContent = String(helperUsername);
        row.appendChild(name);

        const confirmed = confirmedUsers.includes(helperUsername);
        const confirmButton = document.createElement('button');
        confirmButton.type = 'button';
        confirmButton.className = 'map-help-confirm-btn';
        confirmButton.textContent = confirmed ? '✅ 来た（確認済み）' : '📍 来た！';
        confirmButton.disabled = confirmed;

        if (!confirmed) {
          confirmButton.addEventListener('click', () => {
            confirmButton.disabled = true;
            confirmButton.textContent = '確認中…';

            socket.emit('confirm-help', {
              id: marker.__deleteMessageId,
              helperUsername
            }, result => {
              if (!result?.ok) {
                confirmButton.disabled = false;
                confirmButton.textContent = '📍 来た！';
                if (typeof setStatus === 'function') {
                  const messages = {
                    'not-owner': '投稿者本人だけが「来た！」を押せます。',
                    'not-helper': 'この人は「手伝える」に参加していません。',
                    'not-found': '投稿が見つかりません。',
                    'unauthorized': 'ログインしてから確認してください。',
                    'server-error': '確認中にエラーが発生しました。'
                  };
                  setStatus(messages[result.reason] || '確認に失敗しました。');
                }
                return;
              }

              marker.__helpConfirmedUsers = Array.isArray(result.helpConfirmedUsers)
                ? result.helpConfirmedUsers
                : [...confirmedUsers, helperUsername];
              renderHelpStatus(actions, marker);
              if (typeof setStatus === 'function') {
                setStatus(`「${helperUsername}」さんが実際に手伝ったことを確認しました。${Number(result.points || 0)}pt付与しました。`);
              }
            });
          });
        }

        row.appendChild(confirmButton);
        block.appendChild(row);
      });
    }

    if (isOwner) {
      if (!helpUsers.length) {
        const ownerNotice = document.createElement('div');
        ownerNotice.className = 'map-help-people';
        ownerNotice.textContent = '🙅 自分の投稿には「手伝える」はできません。';
        block.appendChild(ownerNotice);
      }
      actions.appendChild(block);
      return;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = helping ? 'map-help-btn helping' : 'map-help-btn';
    button.textContent = helping ? '✅ 手伝えるを取り消す' : '🙋 手伝える';
    button.addEventListener('click', () => {
      if (!currentUsername) return;
      button.disabled = true;
      button.textContent = '更新中…';

      socket.emit('toggle-help', { id: marker.__deleteMessageId }, result => {
        button.disabled = false;
        if (!result?.ok) {
          button.textContent = helping ? '✅ 手伝えるを取り消す' : '🙋 手伝える';
          if (typeof setStatus === 'function') {
            const messages = {
              'not-found': '投稿が見つかりません。',
              'unauthorized': 'ログインしてから参加してください。',
              'own-post': '自分の投稿には「手伝える」はできません。',
              'server-error': '手伝える人の登録に失敗しました。'
            };
            setStatus(messages[result.reason] || '更新に失敗しました。');
          }
          return;
        }

        marker.__helpUsers = Array.isArray(result.helpUsers) ? result.helpUsers : [];
        marker.__helpConfirmedUsers = Array.isArray(result.helpConfirmedUsers) ? result.helpConfirmedUsers : [];
        renderHelpStatus(actions, marker);
        if (typeof setStatus === 'function') {
          setStatus(result.helping
            ? '「手伝える」に参加しました。実際に手伝ったあと、投稿者が「来た！」を押すと10ptもらえます。'
            : '「手伝える」を取り消しました。');
        }
      });
    });
    block.appendChild(button);

    if (helping && !confirmedUsers.includes(currentUsername)) {
      const note = document.createElement('div');
      note.className = 'map-help-people';
      note.textContent = '⭐ 投稿者が「来た！」を押すと地域ポイント10ptが付与されます。';
      block.appendChild(note);
    }

    if (confirmedUsers.includes(currentUsername)) {
      const done = document.createElement('div');
      done.className = 'map-help-people';
      done.textContent = '🎉 投稿者に「来た！」と確認され、地域ポイントが付与されました。';
      block.appendChild(done);
    }

    actions.appendChild(block);
  }

  function addDeleteControl(marker) {
    if (!marker || marker.__deleteControlReady || !marker.getPopup?.()) return;
    marker.__deleteControlReady = true;

    const popup = marker.getPopup();
    const originalContent = String(popup.getContent() || '');
    marker.__originalPopupContent = originalContent;

    popup.setContent(`${originalContent}<div class="map-pin-actions"></div>`);

    marker.on('popupopen', () => {
      const popupElement = marker.getPopup()?.getElement?.();
      if (!popupElement) return;

      const actions = popupElement.querySelector('.map-pin-actions');
      if (!actions) return;
      actions.innerHTML = '';

      renderHelpStatus(actions, marker);

      // 再ログイン後も、同じニックネームなら自分の投稿として扱います。
      if (marker.__deleteOwnerName !== currentUsername) return;
      if (!marker.__deleteMessageId) return;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'map-delete-btn';
      button.textContent = '🗑 このピンを削除';
      button.addEventListener('click', () => {
        if (!window.confirm('この投稿の地図ピンを削除しますか？')) return;

        button.disabled = true;
        button.textContent = '削除中…';

        socket.emit('delete-map-pin', { id: marker.__deleteMessageId }, result => {
          if (!result?.ok) {
            button.disabled = false;
            button.textContent = '🗑 このピンを削除';
            if (typeof setStatus === 'function') {
              const messages = {
                'not-owner': 'この投稿は削除できません。',
                'not-found': '投稿が見つかりません。',
                'server-error': '削除中にエラーが発生しました。'
              };
              setStatus(messages[result.reason] || 'ピンの削除に失敗しました。');
            }
            return;
          }

          marker.__deletedByOwner = true;
          if (typeof map !== 'undefined' && map.hasLayer(marker)) map.removeLayer(marker);
          if (typeof setStatus === 'function') setStatus('投稿したピンを削除しました。');
        });
      });
      actions.appendChild(button);
    });
  }

  const originalMarker = L.marker.bind(L);
  L.marker = function(latlng, options = {}) {
    const marker = originalMarker(latlng, options);
    marker.__deleteMarkerId = `map-pin-${++markerCounter}`;
    marker.__deleteOwnerName = null;
    marker.__deleteMessageId = null;
    marker.__helpUsers = [];
    marker.__helpConfirmedUsers = [];
    return marker;
  };

  socket.on('receive-message', data => {
    if (!data?.locationData) return;
    setTimeout(() => {
      const marker = findMarkerForMessage(data);
      if (!marker) return;

      marker.__deleteOwnerName = typeof data.username === 'string' ? data.username : null;
      marker.__deleteMessageId = typeof data.id === 'string' ? data.id : null;
      marker.__helpUsers = Array.isArray(data.helpUsers) ? data.helpUsers : [];
      marker.__helpConfirmedUsers = Array.isArray(data.helpConfirmedUsers) ? data.helpConfirmedUsers : [];
      ownerMarkers.add(marker);
      addDeleteControl(marker);
    }, 0);
  });

  socket.on('map-pin-help-updated', data => {
    const id = typeof data?.id === 'string' ? data.id : '';
    if (!id || typeof map === 'undefined') return;

    map.eachLayer(layer => {
      if (layer?.__deleteMessageId !== id) return;
      layer.__helpUsers = Array.isArray(data.helpUsers) ? data.helpUsers : [];
      layer.__helpConfirmedUsers = Array.isArray(data.helpConfirmedUsers) ? data.helpConfirmedUsers : layer.__helpConfirmedUsers;

      const popup = layer.getPopup?.();
      const popupElement = popup?.getElement?.();
      const actions = popupElement?.querySelector?.('.map-pin-actions');
      if (actions) renderHelpStatus(actions, layer);
    });
  });

  socket.on('map-pin-help-confirmed', data => {
    const id = typeof data?.id === 'string' ? data.id : '';
    if (!id || typeof map === 'undefined') return;

    map.eachLayer(layer => {
      if (layer?.__deleteMessageId !== id) return;
      layer.__helpConfirmedUsers = Array.isArray(data.helpConfirmedUsers)
        ? data.helpConfirmedUsers
        : [...(layer.__helpConfirmedUsers || []), data.helperUsername];

      const popup = layer.getPopup?.();
      const popupElement = popup?.getElement?.();
      const actions = popupElement?.querySelector?.('.map-pin-actions');
      if (actions) renderHelpStatus(actions, layer);
    });
  });

  socket.on('map-pin-deleted', data => {
    const id = typeof data?.id === 'string' ? data.id : '';
    if (!id || typeof map === 'undefined') return;

    map.eachLayer(layer => {
      if (layer?.__deleteMessageId === id) {
        layer.__deletedByOwner = true;
        if (map.hasLayer(layer)) map.removeLayer(layer);
      }
    });
  });

  document.addEventListener('click', event => {
    if (!event.target.closest('.map-filter') || typeof map === 'undefined') return;
    setTimeout(() => {
      ownerMarkers.forEach(marker => {
        if (marker.__deletedByOwner && map.hasLayer(marker)) map.removeLayer(marker);
      });
    }, 0);
  });
})();
