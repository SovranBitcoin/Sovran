// polyfills.js

// MessageChannel polyfill with full Web API compatibility
if (typeof global.MessageChannel === 'undefined') {
  class MessagePort {
    constructor() {
      this.onmessage = null;
      this.onmessageerror = null;
      this._listeners = new Map();
      this._otherPort = null;
    }

    postMessage(message) {
      if (this._otherPort) {
        setTimeout(() => {
          const event = { data: message, type: 'message' };

          // Call onmessage handler if set
          if (this._otherPort.onmessage) {
            this._otherPort.onmessage(event);
          }

          // Call addEventListener listeners
          const listeners = this._otherPort._listeners.get('message') || [];
          listeners.forEach((listener) => {
            try {
              listener(event);
            } catch (error) {
              console.error('MessagePort listener error:', error);
            }
          });
        }, 0);
      }
    }

    addEventListener(type, listener) {
      if (!this._listeners.has(type)) {
        this._listeners.set(type, []);
      }
      this._listeners.get(type).push(listener);
    }

    removeEventListener(type, listener) {
      if (this._listeners.has(type)) {
        const listeners = this._listeners.get(type);
        const index = listeners.indexOf(listener);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      }
    }

    start() {
      // MessagePort.start() - required by spec but no-op in this implementation
    }

    close() {
      // MessagePort.close() - required by spec
      this._otherPort = null;
      this._listeners.clear();
    }
  }

  global.MessageChannel = class MessageChannel {
    constructor() {
      this.port1 = new MessagePort();
      this.port2 = new MessagePort();

      // Connect the ports to each other
      this.port1._otherPort = this.port2;
      this.port2._otherPort = this.port1;
    }
  };
}
