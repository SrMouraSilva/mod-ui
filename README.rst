mod-ui
======

This is the UI for the MOD software. It's a webserver that delivers an HTML5 interface and communicates with mod-host.
It also communicates with the MOD hardware, but does not depend on it to run.

Install
-------

There are instructions for installing in a 64-bit Debian based Linux environment.
It will work in x86, other Linux distributions and Mac, but you might need to adjust the instructions.

The following packages will be required::

    $ sudo apt-get install virtualenv python3-pip python3-dev git build-essential libasound2-dev libjack-jackd2-dev liblilv-dev libjpeg-dev zlib1g-dev

NOTE: libjack-jackd2-dev can be replaced by libjack-dev if you are using JACK1; libjpeg-dev is needed for python-pillow, at least on my system.

Start by cloning the repository::

    $ git clone git://github.com/moddevices/mod-ui
    $ cd mod-ui

Create a python virtualenv::

    $ virtualenv modui-env
    $ source modui-env/bin/activate

Install python requirements::

    $ pip3 install -r requirements.txt

Compile libmod_utils::

    $ make -C utils

Run
---

Before running the server, you need to activate your virtualenv
(if you have just done that during installation, you can skip this step, but you'll need to do this again when you open a new shell)::

    $ source modui-env/bin/activate

mod-ui depends on mod-host and the JACK server running in order to make sound. So after you have JACK setup and running, in another terminal do::

    $ mod-host -n -p 5555 -f 5556

If you do not have mod-host, you can tell mod-ui to fake the connection to the audio backend.
You will not get any audio, but you will be able to load plugins, make connections, save pedalboards and all that. For this, run::

    $ export MOD_DEV_HOST=1

And now you are ready to start the webserver::

    $ export MOD_DEV_ENVIRONMENT=0
    $ python3 ./server.py

Setting the environment variables is needed when developing on a PC.
Open your browser and point to http://localhost:8888/.

Tests
-----

Frontend tests live in ``test/js/`` and run under Node's built-in test runner against the
real files in ``html/`` (see ``test/js/README.md``)::

    $ npm install      # once, pulls in jsdom
    $ npm test

Python-side tests are plain ``unittest`` modules in ``test/``::

    $ python3 -m unittest discover -s test -p 'test_*.py'

MOD Desktop
-----------

The same code base runs inside `MOD Desktop <https://github.com/mod-audio/mod-desktop>`_ with
``MOD_DESKTOP=1``. That flag serves one extra script (``html/js/desktop-app.js``), one stylesheet
and the mustache partials under ``html/include/desktop-app/``; a MOD device never downloads any
of them. See the header of ``html/js/desktop-app.js`` for what the Desktop build shows and hides.

API documentation
-----------------

``docs/openapi.yml`` describes everything the backend exposes to the browser: the HTTP endpoints, the WebSocket
messages (``/websocket``, ``/rpbsocket``, ``/rplsocket``), the server-rendered pages and the other channels.
The rendered documentation is published at https://srmourasilva.github.io/mod-ui/.
Open the file with any OpenAPI viewer (Swagger UI, Redoc, the VS Code OpenAPI extension) or lint it with::

    $ npx @redocly/cli lint docs/openapi.yml

TypeScript client (modui-client)
--------------------------------

``modui-client/`` is a friendly, typed API to manage a MOD device from code (``fetch`` + WebSocket).
It hides the HTTP endpoints and WebSocket messages behind a few classes, so you can build new interfaces
for the device, beyond the classic mod-ui, in the browser or in Node.js. It is optional: the classic UI does not need it.

Build it with Node.js 22.12 or newer:

.. code-block:: bash

    $ cd modui-client
    $ npm install
    $ npm run build      # writes html/js/lib/modui-client.js (generated, not versioned)
    $ npm test           # type check + unit tests

Release builds must run ``npm install && npm run build`` in that folder before installing ``html/``.

In the page it is available as ``window.ModUiClient``; from another origin or from Node, pass
``new ModUiClient({ baseUrl: 'http://modduo.local' })``.

.. code-block:: javascript

    const client = new ModUiClient();

    // Get the pedalboards and switch the current one
    const pedalboards = await client.pedalboards.list();
    const info = await pedalboards[0].info();
    await client.device.load(info);

    // Load an effect into the running pedalboard and change a parameter
    const available = await client.device.plugins.list();
    const gain = available.find((plugin) => plugin.label === 'Gain');
    const instance = await client.device.currentPedalboard.plugins.add(gain, { x: 200, y: 100 });
    await instance.params.get('gain').setValue(3.5);

    // Events: react to changes, whoever makes them (the device, the HMI or another browser)
    client.device.currentPedalboard.on('plugin:added', ({ plugin }) => view.add(plugin));
    instance.params.get('gain').on('change', ({ value }) => knob.set(value));

For more details (connections, snapshots, banks, presets, patch parameters, UI frameworks, architecture and diagrams),
see ``docs/modui-client.md``.

Plugin GUIs outside mod-ui (modui-plugin-view)
----------------------------------------------

``modui-plugin-view/`` renders the GUI (modgui) of a plugin, its pedal and its settings panel, in any page and keeps it live through
``modui-client``: knobs, switches and selectors move when anybody changes a value, gestures write to the device, the plugin's own
JavaScript runs (with jQuery). With the two libraries a new frontend, a React SPA for instance, can manage a device without the classic UI.

.. code-block:: bash

    $ cd modui-plugin-view
    $ npm install
    $ npm test
    $ npm run build      # writes html/js/lib/modui-plugin-view.js (generated, not versioned)

.. code-block:: javascript

    const views = new PluginViews(client, { jQuery: window.jQuery });
    const view = await views.create(instance);          // a plugin of the running pedalboard; or a plugin URI for a local preview
    box.append(view.icon);  panel.append(view.settings);
    view.on('change', ({ symbol, value, origin }) => ...);

The page must be served from mod-ui's origin or through a proxy (no CORS). Guide: ``docs/modui-plugin-view.md``;
example page: ``modui-plugin-view/examples/``; plan: ``docs/plans/2026-10-modui-plugin-view.md``.