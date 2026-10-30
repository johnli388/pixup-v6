import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { handleCommand, type SimulatorState } from '../packages/channels/device-simulator';
// No .env loading: the simulator never needs payment or application secrets.
const [action = 'heartbeat', argument] = process.argv.slice(2);
if (action === 'init') {
  if (!argument) throw new Error('Usage: npm run cvm:sim -- init /absolute/device-directory');
  const dir = resolve(argument);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const keys = generateKeyPairSync('ed25519');
  await writeFile(
    join(dir, 'device-private.pem'),
    keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { flag: 'wx', mode: 0o600 },
  );
  await writeFile(
    join(dir, 'device-public.pem'),
    keys.publicKey.export({ type: 'spki', format: 'pem' }),
    { flag: 'wx', mode: 0o600 },
  );
  console.log(
    'Created device key files. Register device-public.pem in the channel workspace; keep device-private.pem local.',
  );
} else {
  const directory = process.env.CVM_SIM_DIR,
    device = process.env.CVM_SIM_DEVICE_ID;
  if (!directory || !device)
    throw new Error(
      'Set CVM_SIM_DIR and CVM_SIM_DEVICE_ID. Save the pinned server command public key as command-public.pem in that directory.',
    );
  const dir = resolve(directory),
    lock = join(dir, 'simulator.lock');
  const handle = await open(lock, 'wx', 0o600); // One process per device. A crash requires explicit lock removal.
  try {
    const key = await readFile(join(dir, 'device-private.pem'), 'utf8'),
      publicKey = await readFile(join(dir, 'command-public.pem'), 'utf8');
    const path = join(dir, 'journal.json');
    type State = SimulatorState & {
      heartbeat?: { event_id: string; type: 'heartbeat' };
      pending: Record<string, any>;
    };
    let state: State;
    try {
      state = JSON.parse(await readFile(path, 'utf8'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      state = { commands: {}, pending: {} };
    }
    async function save() {
      const tmp = path + '.tmp';
      await writeFile(tmp, JSON.stringify(state), { mode: 0o600, flush: true });
      await rename(tmp, path);
      const directoryHandle = await open(dir, 'r');
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    }
    async function send(body: any) {
      const raw = JSON.stringify(body),
        timestamp = String(Date.now());
      const response = await fetch(
        `${process.env.CVM_SIM_API_URL || 'http://127.0.0.1:4000/v1'}/devices/${encodeURIComponent(device!)}/events`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Device-Timestamp': timestamp,
            'X-Device-Signature': sign(
              null,
              Buffer.from(`${device}\n${timestamp}\n${raw}`),
              key,
            ).toString('base64'),
          },
          body: raw,
          signal: AbortSignal.timeout(10000),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Device request rejected');
      return result;
    }
    async function flush() {
      for (const [eventId, body] of Object.entries(state.pending)) {
        await send(body);
        delete state.pending[eventId];
        await save();
      }
    }
    await flush();
    if (action === 'deposit') {
      if (!argument) throw new Error('Supply a previously created return receipt ID.');
      const eventId = randomUUID();
      state.pending[eventId] = {
        event_id: eventId,
        type: 'deposit',
        return_id: argument,
        evidence: 'Simulator witnessed sealed return deposit; no real hardware connected',
      };
      await save();
      await flush();
    } else {
      if (action !== 'heartbeat') throw new Error('Use init, heartbeat or deposit.');
      state.heartbeat ??= { event_id: randomUUID(), type: 'heartbeat' };
      await save();
      const result = await send(state.heartbeat);
      for (const command of result.commands) {
        const outcome = await handleCommand(
          command,
          device,
          publicKey,
          {
            load: async () => structuredClone(state),
            save: async (next) => {
              state.commands = next.commands;
              await save();
            },
          },
          async () => {
            const simulated = process.env.CVM_SIM_OUTCOME || 'delivered';
            if (!['delivered', 'not_dispensed', 'unknown'].includes(simulated))
              throw new Error('CVM_SIM_OUTCOME must be delivered, not_dispensed or unknown');
            return simulated as 'delivered' | 'not_dispensed' | 'unknown';
          },
        );
        const eventId = `result-${command.id}`;
        state.pending[eventId] = {
          event_id: eventId,
          type: 'vend',
          command_id: command.id,
          outcome,
          evidence: `Local simulator outcome ${outcome}; no physical actuator connected`,
        };
        await save();
      }
      delete state.heartbeat;
      await save();
      await flush();
      console.log(
        `Simulator heartbeat processed ${result.commands.length} command(s); durable journal retained.`,
      );
    }
  } finally {
    await handle.close();
    await unlink(lock);
  }
}
