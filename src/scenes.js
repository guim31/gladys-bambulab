// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// A refused command (nothing to pause, no print to change the speed of) is not
// an error of the scene: the action resolves `applied: false`, so the scene
// can go on or test it. An unreachable printer, a firmware that refuses
// commands, or an unknown printer, throws (the action fails, the scene
// continues and logs it).
//
// The triggers (`print_started`, `print_done`...) are fired by the hub from
// the printer's own reports, never as an echo of these actions.
// No action heats anything: the targets stay read only (see src/devices.js).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { SPEEDS } from './bambu/model.js';
import { CommandError } from './hub.js';

const logger = createLogger({ name: 'bambulab-scenes' });

// `cancel` is sent to the printer as `stop`.
export const PRINT_COMMANDS = ['pause', 'resume', 'cancel'];
export const LIGHT_STATES = ['on', 'off'];
export const SPEED_NAMES = Object.values(SPEEDS);

const REFUSALS = new Set(['not_printing', 'not_paused', 'no_light']);

async function applied(run, what) {
  try {
    await run();
    return { applied: true };
  } catch (err) {
    if (err instanceof CommandError && REFUSALS.has(err.code)) {
      logger.info(`${what}: not applied (${err.code})`);
      return { applied: false };
    }
    throw err;
  }
}

export const SCENE_ACTIONS = {
  control_print(hub, { fields }) {
    const command = fields.command;
    if (!PRINT_COMMANDS.includes(command)) {
      throw new Error(`Unknown print command ${command}`);
    }
    const name = command === 'cancel' ? 'stop' : command;
    return applied(() => hub.command(fields.device, name), `control_print ${command}`);
  },

  set_light(hub, { fields }) {
    const state = fields.state;
    if (!LIGHT_STATES.includes(state)) {
      throw new Error(`Unknown light state ${state}`);
    }
    return applied(() => hub.command(fields.device, 'light', state), `set_light ${state}`);
  },

  set_speed(hub, { fields }) {
    const level = hub.speedLevel(fields.speed);
    return applied(() => hub.command(fields.device, 'speed', level), `set_speed ${fields.speed}`);
  },
};
