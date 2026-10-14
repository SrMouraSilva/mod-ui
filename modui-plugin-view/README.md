# modui-plugin-view

Renders and drives the GUI (modgui) of [MOD](https://mod.audio) plugins in any web page, on top of
`modui-client`: the plugin's pedal (icon) and settings panel, filmstrip knobs, switches,
selectors, presets, and the plugin's own JavaScript. Knobs move when anybody changes a value (the classic UI, the HMI, another browser),
and gestures write to the device. Plain `HTMLElement`s, so it fits React, Vue, Svelte or no framework.

Not on the npm registry: every build of the repository is a GitHub pre-release with both packages as tarballs. Install the two `.tgz` of a
[release](https://github.com/mod-audio/mod-ui/releases) (the release page has the command):

```sh
npm install https://github.com/mod-audio/mod-ui/releases/download/<tag>/modui-client-<version>.tgz \
           https://github.com/mod-audio/mod-ui/releases/download/<tag>/modui-plugin-view-<version>.tgz
```

```ts
import { ModUiClient } from 'modui-client';
import { PluginViews } from 'modui-plugin-view';

const client = new ModUiClient({ baseUrl: location.origin });
const views = new PluginViews(client, { jQuery: window.jQuery });    // jQuery only for the plugins' own scripts

const [instance] = await client.device.currentPedalboard.plugins.list();
const view = await views.create(instance);        // a plugin of the running pedalboard; a plugin or its URI gives a local preview
pedalBox.append(view.icon);
settingsBox.append(view.settings);
view.on('change', ({ symbol, value, origin }) => console.log(symbol, value, origin));
```

- No runtime dependencies: `modui-client` is an optional peer (the library imports only its types; your client instance is the one used).
  Mustache and sprintf are the very files the classic UI uses, so templates and unit formats render exactly as in mod-ui.
- ES module with type declarations, no side effect. Without a bundler, `modui-plugin-view/global` sets `window.ModUiPluginView`.
- The page has to reach mod-ui from one origin (serve it from the device or through a proxy): the backend sends no CORS headers.

Documentation: <https://github.com/mod-audio/mod-ui/blob/master/docs/modui-plugin-view.md>.

AGPL-3.0-or-later.
