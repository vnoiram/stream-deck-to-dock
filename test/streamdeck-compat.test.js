const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadCompat(extra = {}) {
  const sent = [];
  const sockets = [];

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.sent = sent;
      sockets.push(this);
    }

    send(text) {
      sent.push(JSON.parse(text));
    }
  }

  const sandbox = {
    console: { warn() {} },
    Image: class {},
    WebSocket: FakeWebSocket,
    ...extra
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'streamdeck-compat.js'), 'utf8'), sandbox);

  return { sandbox, sent, sockets };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('connectElgatoStreamDeckSocket accepts JSON strings and sends registration on open', () => {
  const { sandbox, sent, sockets } = loadCompat();
  const socket = sandbox.connectElgatoStreamDeckSocket(
    12345,
    'plugin-uuid',
    'registerPlugin',
    '{"application":{"version":"1"}}',
    '{"context":"action-context"}'
  );

  assert.equal(socket.url, 'ws://127.0.0.1:12345');
  assert.deepEqual(plain(sandbox.streamDeckCompat.info), { application: { version: '1' } });
  assert.deepEqual(plain(sandbox.streamDeckCompat.actionInfo), { context: 'action-context' });

  sockets[0].onopen({});
  assert.deepEqual(sent[0], { event: 'registerPlugin', uuid: 'plugin-uuid' });
});

test('connectElgatoStreamDeckSocket accepts object args and dispatches normalized events', () => {
  let received;
  const { sandbox, sockets } = loadCompat({
    onDialRotate(message) {
      received = message;
    }
  });

  sandbox.connectElgatoStreamDeckSocket(12345, 'plugin-uuid', 'registerPlugin', {}, { context: 'ctx' });
  sockets[0].onmessage({
    data: JSON.stringify({
      event: 'dialRotate',
      payload: { controller: 'Knob', titleParameters: { titleAlignment: 'center' } }
    })
  });

  assert.deepEqual(plain(received), {
    event: 'dialRotate',
    isInMultiAction: false,
    payload: {
      controller: 'Encoder',
      resources: {},
      isInMultiAction: false,
      titleParameters: { titleAlignment: 'middle' }
    }
  });
});

test('WebSocket helpers send Stream Deck-compatible API messages to Stream Dock', () => {
  const { sandbox, sent, sockets } = loadCompat();
  sandbox.connectElgatoStreamDeckSocket(12345, 'plugin-uuid', 'registerPlugin', {}, { context: 'ctx' });

  sockets[0].setTitle('ctx', 'Hello', 0, 1);
  sockets[0].setSettings('ctx', { a: 1 });
  sockets[0].getSettings('ctx');
  sockets[0].setGlobalSettings(null, { g: true });
  sockets[0].getGlobalSettings();
  sockets[0].sendToPlugin('action', 'ctx', { p: true });
  sockets[0].sendToPropertyInspector('action', 'ctx', { pi: true });
  sockets[0].showAlert('ctx');
  sockets[0].showOk('ctx');
  sockets[0].setState('ctx', 1);
  sockets[0].openUrl('https://example.test');
  sockets[0].logMessage('msg');

  assert.deepEqual(sent.map((message) => message.event), [
    'setTitle',
    'setSettings',
    'getSettings',
    'setGlobalSettings',
    'getGlobalSettings',
    'sendToPlugin',
    'sendToPropertyInspector',
    'showAlert',
    'showOk',
    'setState',
    'openUrl',
    'logMessage'
  ]);
  assert.deepEqual(sent[0], {
    event: 'setTitle',
    context: 'ctx',
    payload: { title: 'Hello', target: 0, state: 1 }
  });
  assert.equal(sent[3].context, 'plugin-uuid');
});

test('$SD.api helpers send through the active websocket', () => {
  const { sandbox, sent } = loadCompat();
  sandbox.connectElgatoStreamDeckSocket(12345, 'plugin-uuid', 'registerPlugin', {}, { context: 'ctx' });

  sandbox.$SD.api.setTitle('ctx', 'Hello', 0, 1);
  sandbox.$SD.api.setSettings('ctx', { a: 1 });
  sandbox.$SD.api.getSettings('ctx');
  sandbox.$SD.api.setGlobalSettings(null, { g: true });
  sandbox.$SD.api.getGlobalSettings();
  sandbox.$SD.api.sendToPlugin('action', 'ctx', { p: true });
  sandbox.$SD.api.sendToPropertyInspector('action', 'ctx', { pi: true });
  sandbox.$SD.api.showAlert('ctx');
  sandbox.$SD.api.showOk('ctx');
  sandbox.$SD.api.setState('ctx', 1);
  sandbox.$SD.api.openUrl('https://example.test');
  sandbox.$SD.api.logMessage('msg');

  assert.deepEqual(sent.map((message) => message.event), [
    'setTitle',
    'setSettings',
    'getSettings',
    'setGlobalSettings',
    'getGlobalSettings',
    'sendToPlugin',
    'sendToPropertyInspector',
    'showAlert',
    'showOk',
    'setState',
    'openUrl',
    'logMessage'
  ]);
  assert.deepEqual(sent[0], {
    event: 'setTitle',
    context: 'ctx',
    payload: { title: 'Hello', target: 0, state: 1 }
  });
  assert.equal(sent[3].context, 'plugin-uuid');
});

test('$SD.api preserves existing helper functions and fills missing ones', () => {
  function customSetTitle() {
    return 'custom';
  }
  const { sandbox } = loadCompat({
    $SD: {
      api: {
        setTitle: customSetTitle
      }
    }
  });

  assert.equal(sandbox.$SD.api.setTitle, customSetTitle);
  assert.equal(sandbox.$SD.api.setTitle(), 'custom');
  assert.equal(typeof sandbox.$SD.api.setSettings, 'function');
});

test('unsupported helper records warning and does not throw', () => {
  const { sandbox, sockets } = loadCompat();
  sandbox.connectElgatoStreamDeckSocket(12345, 'plugin-uuid', 'registerPlugin', {}, {});

  assert.equal(sockets[0].setFeedback({ value: 1 }), false);
  assert.deepEqual(plain(sandbox.streamDeckCompat.warnings), [
    'setFeedback is not supported by the Stream Dock compatibility layer'
  ]);
});

test('custom registration is preserved while prototype helpers are still installed', () => {
  function existingConnect() {}
  const { sandbox } = loadCompat({ connectElgatoStreamDeckSocket: existingConnect });

  assert.equal(sandbox.connectElgatoStreamDeckSocket, existingConnect);
  assert.equal(typeof sandbox.WebSocket.prototype.setTitle, 'function');
  assert.equal(sandbox.streamDeckCompat.customRegistrationDetected, true);
  assert.deepEqual(plain(sandbox.streamDeckCompat.warnings), [
    'custom-registration-detected: preserving existing connectElgatoStreamDeckSocket'
  ]);
});
