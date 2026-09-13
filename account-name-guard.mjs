import { Server as SocketIOServer } from 'socket.io';
import { isAccountNameAvailable } from './firebase-persistence.mjs';

if (!SocketIOServer.prototype.__ruralAccountNameGuardInstalled) {
  const originalServerOn = SocketIOServer.prototype.on;

  SocketIOServer.prototype.on = function(eventName, listener) {
    if (eventName !== 'connection' || typeof listener !== 'function') {
      return originalServerOn.call(this, eventName, listener);
    }

    return originalServerOn.call(this, eventName, function guardedConnection(socket, ...args) {
      const originalSocketOn = socket.on.bind(socket);

      // メールアドレス連携アカウントの参加時だけ、予約済みのアカウント名を
      // 「名前だけで参加」の重複チェックから除外できるように先に記録します。
      originalSocketOn('email-account-session', payload => {
        const username = typeof payload?.username === 'string'
          ? payload.username.trim().slice(0, 20)
          : '';
        if (username) socket.__emailAccountName = username;
      });

      socket.on = function guardedSocketOn(name, handler) {
        if (name === 'email-account-session') {
          return originalSocketOn(name, payload => {
            const username = typeof payload?.username === 'string' ? payload.username.trim().slice(0, 20) : '';
            if (username) socket.__emailAccountName = username;
          });
        }

        if (name === 'set-username' && typeof handler === 'function') {
          const wrappedHandler = async function guardedSetUsername(username, ...handlerArgs) {
            const cleanUsername = typeof username === 'string' ? username.trim().slice(0, 50) : '';
            if (!cleanUsername) return handler.apply(socket, [username, ...handlerArgs]);

            const emailAccountName = String(socket.__emailAccountName || '').trim();
            if (emailAccountName && emailAccountName.toLowerCase() === cleanUsername.toLowerCase()) {
              return handler.apply(socket, [username, ...handlerArgs]);
            }

            try {
              const result = await isAccountNameAvailable(cleanUsername);
              if (result && result.available === false && result.reason !== 'server-error') {
                socket.emit('username-error', {
                  message: 'このアカウント名はメールアドレスと連携されています。名前だけの参加には使用できません。'
                });
                return;
              }
            } catch (error) {
              console.error('[account-name-guard] availability check failed:', error.message);
            }

            return handler.apply(socket, [username, ...handlerArgs]);
          };
          return originalSocketOn(name, wrappedHandler);
        }

        return originalSocketOn(name, handler);
      };

      return listener.call(this, socket, ...args);
    });
  };

  SocketIOServer.prototype.__ruralAccountNameGuardInstalled = true;
  console.log('Account-name guard enabled: email-linked account names are reserved from nickname-only entry.');
}
