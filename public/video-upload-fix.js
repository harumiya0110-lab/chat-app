(() => {
  const videoButton = document.getElementById('video-btn');
  const status = document.getElementById('status');
  const messages = document.getElementById('messages');
  if (!videoButton || typeof socket === 'undefined') return;

  function asUint8Array(value) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (Array.isArray(value)) return new Uint8Array(value);
    if (value && typeof value === 'object' && Array.isArray(value.data)) return new Uint8Array(value.data);
    return null;
  }

  function fixReceivedVideo(data) {
    if (!messages) return;
    const items = messages.querySelectorAll('.message');
    const item = items[items.length - 1];
    const video = item?.querySelector('video');
    if (!item || !video) return;

    const bytes = asUint8Array(data?.video);
    if (!bytes) {
      if (typeof data?.video === 'string' && data.video.startsWith('data:video/')) {
        video.src = data.video;
        video.controls = true;
        video.load();
      }
      return;
    }

    const type = typeof data?.videoType === 'string' && data.videoType.startsWith('video/')
      ? data.videoType
      : 'video/mp4';
    const blob = new Blob([bytes], { type });
    const objectUrl = URL.createObjectURL(blob);

    video.src = objectUrl;
    video.controls = true;
    video.preload = 'metadata';
    video.playsInline = true;
    video.load();

    const revoke = () => setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    video.addEventListener('loadedmetadata', revoke, { once: true });
    video.addEventListener('error', revoke, { once: true });
  }

  // client.jsで作られたvideo要素に、Socket.IOから届いたバイナリをBlob URLとして再設定します。
  socket.on('receive-video', fixReceivedVideo);

  // client.js の既存の動画選択処理はBase64化して一括送信するため、
  // capture phaseで処理を差し替え、ArrayBufferのままSocket.IOへ渡します。
  videoButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;

      const MAX_VIDEO_SIZE = 15 * 1024 * 1024;
      if (file.size > MAX_VIDEO_SIZE) {
        alert('動画は15MB以下にしてください');
        return;
      }

      if (!file.type || !file.type.startsWith('video/')) {
        alert('動画ファイルを選択してください');
        return;
      }

      if (!socket.connected) {
        if (status) status.textContent = 'サーバーに接続されていないため送信できません。';
        return;
      }

      if (status) status.textContent = `動画を読み込んでいます… (${(file.size / 1024 / 1024).toFixed(1)}MB)`;

      try {
        const buffer = await file.arrayBuffer();
        if (status) status.textContent = '動画を送信しています…';

        socket.timeout(60000).emit('send-video', {
          video: buffer,
          videoType: file.type,
          filename: file.name
        }, (err, result) => {
          if (err) {
            console.error('動画送信タイムアウト:', err);
            if (status) status.textContent = '動画の送信がタイムアウトしました。動画サイズを小さくして再試行してください。';
            return;
          }
          if (!result?.ok) {
            const message = result?.reason === 'too-large'
              ? '動画は15MB以下にしてください。'
              : '動画の送信に失敗しました。';
            if (status) status.textContent = message;
            return;
          }
          if (status) status.textContent = '動画を送信しました。';
        });
      } catch (error) {
        console.error('動画送信エラー:', error);
        if (status) status.textContent = '動画の送信処理に失敗しました。';
      }
    }, { once: true });

    input.click();
  }, true);

  console.log('Video upload and playback override enabled.');
})();
