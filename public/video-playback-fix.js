(() => {
  const messages = document.getElementById('messages');
  if (!messages || typeof socket === 'undefined') return;

  function asUint8Array(value) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (Array.isArray(value)) return new Uint8Array(value);
    if (value && typeof value === 'object' && Array.isArray(value.data)) return new Uint8Array(value.data);
    return null;
  }

  socket.on('receive-video', data => {
    const items = messages.querySelectorAll('.message');
    const item = items[items.length - 1];
    const oldVideo = item?.querySelector('video');
    if (!item || !oldVideo) return;

    let blob = null;
    const bytes = asUint8Array(data?.video);
    if (bytes) {
      const type = typeof data?.videoType === 'string' && data.videoType.startsWith('video/')
        ? data.videoType
        : 'video/mp4';
      blob = new Blob([bytes], { type });
    } else if (typeof data?.video === 'string' && data.video.startsWith('data:video/')) {
      return;
    }

    if (!blob) {
      oldVideo.controls = true;
      return;
    }

    const url = URL.createObjectURL(blob);
    oldVideo.src = url;
    oldVideo.controls = true;
    oldVideo.preload = 'metadata';
    oldVideo.playsInline = true;
    oldVideo.load();
    oldVideo.addEventListener('loadedmetadata', () => {
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }, { once: true });
    oldVideo.addEventListener('error', () => {
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }, { once: true });
  });
})();
