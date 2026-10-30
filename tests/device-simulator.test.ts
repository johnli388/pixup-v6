import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { handleCommand, type SimulatorState } from '../packages/channels/device-simulator';
const keys = generateKeyPairSync('ed25519'),
  publicKey = keys.publicKey.export({ format: 'pem', type: 'spki' }).toString();
function command(expired = false) {
  const payload = JSON.stringify({
    command_id: 'command-1',
    device_id: 'device-1',
    action: 'dispense',
    slot: '1',
    expires_at: new Date(Date.now() + (expired ? -1000 : 300000)).toISOString(),
  });
  return {
    id: 'command-1',
    payload,
    signature: sign(null, Buffer.from(payload), keys.privateKey).toString('base64'),
  };
}
function storage() {
  let state: SimulatorState = { commands: {} };
  return {
    load: async () => structuredClone(state),
    save: async (next: SimulatorState) => {
      state = structuredClone(next);
    },
  };
}
test('device simulator persists before actuation and does not execute a replay twice', async () => {
  const store = storage(),
    c = command();
  let calls = 0;
  const actuator = async () => {
    calls++;
    assert.equal((await store.load()).commands[c.id].state, 'executing');
    return 'delivered' as const;
  };
  assert.equal(await handleCommand(c, 'device-1', publicKey, store, actuator), 'delivered');
  assert.equal(await handleCommand(c, 'device-1', publicKey, store, actuator), 'delivered');
  assert.equal(calls, 1);
});
test('device simulator treats crash during actuation as unknown after restart', async () => {
  const store = storage(),
    c = command();
  let calls = 0;
  const actuator = async () => {
    calls++;
    throw new Error('Process interrupted after physical action');
  };
  await assert.rejects(handleCommand(c, 'device-1', publicKey, store, actuator));
  assert.equal(await handleCommand(c, 'device-1', publicKey, store, actuator), 'unknown');
  assert.equal(calls, 1);
});
test('device simulator rejects tampering and misrouting, and refuses expired actuation', async () => {
  const store = storage(),
    c = command();
  let calls = 0;
  const actuator = async () => {
    calls++;
    return 'delivered' as const;
  };
  await assert.rejects(
    handleCommand({ ...c, payload: c.payload + ' ' }, 'device-1', publicKey, store, actuator),
  );
  await assert.rejects(handleCommand(c, 'device-2', publicKey, store, actuator));
  assert.equal(
    await handleCommand(command(true), 'device-1', publicKey, store, actuator),
    'not_dispensed',
  );
  assert.equal(calls, 0);
});
