(() => {
  if (typeof socket === 'undefined' || typeof messages === 'undefined') return;

  // client.js が投稿を描画した直後に、Firestoreの投稿IDをDOMへ紐付けます。
  // これにより削除通知を受けた他の参加者の画面からも同じ投稿を消せます。
  socket.on('receive-message', data => {
    if (!data?.id) return;
    const items = messages.querySelectorAll('.message');
    const item = items[items.length - 1];
    if (item) item.dataset.messageId = String(data.id);
  });
})();
