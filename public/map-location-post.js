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
      <label id="map-location-post-event-time-field" class="map-location-post-field" hidden>
        <span>開催日時（イベントのみ）</span>
        <input id="map-location-post-event-start" type="datetime-local" aria-describedby="map-location-post-event-time-help">
        <small id="map-location-post-event-time-help" class="map-location-post-event-time-help">祭り・催しなどの開始日時を入力してください。</small>
      </label>
      <label class="map-location-post-field">
        <span>何が起きたか</span>
        <textarea id="map-location-post-message" maxlength="2000" rows="3" placeholder="例：この道で倒木があり、通行しにくくなっています。"></textarea>
      </label>
      <div class="map-location-post-field">
        <span>写真（任意）</span>
        <div class="map-location-post-photo-row">
          <button type="button" id="map-location-post-photo-btn" class="map-location-post-photo-btn">📷 写真を追加</button>
          <input id="map-location-post-photo-input" type="file" accept="image/jpeg,image/png,image/webp" hidden>
          <span id="map-location-post-photo-name" class="map-location-post-photo-name">写真なし</span>
        </div>
        <div id="map-location-post-photo-preview" class="map-location-post-photo-preview" hidden></div>
        <small class="map-location-post-event-time-help">写真は投稿と一緒に保存され、マップピンを開いたときにも表示されます。</small>
      </div>
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
  const eventTimeField = toolbar.querySelector('#map-location-post-event-time-field');
  const eventStartInput = toolbar.querySelector('#map-location-post-event-start');
  const messageInput = toolbar.querySelector('#map-location-post-message');
  const photoBtn = toolbar.querySelector('#map-location-post-photo-btn');
  const photoInput = toolbar.querySelector('#map-location-post-photo-input');
  const photoName = toolbar.querySelector('#map-location-post-photo-name');
  const photoPreview = toolbar.querySelector('#map-location-post-photo-preview');
  const cancelBtn = toolbar.querySelector('#map-location-post-cancel');
  const submitBtn = toolbar.querySelector('#map-location-post-submit');

  const style = document.createElement('style');
  style.id = 'map-location-post-style';
  style.textContent = `
    .map-location-post-toolbar{margin:10px 0 12px;padding:12px 14px;border:1px solid var(--theme-border-soft,#d8e3d5);border-radius:12px;background:var(--theme-main-pale,#f7faf5);color:var(--theme-text,#294237)}
    .map-location-post-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}
    .map-location-post-heading>div{min-width:0;display:flex;flex-direction:column;gap:4px}
    .map-location-post-heading strong{font-size:14px;color:var(--theme-text,#294237)!important}
    .map-location-post-heading span{font-size:11px;color:var(--theme-text-soft,#6d7a73);line-height:1.5}
    .map-location-post-mode,.map-location-post-submit,.map-location-post-secondary{border:1px solid var(--theme-border,#b8cbb5);border-radius:9px;padding:9px 13px;font:inherit;cursor:pointer}
    .map-location-post-mode{background:var(--theme-main,#234d3c);color:#fff;border-color:var(--theme-main,#234d3c);white-space:nowrap}
    .map-location-post-mode.active{background:var(--theme-main-strong,#d96b3b);border-color:var(--theme-main-strong,#d96b3b)}
    .map-location-post-form{margin-top:11px;padding-top:11px;border-top:1px solid var(--theme-border-soft,#dde7da);display:grid;gap:9px;max-height:min(460px,calc(100vh - 250px));overflow-y:auto;overflow-x:hidden;padding-right:2px}
    .map-location-post-selected{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 10px;border-radius:8px;background:var(--theme-main-soft,#eef4ec);font-size:12px}
    .map-location-post-selected span{color:var(--theme-text-soft,#68776e)}
    .map-location-post-selected strong{color:var(--theme-text,#31513f);font-variant-numeric:tabular-nums}
    .map-location-post-field{display:grid;gap:5px;font-size:12px;color:var(--theme-text,#31513f);font-weight:700}
    .map-location-post-field select,.map-location-post-field textarea,.map-location-post-field input[type="datetime-local"]{width:100%;box-sizing:border-box;border:1px solid var(--theme-input,#bfccbb);border-radius:8px;background:var(--theme-panel,#fff);color:var(--theme-text,#21342c);padding:9px 10px;font:inherit;outline:none}
    .map-location-post-field textarea{resize:vertical;min-height:72px;line-height:1.5}
    .map-location-post-event-time-help{font-size:11px;font-weight:400;color:var(--theme-text-soft,#6d7a73);line-height:1.5}
    .map-location-post-photo-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .map-location-post-photo-btn{background:var(--theme-panel,#fff);color:var(--theme-text,#31513f);border:1px solid var(--theme-border,#b8cbb5);border-radius:9px;padding:9px 13px;font:inherit;font-weight:700;cursor:pointer}
    .map-location-post-photo-btn:hover{background:var(--theme-main-soft,#eef4ec)}
    .map-location-post-photo-name{font-size:11px;font-weight:400;color:var(--theme-text-soft,#6d7a73);word-break:break-all}
    .map-location-post-photo-preview{margin-top:6px;position:relative;width:min(240px,100%);height:140px;overflow:hidden}
    .map-location-post-photo-preview img{display:block;width:100%;height:140px;object-fit:cover;border-radius:9px;border:1px solid var(--theme-border-soft,#dde7da)}
    .map-location-post-photo-clear{position:absolute;top:6px;right:6px;width:32px;height:32px;border:0;border-radius:999px;background:rgba(33,52,44,.82);color:#fff;font-size:18px;line-height:1;cursor:pointer}
    .map-location-post-field select:focus,.map-location-post-field textarea:focus,.map-location-post-field input[type="datetime-local"]:focus{border-color:var(--theme-main,#558266);box-shadow:0 0 0 3px color-mix(in srgb,var(--theme-main,#558266) 15%,transparent)}
    .map-location-post-actions{position:sticky;bottom:0;z-index:3;display:flex;justify-content:flex-end;gap:8px;padding:8px 0 2px;background:var(--theme-main-pale,#f7faf5);box-shadow:0 -4px 10px rgba(35,77,60,.08)}
    .map-location-post-secondary{background:var(--theme-panel,#fff);color:var(--theme-text,#31513f)}
    .map-location-post-submit{background:var(--theme-main,#2d8a57);color:#fff;border-color:var(--theme-main,#2d8a57)}
    .map-location-post-submit:disabled,.map-location-post-mode:disabled,.map-location-post-secondary:disabled{opacity:.55;cursor:wait}
    @media(max-width:650px){
      .map-location-post-heading{align-items:stretch;flex-direction:column}
      .map-location-post-mode{width:100%}
      .map-location-post-selected{align-items:flex-start;flex-direction:column}
      .map-location-post-form{max-height:calc(100dvh - 220px)}
      .map-location-post-photo-preview,.map-location-post-photo-preview img{height:120px}
      .map-location-post-actions{display:grid;grid-template-columns:1fr 1fr}
    }
  `;
  document.head.appendChild(style);

  let selecting = false;
  let selectedLatLng = null;
  let selectedMarker = null;
  let sending = false;
  let selectedPhoto = null;

  function syncEventScheduleField() {
    const isEvent = typeInput.value === 'イベント';
    eventTimeField.hidden = !isEvent;
    eventStartInput.required = isEvent;
    if (!isEvent) eventStartInput.value = '';
  }

  function setCursor(enabled) {
    const container = mapInstance.getContainer?.();
    if (container) container.style.cursor = enabled ? 'crosshair' : '';
  }

  function clearPhoto() {
    selectedPhoto = null;
    photoInput.value = '';
    photoName.textContent = '写真なし';
    photoPreview.replaceChildren();
    photoPreview.hidden = true;
  }

  function readImageDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('写真を読み込めませんでした。'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
    });
  }

  function prepareMapPhoto(file) {
    return readImageDataUrl(file).then(dataUrl => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const maxWidth = 1280;
        const scale = Math.min(1, maxWidth / Math.max(1, image.width));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('写真を処理できませんでした。'));
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        let quality = 0.82;
        let output = canvas.toDataURL('image/jpeg', quality);
        for (let i = 0; i < 5 && output.length > 2.7 * 1024 * 1024; i += 1) {
          quality *= 0.78;
          output = canvas.toDataURL('image/jpeg', quality);
        }
        if (output.length > 2.9 * 1024 * 1024) {
          return reject(new Error('写真を2MB程度まで圧縮できませんでした。別の写真を選んでください。'));
        }
        resolve({
          type: 'image',
          filename: file.name || 'map-photo.jpg',
          size: file.size,
          dataUrl: output,
          thumbnailDataUrl: output
        });
      };
      image.onerror = () => reject(new Error('写真を読み込めませんでした。'));
      image.src = dataUrl;
    }));
  }

  function renderPhotoPreview() {
    photoPreview.replaceChildren();
    if (!selectedPhoto?.dataUrl) {
      photoPreview.hidden = true;
      photoName.textContent = '写真なし';
      return;
    }
    photoName.textContent = selectedPhoto.filename || '写真';
    const img = document.createElement('img');
    img.src = selectedPhoto.dataUrl;
    img.alt = '選択したマップ投稿写真のプレビュー';
    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'map-location-post-photo-clear';
    clearButton.setAttribute('aria-label', '写真を削除');
    clearButton.textContent = '×';
    clearButton.addEventListener('click', clearPhoto);
    photoPreview.append(img, clearButton);
    photoPreview.hidden = false;
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

  syncEventScheduleField();

  typeInput.addEventListener('change', syncEventScheduleField);

  photoBtn.addEventListener('click', () => {
    if (!sending) photoInput.click();
  });

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    if (!/^image\/(?:jpeg|png|webp)$/i.test(file.type || '')) {
      clearPhoto();
      setStatus?.('JPG・PNG・WebP画像のみ利用できます。');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      clearPhoto();
      setStatus?.('写真は12MB以下にしてください。');
      return;
    }
    photoBtn.disabled = true;
    photoName.textContent = '写真を準備しています…';
    try {
      selectedPhoto = await prepareMapPhoto(file);
      renderPhotoPreview();
      setStatus?.('写真を追加しました。投稿するとマップピンと一緒に保存されます。');
    } catch (error) {
      clearPhoto();
      setStatus?.(error?.message || '写真の準備に失敗しました。');
    } finally {
      photoBtn.disabled = false;
    }
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
    clearPhoto();
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
    const eventStartAt = eventType === 'イベント' ? String(eventStartInput.value || '').trim() : '';
    if (!message) {
      messageInput.focus();
      setStatus?.('その場所で起きたことを入力してください。');
      return;
    }
    if (!EVENT_TYPES.includes(eventType)) {
      setStatus?.('出来事の種類を選択してください。');
      return;
    }
    if (eventType === 'イベント' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(eventStartAt)) {
      eventStartInput.focus();
      setStatus?.('イベントの開催日時を入力してください。');
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

    if (selectedPhoto?.dataUrl && selectedPhoto.dataUrl.length > 3.8 * 1024 * 1024) {
      setStatus?.('写真データが大きすぎます。別の写真を選んでください。');
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
      eventStartAt,
      message
    };

    socket.emit('send-location-message', payload, async result => {
      if (!result?.ok) {
        sending = false;
        submitBtn.disabled = false;
        cancelBtn.disabled = false;
        modeBtn.disabled = false;
        submitBtn.textContent = '📤 この場所に投稿';
        setStatus?.(result?.message || '地図からの投稿に失敗しました。');
        return;
      }

      let photoResult = { ok: true };
      if (selectedPhoto?.dataUrl && result.messageId) {
        setStatus?.('投稿を作成しました。写真を保存しています…');
        photoResult = await new Promise(resolve => {
          socket.timeout(30000).emit('attach-media', {
            messageId: result.messageId,
            type: 'image',
            filename: selectedPhoto.filename || 'map-photo.jpg',
            dataUrl: selectedPhoto.dataUrl,
            thumbnailDataUrl: selectedPhoto.thumbnailDataUrl || selectedPhoto.dataUrl
          }, (error, uploadResult) => {
            if (error) return resolve({ ok: false, reason: 'timeout' });
            resolve(uploadResult?.ok ? uploadResult : { ok: false, reason: uploadResult?.reason || 'upload-failed' });
          });
        });
      }

      sending = false;
      submitBtn.disabled = false;
      cancelBtn.disabled = false;
      modeBtn.disabled = false;
      submitBtn.textContent = '📤 この場所に投稿';

      removeSelection();
      clearPhoto();
      form.hidden = true;
      setSelecting(false);
      messageInput.value = '';

      if (!photoResult.ok) {
        setStatus?.(`✅ 「${eventType}」の投稿は追加しましたが、写真の保存に失敗しました。写真なしで投稿されています。`);
        return;
      }

      setStatus?.(`✅ 選択した場所に「${eventType}」の投稿と写真を保存しました。`);
    });
  });
})();
