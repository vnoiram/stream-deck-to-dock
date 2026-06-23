const fs = require('node:fs');
const path = require('node:path');

const COMPAT_SCRIPT_NAME = 'streamdeck-compat.js';

const SUPPORTED_SEND_APIS = new Set([
  'setTitle',
  'setImage',
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

const UNSUPPORTED_APIS = new Set([
  'getResources',
  'setResources',
  'getSecrets',
  'setFeedback',
  'setFeedbackLayout',
  'setTriggerDescription',
  'switchToProfile',
  'deviceDidChange',
  'touchTap',
  'didReceiveResources',
  'didReceiveSecrets',
  'didReceiveDeepLink'
]);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function titleAlignmentToDock(value) {
  return value === 'middle' ? 'center' : value;
}

function titleAlignmentToDeck(value) {
  return value === 'center' ? 'middle' : value;
}

function normalizeControllerToDock(value) {
  return value === 'Encoder' ? 'Knob' : value;
}

function normalizeControllerToDeck(value) {
  return value === 'Knob' ? 'Encoder' : value;
}

function normalizeManifestForStreamDock(manifest) {
  const result = clone(manifest);
  const actions = Array.isArray(result.Actions) ? result.Actions : [];

  for (const action of actions) {
    if (action.Controller) {
      action.Controller = normalizeControllerToDock(action.Controller);
    }
    if (action.controller) {
      action.controller = normalizeControllerToDock(action.controller);
    }
    if (action.TitleAlignment) {
      action.TitleAlignment = titleAlignmentToDock(action.TitleAlignment);
    }
    if (action.titleAlignment) {
      action.titleAlignment = titleAlignmentToDock(action.titleAlignment);
    }
    if (action.States) {
      for (const actionState of action.States) {
        if (actionState.TitleAlignment) {
          actionState.TitleAlignment = titleAlignmentToDock(actionState.TitleAlignment);
        }
        if (actionState.titleAlignment) {
          actionState.titleAlignment = titleAlignmentToDock(actionState.titleAlignment);
        }
      }
    }
  }

  return result;
}

function normalizeRuntimeEventForStreamDeck(message) {
  const result = clone(message);
  if (result.controller) {
    result.controller = normalizeControllerToDeck(result.controller);
  }
  if (result.payload) {
    if (result.payload.controller) {
      result.payload.controller = normalizeControllerToDeck(result.payload.controller);
    }
    if (!Object.prototype.hasOwnProperty.call(result.payload, 'resources')) {
      result.payload.resources = {};
    }
    if (!Object.prototype.hasOwnProperty.call(result.payload, 'isInMultiAction')) {
      result.payload.isInMultiAction = false;
    }
    if (result.payload.titleParameters && result.payload.titleParameters.titleAlignment) {
      result.payload.titleParameters.titleAlignment = titleAlignmentToDeck(result.payload.titleParameters.titleAlignment);
    }
  }
  if (!Object.prototype.hasOwnProperty.call(result, 'isInMultiAction')) {
    result.isInMultiAction = false;
  }
  return result;
}

function injectCompatScript(html, scriptName = COMPAT_SCRIPT_NAME) {
  if (html.includes(scriptName)) {
    return html;
  }

  const tag = `<script src="${scriptName}"></script>`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>\n  ${tag}`);
  }
  if (/<!doctype html>/i.test(html)) {
    return html.replace(/<!doctype html>/i, `$&\n${tag}`);
  }
  return `${tag}\n${html}`;
}

function scanApiUsage(text) {
  const supported = [];
  const unsupported = [];

  for (const name of SUPPORTED_SEND_APIS) {
    if (new RegExp(`\\b${name}\\s*\\(`).test(text)) {
      supported.push(name);
    }
  }
  for (const name of UNSUPPORTED_APIS) {
    if (new RegExp(`\\b${name}\\b`).test(text)) {
      unsupported.push(name);
    }
  }

  return {
    supported: [...new Set(supported)].sort(),
    unsupported: [...new Set(unsupported)].sort(),
    customRegistrationDetected: /\bconnectElgatoStreamDeckSocket\s*=|function\s+connectElgatoStreamDeckSocket\b/.test(text)
  };
}

function classifyCompatibility({ hasRuntimeCode, customRegistrationDetected, unsupported }) {
  if (!hasRuntimeCode) {
    return 'manifest-only';
  }
  if (unsupported.length > 0) {
    return 'compatible-with-warnings';
  }
  if (customRegistrationDetected) {
    return 'compatible-with-warnings';
  }
  return 'compatible';
}

function analyzeCompatibility(files) {
  const aggregate = {
    supported: new Set(),
    unsupported: new Set(),
    customRegistrationDetected: false,
    hasRuntimeCode: false
  };

  for (const file of files) {
    if (!/\.(html|js|mjs|cjs)$/i.test(file.path)) {
      continue;
    }
    aggregate.hasRuntimeCode = true;
    const usage = scanApiUsage(file.text);
    usage.supported.forEach((name) => aggregate.supported.add(name));
    usage.unsupported.forEach((name) => aggregate.unsupported.add(name));
    aggregate.customRegistrationDetected ||= usage.customRegistrationDetected;
  }

  const unsupported = [...aggregate.unsupported].sort();
  return {
    status: classifyCompatibility({
      hasRuntimeCode: aggregate.hasRuntimeCode,
      customRegistrationDetected: aggregate.customRegistrationDetected,
      unsupported
    }),
    supportedApis: [...aggregate.supported].sort(),
    unsupportedApis: unsupported,
    warnings: [
      ...(aggregate.customRegistrationDetected ? ['custom-registration-detected'] : []),
      ...unsupported.map((name) => `unsupported-api:${name}`)
    ]
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function listFiles(root) {
  const result = [];
  const entries = fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...listFiles(fullPath));
    } else if (entry.isFile()) {
      result.push(fullPath);
    }
  }
  return result;
}

function copyAndConvertFile(sourceFile, sourceRoot, outputRoot, report) {
  const relative = path.relative(sourceRoot, sourceFile);
  const outputFile = path.join(outputRoot, relative);
  ensureDir(path.dirname(outputFile));

  if (/manifest\.json$/i.test(path.basename(sourceFile))) {
    const manifest = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
    const converted = normalizeManifestForStreamDock(manifest);
    fs.writeFileSync(outputFile, `${JSON.stringify(converted, null, 2)}\n`);
    report.manifestConverted = true;
    return;
  }

  if (/\.html$/i.test(sourceFile)) {
    const scriptPath = path.relative(path.dirname(outputFile), path.join(outputRoot, COMPAT_SCRIPT_NAME)).replaceAll(path.sep, '/');
    const converted = injectCompatScript(fs.readFileSync(sourceFile, 'utf8'), scriptPath);
    fs.writeFileSync(outputFile, converted);
    report.injectedHtml.push(relative);
    return;
  }

  fs.copyFileSync(sourceFile, outputFile);
}

function convertPlugin(sourceRoot, outputRoot) {
  const sourceFiles = listFiles(sourceRoot);
  const textFiles = [];
  for (const file of sourceFiles) {
    if (/\.(html|js|mjs|cjs)$/i.test(file)) {
      textFiles.push({ path: file, text: fs.readFileSync(file, 'utf8') });
    }
  }

  ensureDir(outputRoot);
  const report = {
    sourceRoot,
    outputRoot,
    manifestConverted: false,
    injectedHtml: [],
    compatibility: analyzeCompatibility(textFiles)
  };

  for (const file of sourceFiles) {
    copyAndConvertFile(file, sourceRoot, outputRoot, report);
  }

  fs.copyFileSync(path.join(__dirname, COMPAT_SCRIPT_NAME), path.join(outputRoot, COMPAT_SCRIPT_NAME));
  fs.writeFileSync(path.join(outputRoot, 'conversion-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

module.exports = {
  COMPAT_SCRIPT_NAME,
  SUPPORTED_SEND_APIS,
  UNSUPPORTED_APIS,
  analyzeCompatibility,
  convertPlugin,
  injectCompatScript,
  normalizeControllerToDeck,
  normalizeControllerToDock,
  normalizeManifestForStreamDock,
  normalizeRuntimeEventForStreamDeck,
  titleAlignmentToDeck,
  titleAlignmentToDock
};
