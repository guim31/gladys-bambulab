# Bambu Lab for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that
follows and controls Bambu Lab 3D printers (X1, P1, A1, H2 and P2S series) over
the local network, through the MQTT broker the printer runs in LAN mode. No
cloud, no Bambu Lab account.

> **Developed without the hardware: feedback welcome.** The integration was
> exercised against real printer reports (the test data of
> [ha-bambulab](https://github.com/greghesp/ha-bambulab)) replayed by a real
> TLS MQTT broker (Eclipse Mosquitto) and a simulated camera, inside the locked
> Gladys sandbox, but never against a physical printer. Please report what
> works and what does not in the
> [issues](https://github.com/guim31/gladys-bambulab/issues).

## Features

- **One device per printer** (up to three): state, file, progress, time left,
  layer and total layers, nozzle / bed / chamber temperatures and their
  targets (read only: the integration never heats), print speed (silent,
  standard, sport, ludicrous), chamber light (a switch, not a lamp), pause and
  resume buttons, HMS errors as text, and the camera image of the P1 and A1
  series (their JPEG stream on port 6000).
- **Network search**: the printers announce themselves in SSDP on UDP ports
  1990 and 2021; Gladys captures the announcements for the integration
  (mediated discovery), so the IP address is optional and followed when it
  changes. **Find printers on the network** lists them.
- **Dashboard widget "Bambu Lab 3D print"**: progress gauge, time left,
  temperatures, last camera image, state, file, layer, end time, speed, HMS
  errors, AMS spools (material, colour, remaining), and the buttons that fit
  the moment (pause or resume, cancel with a confirmation, light).
- **Scene triggers**: print started, finished, failed or cancelled (filter by
  reason), paused, and new HMS error (filter by severity), with the file, the
  print time and the error code and text as variables.
- **Scene actions**: pause / resume / cancel a print, chamber light on or off,
  print speed.
- The firmwares of 2025 ("Authorization Control") refuse control commands
  unless the printer is in LAN only mode with Developer mode: the integration
  reads the flag the printer reports, says so instead of sending commands that
  would be refused, and keeps reading (and the light) working.
- HMS error texts in English, French, German and Spanish; every text and the
  documentation in the four languages.

## Requirements

- Gladys Assistant 5.1 or later.
- A Bambu Lab printer on the same network, its serial number and its LAN
  access code. LAN only mode and Developer mode for pause, resume, cancel and
  speed on recent firmwares.

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-bambulab` (or find **Bambu Lab** in the
   catalog).
2. In **Configuration**, enter the serial number and the access code of the
   printer (the IP address is optional), and save.
3. Add the printer from the **Discover** tab.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- MQTT 3.1.1 over TLS to `<printer>:8883`, user `bblp`, password the access
  code, subscribed to `device/<serial>/report`; requests go to
  `device/<serial>/request` (`get_version`, `pushall`, `pause`, `resume`,
  `stop`, `print_speed`, `ledctrl`). A small client of its own
  (`src/bambu/mqtt.js`): no dependency besides the SDK.
- The printer certificate is checked against Bambu Lab's authorities (the
  `printer.cer` of Bambu Studio, as ha-bambulab does), without a host name
  check (the certificate names the serial number); TLS 1.2 at most. An option
  turns the check off.
- The P1 and A1 send only what changed: the status is merged field by field.
  States are published at most every 5 seconds per printer (and at once on a
  state change), only when they changed (whole degrees, whole minutes).
- Print events come from the `gcode_state` transitions; a cancellation is told
  from a failure by the `print_error` code `0300_400C`. The status received at
  connection never fires an event.
- The camera of the P1 and A1: TLS on port 6000, an 80-byte authentication
  packet, then JPEG frames behind a 16-byte header. One image a minute during
  a print, one at the end, and on demand.
- What each printer has is kept in `/data/bambulab-state.json` (no secret), so
  a Gladys restart while the printer is off still publishes the same device.

## Limitations

- Up to three printers.
- No file upload, print start, G-code, temperature setting or timelapse.
- Camera for the P1 and A1 series only (the X1, H2 and P2S stream RTSPS, which
  would need ffmpeg); an image of 150 KB at most (a Gladys limit).
- H2D: one nozzle temperature, the active nozzle's.
- No cancel button on the device itself (one tap would ruin a print): the
  widget (with a confirmation) and the scenes offer it.

## Development

Node.js 22+, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test              # node --test: unit tests + simulated printers
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store .   # store validator
```

```
index.js                   SDK wiring (src/app.js registers the handlers)
src/hub.js                 printers, states, status, scene events, search, camera
src/printer.js             one printer: MQTT session, events, commands, camera
src/devices.js             printer -> Gladys device, snapshot -> states
src/bambu/mqtt.js          minimal MQTT 3.1.1 client
src/bambu/tls.js           TLS options, Bambu Lab authorities (certs/)
src/bambu/model.js         reading the reports, models, codes
src/bambu/camera.js        JPEG stream of the P1 and A1 (port 6000)
src/bambu/discovery.js     SSDP announcements
src/bambu/hms.js           HMS and print error texts (hms/)
src/widgets.js             dashboard widget
src/scenes.js              scene actions
src/texts.js               every text, in four languages
test/                      node --test; the SDK's fake Gladys, fake printers
test/fixtures/reports/     real reports (ha-bambulab test data), anonymized
```

`test/gladys-rules.test.js` checks every discovered device against the
category/type table extracted from the Gladys core.

To run it outside Gladys:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="bambulab" \
BAMBULAB_DATA_DIR=./data \
npm start
```

Releases are made by the **Release** workflow (Actions → Release); never edit
the versions by hand. A hand-pushed `vX.Y.Z` tag also builds the image and the
GitHub Release, but then `version` in `package.json` and in the manifest (with
the `docker_image` tag) must be bumped and committed before tagging. See
[`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [ha-bambulab](https://github.com/greghesp/ha-bambulab) by Greg Hesp and
  contributors (MIT): the protocol knowledge (`pybambu`: report fields,
  commands, camera stream, models, the Authorization Control flag), the HMS
  and print error texts (`src/bambu/hms/`, built from the lists Bambu Lab
  publishes), the Bambu Lab certificate authorities (`src/bambu/certs/`, from
  Bambu Studio's `printer.cer`), and the reports of `test/fixtures/reports/`
  (its test data, anonymized).
- The cover uses the Bambu Lab logo from Wikimedia Commons
  ([`File:BambuLab logo.svg`](https://commons.wikimedia.org/wiki/File:BambuLab_logo.svg),
  by Lwde, CC BY-SA 4.0).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Bambu Lab.
"Bambu Lab" is a trademark of its owner.
