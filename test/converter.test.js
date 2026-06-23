const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  analyzeCompatibility,
  convertPlugin,
  injectCompatScript,
  normalizeManifestForStreamDock,
  normalizeRuntimeEventForStreamDeck
} = require('../src');

test('injectCompatScript adds script at the start of head and is idempotent', () => {
  const html = '<!doctype html><html><head><title>x</title></head><body></body></html>';
  const once = injectCompatScript(html);
  const twice = injectCompatScript(once);

  assert.match(once, /<head>\n  <script src="streamdeck-compat\.js"><\/script><title>x<\/title>/);
  assert.equal(twice, once);
});

test('normalizeManifestForStreamDock maps Encoder and middle values', () => {
  const manifest = {
    Actions: [
      {
        Controller: 'Encoder',
        TitleAlignment: 'middle',
        States: [{ TitleAlignment: 'middle' }]
      }
    ]
  };

  assert.deepEqual(normalizeManifestForStreamDock(manifest), {
    Actions: [
      {
        Controller: 'Knob',
        TitleAlignment: 'center',
        States: [{ TitleAlignment: 'center' }]
      }
    ]
  });
});

test('normalizeRuntimeEventForStreamDeck fills missing payload fields and maps Knob', () => {
  assert.deepEqual(
    normalizeRuntimeEventForStreamDeck({
      event: 'dialRotate',
      payload: {
        controller: 'Knob',
        titleParameters: { titleAlignment: 'center' }
      }
    }),
    {
      event: 'dialRotate',
      isInMultiAction: false,
      payload: {
        controller: 'Encoder',
        resources: {},
        isInMultiAction: false,
        titleParameters: { titleAlignment: 'middle' }
      }
    }
  );
});

test('analyzeCompatibility reports custom registration and unsupported APIs', () => {
  const report = analyzeCompatibility([
    {
      path: 'plugin.js',
      text: 'function connectElgatoStreamDeckSocket() {} websocket.setTitle(); websocket.setFeedback();'
    }
  ]);

  assert.equal(report.status, 'compatible-with-warnings');
  assert.deepEqual(report.supportedApis, ['setTitle']);
  assert.deepEqual(report.unsupportedApis, ['setFeedback']);
  assert.deepEqual(report.warnings, ['custom-registration-detected', 'unsupported-api:setFeedback']);
});

test('convertPlugin copies compat asset, injects html, converts manifest, and writes report', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2sd-source-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 's2sd-out-'));
  const outputRoot = path.join(out, 'plugin.sdPlugin');
  fs.mkdirSync(path.join(root, 'pi'));
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({
    Actions: [{ Name: 'Dial', Controller: 'Encoder', TitleAlignment: 'middle' }]
  }));
  fs.writeFileSync(path.join(root, 'plugin.html'), '<html><head></head><body><script src="plugin.js"></script></body></html>');
  fs.writeFileSync(path.join(root, 'pi', 'index.html'), '<html><head></head><body></body></html>');
  fs.writeFileSync(path.join(root, 'plugin.js'), 'websocket.getSecrets();');

  const report = convertPlugin(root, outputRoot);

  assert.equal(report.manifestConverted, true);
  assert.deepEqual(report.injectedHtml, ['pi/index.html', 'plugin.html']);
  assert.equal(report.compatibility.status, 'compatible-with-warnings');
  assert.equal(fs.existsSync(path.join(outputRoot, 'streamdeck-compat.js')), true);
  assert.match(fs.readFileSync(path.join(outputRoot, 'plugin.html'), 'utf8'), /<script src="streamdeck-compat\.js"><\/script>/);
  assert.match(fs.readFileSync(path.join(outputRoot, 'pi', 'index.html'), 'utf8'), /<script src="\.\.\/streamdeck-compat\.js"><\/script>/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outputRoot, 'manifest.json'), 'utf8')).Actions[0], {
    Name: 'Dial',
    Controller: 'Knob',
    TitleAlignment: 'center'
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outputRoot, 'conversion-report.json'), 'utf8')).compatibility.unsupportedApis, ['getSecrets']);
});
