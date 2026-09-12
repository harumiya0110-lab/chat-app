(() => {
  const messages = document.getElementById('messages');
  if (!messages || typeof socket === 'undefined') return;

  function reasonMessage(reason) {
    return ({
      'not-owner': '自分が送った画像・動画だけ削除できます。',
      'not-found': 'この画像・動画は見つかりません。',
      'invalid': '削除対象が不正です。',
      'unauthorized': '参加してから削除してください。',
      'server-error': '削除中にエラーが発生しました。'
    })[reason] || '画像・動画の削除に失敗しました。';
  }

  function addDeleteControl(data) {
    const id = typeof data?.id === 'string' ? data.id.trim() : '';
    const ownerId = typeof data?.userId === 'string' ? data.userId : '';
    if (!id || !ownerId || ownerId !== socket.id) return;

    const items = messages.querySelectorAll('.message');
    const item = items[items.length - 1];
    if (!item || item.dataset.mediaId) return;

    item.dataset.mediaId = id;
    const actions = document.createElement('div');
    actions.className = 'message-actions media-message-actions';

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'chat-delete-btn media-delete-btn';
    deleteButton.textContent = '🗑 削除';
    deleteButton.title = '自分が送った画像・動画だけ削除できます';

    deleteButton.addEventListener('click', () => {
      if (!window.confirm('この画像・動画を削除しますか？')) return;
      deleteButton.disabled = true;
      deleteButton.textContent = '削除中…';
      socket.emit('delete-media', { id }, result => {
        if (!result?.ok) {
          deleteButton.disabled = false;
          deleteButton.textContent = '🗑 削除';
          const status = document.getElementById('status');
          if (status) status.textContent = reasonMessage(result?.reason);
          return;
        }
        item.remove();
        const status = document.getElementById('status');
        if (status) status.textContent = '画像・動画を削除しました。';
      });
    });

    actions.appendChild(deleteButton);
    item.appendChild(actions);
  }

  socket.on('receive-image', data => setTimeout(() => addDeleteControl(data), 0));
  socket.on('receive-video', data => setTimeout(() => addDeleteControl(data), 0));

  socket.on('media-deleted', data => {
    const id = typeof data?.id === 'string' ? data.id : '';
    if (!id) return;
    messages.querySelectorAll('.message').forEach(item => {
      if (item.dataset.mediaId === id) item.remove();
    });
  });
})();
