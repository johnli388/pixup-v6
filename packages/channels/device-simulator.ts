import { verify } from 'node:crypto';

export type SimulatorState = {
  commands: Record<
    string,
    {
      payload: string;
      state: 'executing' | 'done';
      outcome?: 'delivered' | 'not_dispensed' | 'unknown';
    }
  >;
};
export type SignedCommand = { id: string; payload: string; signature: string };
export type DeviceJournal = {
  load(): Promise<SimulatorState>;
  save(state: SimulatorState): Promise<void>;
};

/** Adapter contract: durable journal before actuator invocation. A crash during
 * execution is unknown, never a reason to invoke the actuator a second time.
 * The supplied actuator below is simulated; real firmware must provide this
 * guarantee at its hardware boundary as well. */
export async function handleCommand(
  command: SignedCommand,
  device: string,
  serverPublicKey: string,
  journal: DeviceJournal,
  actuator: () => Promise<'delivered' | 'not_dispensed' | 'unknown'>,
) {
  if (
    !verify(
      null,
      Buffer.from(command.payload),
      serverPublicKey,
      Buffer.from(command.signature, 'base64'),
    )
  )
    throw new Error('Invalid server command signature');
  const payload = JSON.parse(command.payload);
  if (
    payload.command_id !== command.id ||
    payload.device_id !== device ||
    payload.action !== 'dispense' ||
    !payload.slot ||
    !Number.isFinite(Date.parse(payload.expires_at))
  )
    throw new Error('Invalid device command');
  const state = await journal.load(),
    prior = state.commands[command.id];
  if (prior && prior.payload !== command.payload) throw new Error('Command identity changed');
  if (prior?.state === 'done') return prior.outcome!;
  if (prior?.state === 'executing') {
    state.commands[command.id] = { payload: command.payload, state: 'done', outcome: 'unknown' };
    await journal.save(state);
    return 'unknown';
  }
  if (Date.parse(payload.expires_at) <= Date.now()) {
    state.commands[command.id] = {
      payload: command.payload,
      state: 'done',
      outcome: 'not_dispensed',
    };
    await journal.save(state);
    return 'not_dispensed';
  }
  state.commands[command.id] = { payload: command.payload, state: 'executing' };
  await journal.save(state);
  // If the actuator or post-actuation journal write fails, retain executing.
  const outcome = await actuator();
  state.commands[command.id] = { payload: command.payload, state: 'done', outcome };
  await journal.save(state);
  return outcome;
}
