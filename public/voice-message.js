(() => {
  const audioBtn = document.getElementById('audio-btn');
  const status = document.getElementById('status');
  const messages = document.getElementById('messages');

  if (!audioBtn || typeof MediaRecorder === 'undefined') {
    if (audioBtn) audioBtn.disabled = true;
    return;
  }

  let recorder = null;
  let recordingStream = null;
  let chunks = [];
  let startedAt = 0;
  let stopTimer = null;

  const MAX_RECORDING_MS = 180000;
  const MAX_AUDIO_SIZE = 8 * 1024 * 1024;

  function chooseMimeType() {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
      'audio/ogg'
    ];
    return candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
  }

  function setRecordingState(recording) {
    audioBtn.classList.toggle('is-recording', recording);
    audioBtn.textContent = recording ? '⏹️' : '🎙️';
    audioBtn.title = recording ? '録音を停止して送信' : '音声を録音して送る';
    audioBtn.setAttribute('aria-label', audioBtn.title);
  }

  function stopStream() {
    recordingStream?.getTracks().forEach(track => track.stop());
    recordingStream = null;
  }

  function addAudioMessage(data) {
    if (!data?.audio || !messages) return;

    let bytes;
    if (data.audio instanceof ArrayBuffer) {
      bytes = new Uint8Array(data.audio);
    } else if (ArrayBuffer.isView(data.audio)) {
      bytes = new Uint8Array(data.audio.buffer, data.audio.byteOffset, data.audio.byteLength);
    } else if (typeof data.audio === 'string' && data.audio.startsWith('data:')) {
      const audioUrl = data.audio;
      renderAudio(audioUrl, data);
      return;
    } else {
      return;
    }

    const blob = new Blob([bytes], { type: data.audioType || 'audio/webm' });
    const audioUrl = URL.createObjectURL(blob);
    renderAudio(audioUrl, data, true);
  }

  function renderAudio(audioUrl, data, revokeAfter = false) {
    const item = document.createElement('article');
    item.className = 'message' + (data.username === currentUsername ? ' own' : '');

    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'metadata';
    audio.src = audioUrl;
    audio.style.width = '100%';
    audio.style.maxWidth = '420px';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble voice-message-bubble';
    bubble.appendChild(audio);

    const header = document.createElement('div');
    header.className = 'message-header';
    const name = document.createElement('span');
    name.textContent = data.username || '投稿者';
    const time = document.createElement('span');
    time.textContent = data.timestamp || '';
    header.appendChild(name);
    header.appendChild(time);

    item.appendChild(header);
    item.appendChild(bubble);
    messages.appendChild(item);

    if (revokeAfter) {
      const revoke = () => setTimeout(() => URL.revokeObjectURL(audioUrl), 60000);
      audio.addEventListener('error', revoke, { once: true });
      setTimeout(() => URL.revokeObjectURL(audioUrl), 60000);
    }

    const chatItems = messages.querySelectorAll('.message');
    const max = 50;
    while (chatItems.length > max) chatItems[0].remove();
    messages.scrollTop = messages.scrollHeight;
  }

  function sendRecording(blob) {
    const reader = new FileReader();
    reader.onload = () => {
      if (!socket?.connected) {
        status.textContent = 'サーバーに接続されていないため、音声を送信できません。';
        return;
      }

      const elapsed = Math.max(0, Date.now() - startedAt);
      const extension = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm';
      status.textContent = '音声を送信しています…';

      const timer = setTimeout(() => {
        status.textContent = '音声の送信がタイムアウトしました。';
      }, 30000);

      socket.emit('send-audio', {
        audio: reader.result,
        audioType: blob.type,
        filename: `voice-message.${extension}`,
        durationMs: elapsed
      }, result => {
        clearTimeout(timer);
        if (result?.ok) {
          status.textContent = '音声を送信しました。';
        } else if (result?.reason === 'too-large') {
          status.textContent = '音声が大きすぎます。3分以内で録音してください。';
        } else if (result?.reason === 'unauthorized') {
          status.textContent = 'ログインしてから音声を送信してください。';
        } else {
          status.textContent = '音声の送信に失敗しました。';
        }
      });
    };
    reader.onerror = () => {
      status.textContent = '音声データの読み込みに失敗しました。';
    };
    reader.readAsArrayBuffer(blob);
  }

  async function startRecording() {
    if (recorder?.state === 'recording') return;
    if (!navigator.mediaDevices?.getUserMedia) {
      status.textContent = 'このブラウザではマイク録音を利用できません。';
      return;
    }

    try {
      recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const mimeType = chooseMimeType();
      recorder = mimeType ? new MediaRecorder(recordingStream, { mimeType }) : new MediaRecorder(recordingStream);
      chunks = [];
      startedAt = Date.now();

      recorder.addEventListener('dataavailable', event => {
        if (event.data?.size) chunks.push(event.data);
      });

      recorder.addEventListener('stop', () => {
        clearTimeout(stopTimer);
        stopStream();
        setRecordingState(false);

        const durationMs = Math.max(0, Date.now() - startedAt);
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
        chunks = [];
        recorder = null;

        if (!blob.size) {
          status.textContent = '音声が録音されませんでした。';
          return;
        }
        if (blob.size > MAX_AUDIO_SIZE) {
          status.textContent = '音声が大きすぎます。3分以内で録音してください。';
          return;
        }
        if (durationMs < 300) {
          status.textContent = 'もう少し長く話してから停止してください。';
          return;
        }

        startedAt = Date.now() - durationMs;
        sendRecording(blob);
      });

      recorder.addEventListener('error', error => {
        console.error('Audio recorder error:', error);
        clearTimeout(stopTimer);
        stopStream();
        recorder = null;
        chunks = [];
        setRecordingState(false);
        status.textContent = '音声の録音に失敗しました。';
      });

      recorder.start(250);
      setRecordingState(true);
      status.textContent = '🎙️ 録音中…もう一度押すと停止して送信します。';

      stopTimer = setTimeout(() => {
        if (recorder?.state === 'recording') recorder.stop();
      }, MAX_RECORDING_MS);
    } catch (error) {
      console.error(error);
      stopStream();
      status.textContent = error?.name === 'NotAllowedError'
        ? 'マイクの使用が許可されていません。ブラウザのマイク権限を確認してください。'
        : 'マイクを開始できませんでした。';
    }
  }

  function stopRecording() {
    if (recorder?.state === 'recording') {
      status.textContent = '録音を停止しています…';
      recorder.stop();
    }
  }

  audioBtn.addEventListener('click', () => {
    if (recorder?.state === 'recording') stopRecording();
    else startRecording();
  });

  socket.on('receive-audio', addAudioMessage);
})();
