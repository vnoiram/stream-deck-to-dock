# stream-deck-to-dock

`stream-deck-to-dock` is a small compatibility layer and converter for running Stream Deck WebSocket-style plugins on Stream Dock.

It targets JavaScript/HTML plugins that use the classic Stream Deck WebSocket API, including `connectElgatoStreamDeckSocket` and raw JSON messages over WebSocket. It does not attempt to emulate the `@elgato/streamdeck` SDK import/runtime model.

## What It Does

- Copies a Stream Deck plugin directory into a Stream Dock-ready output directory.
- Injects `streamdeck-compat.js` into plugin and Property Inspector HTML files.
- Converts manifest values used by Stream Dock:
  - `Encoder` to `Knob`
  - title alignment `middle` to `center`
- Provides a browser compatibility layer with:
  - `window.connectElgatoStreamDeckSocket`
  - `window.$SD`
  - `window.$SD.api` helper methods
  - `window.streamDeckCompat`
  - optional `WebSocket.prototype` helper methods
- Writes `conversion-report.json` with compatibility status and warnings.

## Usage

```bash
npm test
node bin/stream-deck-to-dock.js ./path/to/source.sdPlugin ./path/to/output.sdPlugin
```

If installed as a package, the CLI name is:

```bash
stream-deck-to-dock ./path/to/source.sdPlugin ./path/to/output.sdPlugin
```

## Compatibility Status

The report uses these statuses:

- `compatible`: runtime API usage appears supported.
- `compatible-with-warnings`: supported overall, but custom registration or unsupported APIs were detected.
- `manifest-only`: no JavaScript or HTML runtime files were found.
- `unsupported-runtime`: reserved for runtime shapes that cannot be translated cleanly.

## Supported Runtime APIs

The compatibility layer supports sending these Stream Deck-style events where Stream Dock has a practical equivalent:

- `setTitle`
- `setImage`
- `setSettings`
- `getSettings`
- `setGlobalSettings`
- `getGlobalSettings`
- `sendToPlugin`
- `sendToPropertyInspector`
- `showAlert`
- `showOk`
- `setState`
- `openUrl`
- `logMessage`

These helpers are available both as WebSocket instance methods, for plugins that call methods on their socket object, and as `$SD.api.*` methods for plugins that use a shared Stream Deck helper object.

Unsupported APIs are no-op helpers that record a warning instead of throwing:

- `getResources`
- `setResources`
- `getSecrets`
- `setFeedback`
- `setFeedbackLayout`
- `setTriggerDescription`
- `switchToProfile`

## Event Normalization

Incoming Stream Dock payloads are normalized for Stream Deck-style plugin code:

- `Knob` becomes `Encoder`.
- title alignment `center` becomes `middle`.
- missing `payload.resources` becomes `{}`.
- missing `payload.isInMultiAction` becomes `false`.

Outgoing manifest/runtime payloads are normalized in the opposite direction where needed.

## Development

Run the test suite with:

```bash
npm test
```

The tests cover manifest conversion, HTML injection, API compatibility reporting, registration, outbound helper JSON, unsupported API warnings, and incoming event normalization.

## Limitations

This is a compatibility bridge, not a full SDK reimplementation. Newer Stream Deck APIs that do not exist in Stream Dock are intentionally handled as no-op warnings. Image URL conversion for `setImage` depends on browser canvas access and may fail for cross-origin images.
