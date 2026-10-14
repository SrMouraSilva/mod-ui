# modui-client

Typed client for the web interface backend of [MOD](https://mod.audio) audio devices (mod-ui): pedalboards, plugins, live editing of the
running pedalboard, presets, snapshots, banks, and the device's own reports, over `fetch` and the main WebSocket. No runtime dependencies.

Not on the npm registry: every build of the repository is a GitHub pre-release with the package as a tarball. Install the `.tgz` of a
[release](https://github.com/mod-audio/mod-ui/releases) (the release page has the command):

```sh
npm install https://github.com/mod-audio/mod-ui/releases/download/<tag>/modui-client-<version>.tgz
```

```ts
import { ModUiClient } from 'modui-client';

const client = new ModUiClient({ baseUrl: 'http://modduo.local' });   // no baseUrl: the page's own origin

const pedalboards = await client.pedalboards.list();
await client.device.load(await pedalboards[0].info());                // resolves after the device finished loading

const [gain] = (await client.device.plugins.list()).filter((plugin) => plugin.label === 'Gain');
const instance = await client.device.currentPedalboard.plugins.add(gain, { x: 200, y: 100 });
await instance.params.get('gain').setValue(3.5);

// react to changes, whoever makes them (the device, the HMI, another browser)
instance.params.get('gain').on('change', ({ value }) => console.log(value));
```

- ES module with type declarations; importing it has no side effect. ES2018, browsers and Node >= 18 (`fetch`, `WebSocket` are injectable).
- Without a bundler, `modui-client/global` is a script that sets `window.ModUiClient` and `window.ModUi`.
- Every public symbol has TSDoc that names the backend calls it makes.

Documentation (guide with diagrams, API contract): <https://github.com/mod-audio/mod-ui/blob/master/docs/modui-client.md>.
Plugin GUIs on top of this client: `modui-plugin-view`, in the same releases.

AGPL-3.0-or-later.
