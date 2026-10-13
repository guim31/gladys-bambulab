# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration holds:

- the LAN access codes of the printers, in the Gladys configuration (`secret`
  fields, never sent back to the browser by Gladys) — never in `/data`, never
  in the logs;
- `/data/bambulab-state.json`: per serial number, what the printer has
  (model, firmware, chamber, light, camera), its name and address as the
  network search found them, and when the print in progress started. No
  secret;
- network: TLS connections to the printers (MQTT on port 8883, camera on port 6000) at the addresses the administrator entered or the network search
  found, on the local network. The printer certificate is checked against
  the Bambu Lab authorities unless the administrator turns the check off. No
  other outbound connection: no Bambu Lab cloud.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the printers and their firmware.
