import { Socket } from 'socket.io';

// 大きな動画をbase64文字列としてSocket.IOへ一発で送ると、ブラウザや
// Render側で負荷が高くなりやすいため、クライアントからのArrayBufferを
// サーバー側で受け取り、既存のsend-video処理へDataURLとして渡します。
const originalSocketOn = Socket.prototype.on;

Socket.prototype.on = function(eventName, listener) {
  if (eventName !== 'send-video' || typeof listener !== 'function') {
    return originalSocketOn.call(this, eventName, listener);
  }

  const wrappedListener = (data, ...rest) => {
    const video = data?.video;
    const isBuffer = Buffer.isBuffer(video);
    const isArrayBuffer = video instanceof ArrayBuffer;
    const isTypedArray = ArrayBuffer.isView(video);

    if (!isBuffer && !isArrayBuffer && !isTypedArray) {
      return listener.call(this, data, ...rest);
    }

    try {
      const bytes = isBuffer
        ? video
        : Buffer.from(isArrayBuffer ? new Uint8Array(video) : video);

      if (bytes.length > 15 * 1024 * 1024) return;

      const mime = typeof data?.videoType === 'string' && /^video\/[a-z0-9.+-]+$/i.test(data.videoType)
        ? data.videoType
        : 'video/mp4';
      const dataUrl = `data:${mime};base64,${bytes.toString('base64')}`;

      return listener.call(this, { ...data, video: dataUrl }, ...rest);
    } catch (error) {
      console.error('Video binary conversion failed:', error);
    }
  };

  return originalSocketOn.call(this, eventName, wrappedListener);
};

console.log('Binary video upload compatibility enabled.');
