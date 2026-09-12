(() => {
  const videoButton = document.getElementById('video-btn');
  const status = document.getElementById('status');
  if (!videoButton || typeof socket === 'undefined') return;

  // client.js の既存の動画選択処理はBase64化して一括送信するため、
  // ここではcapture phaseで処理を差し替え、ArrayBufferのままSocket.IOへ渡します。
  videoButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', () => {
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

      if (status) status.textContent = `動画を送信しています… (${(file.size / 1024 / 1024).toFixed(1)}MB)`;

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const buffer = reader.result;
          if (!(buffer instanceof ArrayBuffer)) throw new Error('動画データの読み込み形式が不正です');

          socket.emit('send-video', {
            video: buffer,
            videoType: file.type,
            filename: file.name
          });

          if (status) status.textContent = '動画を送信しました。';
        } catch (error) {
          console.error('動画送信エラー:', error);
          if (status) status.textContent = '動画の送信に失敗しました。';
        }
      };
      reader.onerror = () => {
        if (status) status.textContent = '動画の読み込みに失敗しました。';
      };
      reader.readAsArrayBuffer(file);
    }, { once: true });

    input.click();
  }, true);

  console.log('Video upload override enabled.');
})();
