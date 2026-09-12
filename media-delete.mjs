import crypto from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';

const mediaOwners = new Map();
const MAX_TRACKED_MEDIA = 1000;

function rememberMedia(id, ownerId) {
  mediaOwners.set(id, ownerId);
  while (mediaOwners.size > MAX_TRACKED_MEDIA) {
    const oldestId = mediaOwners.keys().next().value;
    if (!oldestId) break;
    mediaOwners.delete(oldestId);
  }
}

const originalServerEmit = SocketIOServer.prototype.emit;
SocketIOServer.prototype.emit = function(eventName, ...args) {
  if (eventName === 'receive-image' || eventName === 'receive-video') {
    const payload = args[0];
    if (payload && typeof payload === 'object') {
      const id = typeof payload.id === 'string' && payload.id.trim()
        ? payload.id.trim()
        : `media-${crypto.randomUUID()}`;
      const ownerId = typeof payload.userId === 'string' ? payload.userId : '';
      if (ownerId) rememberMedia(id, ownerId);
      args[0] = { ...payload, id };
    }
  }
  return originalServerEmit.call(this, eventName, ...args);
};

const originalServerOn = SocketIOServer.prototype.on;
SocketIOServer.prototype.on = function(eventName, listener) {
  if (eventName !== 'connection') return originalServerOn.call(this, eventName, listener);

  const wrappedListener = (socket, ...rest) => {
    socket.on('delete-media', (payload = {}, ack) => {
      const id = typeof payload.id === 'string' ? payload.id.trim() : '';
      if (!id) {
        if (typeof ack === 'function') ack({ ok: false, reason: 'invalid' });
        return;
      }

      const ownerId = mediaOwners.get(id);
      if (!ownerId) {
        if (typeof ack === 'function') ack({ ok: false, reason: 'not-found' });
        return;
      }

      if (ownerId !== socket.id) {
        if (typeof ack === 'function') ack({ ok: false, reason: 'not-owner' });
        return;
      }

      mediaOwners.delete(id);
      socket.server.emit('media-deleted', { id });
      if (typeof ack === 'function') ack({ ok: true });
    });

    return listener(socket, ...rest);
  };

  return originalServerOn.call(this, eventName, wrappedListener);
};

console.log('Media ownership/deletion controls enabled.');
