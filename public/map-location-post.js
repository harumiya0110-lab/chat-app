(() => {
  if (window.__ruralMapLocationPostInitialized) return;
  window.__ruralMapLocationPostInitialized = true;

  const mapInstance = window.ruralMap || (typeof map !== 'undefined' ? map : null);
  if (!mapInstance || typeof L === 'undefined' || typeof socket === 'undefined') return;

  const mapPanel = document.querySelector('.map-panel');
  const mapElement = document.getElementById('map');
  if (!mapPanel || !mapElement) return;

  const EVENT_TYPES = ['交通障害', '助け合い', 'イベント', '鳥獣目撃', 'その他'];
  const EVENT_LABELS = {
    '交通障害': '🔴 交通障害',
    '助け合い': '🟢 助け合い',
    'イベント': '🟠 イベント',
    '鳥獣目撃': '🟣 鳥獣目撃',
    'その他': '⚪ その他'
  };

  const toolbar = document.createElement('div');
  toolbar.className = 'map-location-post-toolbar';
  toolbar.innerHTML = `
    <div class="map-location-post-heading">
      <div>
        <strong>📍 地図から出来事を投稿</strong>
        <span id="map-location-post-help">「場所を選ぶ」を押してから、地図上の地点をクリックしてください。</span>
      </div>
      <button type="button" id="map-location-post-mode" class="map-location-post-mode">📍 場所を選ぶ</button>
    </div>
    <div id="map-location-post-form" class="map-location-post-form" hidden>
      <div class="map-location-post-selected">
        <span>選択した場所</span>
        <strong id="map-location-post-coords">未選択</strong>
      </div>
      <label class="map-location-post-field">
        <span>起きたことの種類</span>
        <select id="map-location-post-type">
          ${EVENT_TYPES.map(type => `<option value="${type}">${EVENT_LABELS[type]}</option>`).join('')}
        </select>
      </label>
      <label class="map-location-post-field">
        <span>何が起きたか</span>
        <textarea id="map-location-post-message" maxlength="2000" rows="3" placeholder="例：この道で倒木があり、通行しにくくなっています。"></textarea>
      </label>
      <div class="map-location-post-actions">
        <button type="button" id="map-location-post-cancel" class="map-location-post-secondary">キャンセル</button>
        <button type="button" id="map-location-post-submit" class="map-location-post-submit">📤 この場所に投稿</button>
      </div>
    </div>
  `;

  mapPanel.insertBefore(toolbar, mapElement);

  const modeBtn = toolbar.querySelector('#map-location-post-mode');
  const helpText = toolbar.querySelector('#map-location-post-help');
  const form = toolbar.querySelector('#map-location-post-form');
  const coordsEl = toolbar.querySelector('#map-location-post-coords');
  const typeInput = toolbar.querySelector('#map-location-post-type');
  const messageInput = toolbar.querySelector('#map-location-post-message');
  const cancelBtn = toolbar.querySelector('#map-location-post-cancel');
  const submitBtn = toolbar.querySelector('#map-location-post-submit');

  const style = document.createElement('style');
  style.id = 'map-location-post-style';
  style.textContent = `
    .map-location-post-toolbar{margin:10px 0 12px;padding:12px 14px;border:1px solid var(--theme-border-soft,#d8e3d5);border-radius:12px;background:var(--theme-main-pale,#f7faf5);color:var(--theme-text,#294237)}
    .map-location-post-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}
    .map-location-post-heading>div{min-width:0;display:flex;flex-direction:column;gap:4px}
    .map-location-post-heading strong{font-size:14px;color:var(--theme-main,#234d3c)}
    .map-location-post-heading span{font-size:11px;color:var(--theme-text-soft,#6d7a73);line-height:1.5}
    .map-location-post-mode,.map-location-post-submit,.map-location-post-secondary{border:1px solid var(--theme-border,#b8cbb5);border-radius:9px;padding:9px 13px;font:inherit;cursor:pointer}
    .map-location-post-mode{background:var(--theme-main,#234d3c);color:#fff;border-color:var(--theme-main,#234d3c);white-space:nowrap}
    .map-location-post-mode.active{background:var(--theme-main-strong,#d96b3b);border-color:var(--theme-main-strong,#d96b3b)}
    .map-location-post-form{margin-top:11px;padding-top:11px;border-top:1px solid var(--theme-border-soft,#dde7da);display:grid;gap:9px}
    .map-location-post-selected{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 10px;border-radius:8px;background:var(--theme-main-soft,#eef4ec);font-size:12px}
    .map-location-post-selected span{color:var(--theme-text-soft,#68776e)}
    .map-location-post-selected strong{color:var(--theme-text,#31513f);font-variant-numeric:tabular-nums}
    .map-location-post-field{display:grid;gap:5px;font-size:12px;color:var(--theme-text,#31513f);font-weight:700}
    .map-location-post-field select,.map-location-post-field textarea{width:100%;box-sizing:border-box;border:1px solid var(--theme-input,#bfccbb);border-radius:8px;background:var(--theme-panel,#fff);color:var(--theme-text,#21342c);padding:9px 10px;font:inherit;outline:none}
    .map-location-post-field textarea{resize:vertical;min-height:72px;line-height:1.5}
    .map-location-post-field select:focus,.map-location-post-field textarea:focus{border-color:var(--theme-main,#558266);box-shadow:0 0 0 3px color-mix(in srgb,var(--theme-main,#558266) 15%,transparent)}
    .map-location-post-actions{display:flex;justify-content:flex-end;gap:8px}
    .map-location-post-secondary{background:var(--theme-panel,#fff);color:var(--theme-text,#31513f)}
    .map-location-post-submit{background:var(--theme-main,#2d8a57);color:#fff;border-color:var(--theme-main,#2d8a57)}
    .map-location-post-submit:disabled,.map-location-post-mode:disabled,.map-location-post-secondary:disabled{opacity:.55;cursor:wait}
    @media(max-width:650px){
      .map-location-post-heading{align-items:stretch;flex-direction:column}
      .map-location-post-mode{width:100%}
      .map-location-post-selected{align-items:flex-start;flex-direction:column}
      .map-location-post-actions{display:grid;grid-template-columns:1fr 1fr}
    }
  `;
  document.head.appendChild(style);

  let selecting = false;
  let selectedLatLng = null;
  let selectedMarker = null;
  let sending = false;

  function setCursor(enabled) {
    const container = mapInstance.getContainer?.();
    if (container) container.style.cursor = enabled ? 'crosshair' : '';
  }

  function removeSelection() {
    if (selectedMarker && mapInstance.hasLayer(selectedMarker)) mapInstance.removeLayer(selectedMarker);
    selectedMarker = null;
    selectedLatLng = null;
    coordsEl.textContent = '未選択';
  }

  function setSelecting(enabled) {
    selecting = enabled;
    modeBtn.classList.toggle('active', enabled);
    modeBtn.textContent = enabled ? '✖️ 場所選択を終了' : '📍 場所を選ぶ';
    helpText.textContent = enabled
      ? '地図上の場所をクリックしてください。選んだ後に内容を入力できます。'
      : '「場所を選ぶ」を押してから、地図上の地点をクリックしてください。';
    setCursor(enabled);
    if (!enabled && !selectedLatLng) form.hidden = true;
  }

  mapInstance.on('click', event => {
    if (!selecting || sending) return;

    selectedLatLng = event.latlng;
    if (selectedMarker && mapInstance.hasLayer(selectedMarker)) mapInstance.removeLayer(selectedMarker);

    selectedMarker = L.circleMarker(selectedLatLng, {
      radius: 10,
      color: getComputedStyle(document.body).getPropertyValue('--theme-main').trim() || '#2f80ed',
      weight: 3,
      fillColor: getComputedStyle(document.body).getPropertyValue('--theme-panel').trim() || '#ffffff',
      fillOpacity: 0.92
    }).addTo(mapInstance);

    coordsEl.textContent = `${selectedLatLng.lat.toFixed(5)}, ${selectedLatLng.lng.toFixed(5)}`;
    form.hidden = false;
    helpText.textContent = '場所を選択しました。種類と内容を入力して投稿してください。';
    modeBtn.textContent = '📍 場所を変更';
    modeBtn.classList.add('active');
    setCursor(false);
    selecting = false;
    messageInput.focus();
    mapInstance.panTo(selectedLatLng, { animate: true });
  });

  modeBtn.addEventListener('click', () => {
    if (sending) return;

    if (selectedLatLng) {
      removeSelection();
      form.hidden = true;
    }

    setSelecting(!selecting);
    if (selecting) {
      mapInstance.closePopup?.();
      setStatus?.('地図上の投稿場所を選択してください。');
    } else {
      setStatus?.('地図からの場所選択を終了しました。');
    }
  });

  cancelBtn.addEventListener('click', () => {
    if (sending) return;
    removeSelection();
    form.hidden = true;
    setSelecting(false);
    setStatus?.('地図からの投稿をキャンセルしました。');
  });

  submitBtn.addEventListener('click', () => {
    if (sending || !selectedLatLng) {
      if (!selectedLatLng) setStatus?.('先に地図上の場所を選択してください。');
      return;
    }

    const message = messageInput.value.trim();
    const eventType = typeInput.value;
    if (!message) {
      messageInput.focus();
      setStatus?.('その場所で起きたことを入力してください。');
      return;
    }
    if (!EVENT_TYPES.includes(eventType)) {
      setStatus?.('出来事の種類を選択してください。');
      return;
    }
    if (typeof currentUsername === 'undefined' || !String(currentUsername || '').trim()) {
      setStatus?.('チャットに参加してから投稿してください。');
      return;
    }
    if (!socket.connected) {
      setStatus?.('サーバーに接続されていません。少し待ってから再試行してください。');
      return;
    }

    sending = true;
    submitBtn.disabled = true;
    cancelBtn.disabled = true;
    modeBtn.disabled = true;
    submitBtn.textContent = '⏳ 投稿中…';
    setStatus?.('選択した場所に投稿しています…');

    const payload = {
      lat: Number(selectedLatLng.lat),
      lng: Number(selectedLatLng.lng),
      eventType,
      message
    };

    socket.emit('send-location-message', payload, result => {
      sending = false;
      submitBtn.disabled = false;
      cancelBtn.disabled = false;
      modeBtn.disabled = false;
      submitBtn.textContent = '📤 この場所に投稿';

      if (!result?.ok) {
        setStatus?.(result?.message || '地図からの投稿に失敗しました。');
        return;
      }

      removeSelection();
      form.hidden = true;
      setSelecting(false);
      messageInput.value = '';
      setStatus?.(`✅ 選択した場所に「${eventType}」の投稿を追加しました。`);
    });
  });
})();
