(function streamDeckCompatBootstrap(global) {
  'use strict';

  var StreamDockControllerToDeck = {
    Knob: 'Encoder'
  };

  var DeckControllerToStreamDock = {
    Encoder: 'Knob'
  };

  var unsupportedEvents = [
    'getResources',
    'setResources',
    'getSecrets',
    'setFeedback',
    'setFeedbackLayout',
    'setTriggerDescription',
    'switchToProfile'
  ];

  var state = global.streamDeckCompat || global.$SD || {};
  state.uuid = state.uuid || null;
  state.event = state.event || null;
  state.info = state.info || {};
  state.actionInfo = state.actionInfo || {};
  state.websocket = state.websocket || null;
  state.warnings = state.warnings || [];
  state.customRegistrationDetected = typeof global.connectElgatoStreamDeckSocket === 'function';

  global.streamDeckCompat = state;
  global.$SD = state;

  function warn(message) {
    state.warnings.push(message);
    if (global.console && typeof global.console.warn === 'function') {
      global.console.warn('[streamdeck-compat] ' + message);
    }
  }

  function parseMaybeJson(value, fallback) {
    if (value == null || value === '') {
      return fallback;
    }
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch (error) {
        warn('failed to parse JSON argument: ' + error.message);
        return fallback;
      }
    }
    return value;
  }

  function clone(value) {
    if (value == null || typeof value !== 'object') {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(clone);
    }
    var result = {};
    Object.keys(value).forEach(function copyKey(key) {
      result[key] = clone(value[key]);
    });
    return result;
  }

  function normalizeTitleAlignmentForDeck(payload) {
    if (!payload || !payload.titleParameters) {
      return payload;
    }
    if (payload.titleParameters.titleAlignment === 'center') {
      payload.titleParameters.titleAlignment = 'middle';
    }
    return payload;
  }

  function normalizeTitleAlignmentForDock(payload) {
    if (!payload || !payload.titleParameters) {
      return payload;
    }
    if (payload.titleParameters.titleAlignment === 'middle') {
      payload.titleParameters.titleAlignment = 'center';
    }
    return payload;
  }

  function normalizePayloadForDeck(payload) {
    var normalized = clone(payload || {});
    if (normalized.controller === 'Knob') {
      normalized.controller = StreamDockControllerToDeck.Knob;
    }
    if (normalized.payload && normalized.payload.controller === 'Knob') {
      normalized.payload.controller = StreamDockControllerToDeck.Knob;
    }
    if (normalized.payload && !Object.prototype.hasOwnProperty.call(normalized.payload, 'resources')) {
      normalized.payload.resources = {};
    }
    if (normalized.payload && !Object.prototype.hasOwnProperty.call(normalized.payload, 'isInMultiAction')) {
      normalized.payload.isInMultiAction = false;
    }
    if (!Object.prototype.hasOwnProperty.call(normalized, 'isInMultiAction')) {
      normalized.isInMultiAction = false;
    }
    normalizeTitleAlignmentForDeck(normalized.payload);
    return normalized;
  }

  function normalizePayloadForDock(payload) {
    var normalized = clone(payload || {});
    if (normalized.controller === 'Encoder') {
      normalized.controller = DeckControllerToStreamDock.Encoder;
    }
    if (normalized.payload && normalized.payload.controller === 'Encoder') {
      normalized.payload.controller = DeckControllerToStreamDock.Encoder;
    }
    normalizeTitleAlignmentForDock(normalized.payload);
    return normalized;
  }

  function sendJson(socket, message) {
    var ws = socket || state.websocket;
    if (!ws || typeof ws.send !== 'function') {
      warn('cannot send "' + message.event + '": websocket is not connected');
      return false;
    }
    ws.send(JSON.stringify(normalizePayloadForDock(message)));
    return true;
  }

  function contextFrom(options) {
    if (options && options.context) {
      return options.context;
    }
    if (state.actionInfo && state.actionInfo.context) {
      return state.actionInfo.context;
    }
    return state.uuid;
  }

  function globalContextFrom() {
    return state.uuid;
  }

  function buildActionMessage(event, options, payload) {
    var message = {
      event: event,
      context: contextFrom(options),
      payload: payload || {}
    };
    if (options && options.action) {
      message.action = options.action;
    }
    return message;
  }

  function readImageAsDataUrl(url, callback) {
    if (/^data:/i.test(url)) {
      callback(url);
      return;
    }
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function onImageLoad() {
      try {
        var canvas = global.document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        var context = canvas.getContext('2d');
        context.drawImage(img, 0, 0);
        callback(canvas.toDataURL('image/png'));
      } catch (error) {
        warn('setImage could not convert image URL to data URL: ' + error.message);
      }
    };
    img.onerror = function onImageError() {
      warn('setImage could not load image URL: ' + url);
    };
    img.src = url;
  }

  function installHelpers(proto) {
    if (!proto || proto.__streamDeckCompatHelpers) {
      return;
    }

    var helpers = {
      setTitle: function setTitle(context, title, target, stateIndex) {
        return sendJson(this, {
          event: 'setTitle',
          context: context,
          payload: { title: title, target: target, state: stateIndex }
        });
      },
      setImage: function setImage(context, image, target, stateIndex) {
        var socket = this;
        readImageAsDataUrl(image, function sendImage(dataUrl) {
          sendJson(socket, {
            event: 'setImage',
            context: context,
            payload: { image: dataUrl, target: target, state: stateIndex }
          });
        });
      },
      setSettings: function setSettings(context, payload) {
        return sendJson(this, { event: 'setSettings', context: context || contextFrom(), payload: payload || {} });
      },
      getSettings: function getSettings(context) {
        return sendJson(this, { event: 'getSettings', context: context || contextFrom() });
      },
      setGlobalSettings: function setGlobalSettings(context, payload) {
        return sendJson(this, { event: 'setGlobalSettings', context: context || globalContextFrom(), payload: payload || {} });
      },
      getGlobalSettings: function getGlobalSettings(context) {
        return sendJson(this, { event: 'getGlobalSettings', context: context || globalContextFrom() });
      },
      sendToPlugin: function sendToPlugin(action, context, payload) {
        return sendJson(this, { event: 'sendToPlugin', action: action, context: context || contextFrom(), payload: payload || {} });
      },
      sendToPropertyInspector: function sendToPropertyInspector(action, context, payload) {
        return sendJson(this, { event: 'sendToPropertyInspector', action: action, context: context || contextFrom(), payload: payload || {} });
      },
      showAlert: function showAlert(context) {
        return sendJson(this, { event: 'showAlert', context: context || contextFrom() });
      },
      showOk: function showOk(context) {
        return sendJson(this, { event: 'showOk', context: context || contextFrom() });
      },
      setState: function setState(context, stateIndex) {
        return sendJson(this, { event: 'setState', context: context || contextFrom(), payload: { state: stateIndex } });
      },
      openUrl: function openUrl(url) {
        return sendJson(this, { event: 'openUrl', payload: { url: url } });
      },
      logMessage: function logMessage(message) {
        return sendJson(this, { event: 'logMessage', payload: { message: message } });
      }
    };

    unsupportedEvents.forEach(function addUnsupported(event) {
      helpers[event] = function unsupportedHelper() {
        warn(event + ' is not supported by the Stream Dock compatibility layer');
        return false;
      };
    });

    Object.keys(helpers).forEach(function install(name) {
      if (typeof proto[name] !== 'function') {
        proto[name] = helpers[name];
      }
    });

    Object.defineProperty(proto, '__streamDeckCompatHelpers', {
      value: true,
      enumerable: false
    });
  }

  function dispatchDeckEvent(message) {
    var normalized = normalizePayloadForDeck(message);
    var eventName = normalized.event;
    if (!eventName) {
      warn('received websocket message without event');
      return;
    }
    var handlerName = 'on' + eventName.charAt(0).toUpperCase() + eventName.slice(1);

    if (typeof state.onmessage === 'function') {
      state.onmessage(normalized);
    }
    if (typeof global[handlerName] === 'function') {
      global[handlerName](normalized);
    }
    if (typeof global.onStreamDeckEvent === 'function') {
      global.onStreamDeckEvent(normalized);
    }
  }

  function connectElgatoStreamDeckSocket(port, uuid, registerEvent, info, actionInfo) {
    state.uuid = uuid;
    state.event = registerEvent;
    state.info = parseMaybeJson(info, {});
    state.actionInfo = parseMaybeJson(actionInfo, {});

    var socket = new global.WebSocket('ws://127.0.0.1:' + port);
    state.websocket = socket;

    socket.onopen = function onOpen(event) {
      sendJson(socket, { event: registerEvent, uuid: uuid });
      if (typeof global.onConnected === 'function') {
        global.onConnected(socket, uuid, registerEvent, state.info, state.actionInfo, event);
      }
    };

    socket.onmessage = function onSocketMessage(event) {
      var message;
      try {
        message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch (error) {
        warn('failed to parse websocket message: ' + error.message);
        return;
      }
      dispatchDeckEvent(message);
    };

    socket.onerror = function onSocketError(event) {
      if (typeof global.onStreamDeckSocketError === 'function') {
        global.onStreamDeckSocketError(event);
      }
    };

    socket.onclose = function onSocketClose(event) {
      if (typeof global.onStreamDeckSocketClose === 'function') {
        global.onStreamDeckSocketClose(event);
      }
    };

    return socket;
  }

  if (global.WebSocket && global.WebSocket.prototype) {
    installHelpers(global.WebSocket.prototype);
  }

  state.connect = connectElgatoStreamDeckSocket;
  state.normalizePayloadForDeck = normalizePayloadForDeck;
  state.normalizePayloadForDock = normalizePayloadForDock;
  state.warn = warn;

  if (!state.customRegistrationDetected) {
    global.connectElgatoStreamDeckSocket = connectElgatoStreamDeckSocket;
  } else {
    warn('custom-registration-detected: preserving existing connectElgatoStreamDeckSocket');
  }
})(typeof window !== 'undefined' ? window : globalThis);
