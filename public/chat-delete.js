(() => {
  if (typeof addNormalMessageDeleteControl !== 'function') return;

  const originalAddNormalMessageDeleteControl = addNormalMessageDeleteControl;
  window.addNormalMessageDeleteControl = function(item, data) {
    if (data?.id) item.dataset.messageId = String(data.id);
    return originalAddNormalMessageDeleteControl(item, data);
  };
})();
