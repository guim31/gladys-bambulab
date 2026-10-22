# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.3] - 2026-10-22

### Security

- Rebuilt on Node.js 24.22.1, the October 2026 security release (remote code
  execution in the Brotli decoder, CVE-2026-111497; TLS hostname and DNS
  fixes).

## [1.0.2] - 2026-10-14

### Fixed

- The webcam image is now sent to the Gladys camera device: it was sent under
  the feature id, which Gladys refused (404), so the dashboard camera never
  updated from the pushed images.

## [1.0.1] - 2026-10-13

### Changed

- Quieter logs: a printer that stays off, a camera that does not answer, a
  network search that is not available or Gladys refusing the states is now
  written once when it starts and once when it is back, instead of at every
  reconnection attempt, camera round or report.

## [1.0.0] - 2026-10-13

### Added

- One Gladys device per Bambu Lab printer, up to three, over the local MQTT
  of the printer (LAN mode, no cloud): state, file, progress, time left,
  layer and total layers, nozzle, bed and chamber temperatures with their
  targets (read only, kept out of the room temperature; the integration never
  heats), print speed, chamber light, pause and resume buttons, HMS errors,
  and the camera image of the P1 and A1 series.
- Network search: the IP address is optional, the printer is found from its
  announcements (through Gladys) and followed when its address changes.
  "Find printers on the network" lists the printers that announce themselves.
- "Bambu Lab 3D print" dashboard widget: progress gauge, time left,
  temperatures, last camera image, state, file, layer, end time, speed, HMS
  errors, AMS spools, and pause / resume / cancel (with confirmation) / light
  buttons depending on the state.
- Scene triggers: print started, print finished, print failed or cancelled
  (filter by reason), print paused, new HMS error (filter by severity), with
  the file, the print time, and the error code and text.
- Scene actions: pause, resume or cancel a print; chamber light on or off;
  print speed.
- Firmwares that refuse third-party commands (Developer mode off) are
  detected: the integration says so instead of sending refused commands.
- "Test the connection" action, and a connection status that says which
  printer needs attention.
- English, French, German and Spanish texts and documentation.

[Unreleased]: https://github.com/guim31/gladys-bambulab/compare/v1.0.3...HEAD
[1.0.3]: https://github.com/guim31/gladys-bambulab/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/guim31/gladys-bambulab/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/guim31/gladys-bambulab/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/guim31/gladys-bambulab/releases/tag/v1.0.0
