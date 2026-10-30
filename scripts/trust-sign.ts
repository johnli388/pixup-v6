import { readFile, writeFile, open } from 'node:fs/promises';
import { createPrivateKey, sign } from 'node:crypto';
import { join } from 'node:path';
import { canonical, digest, merkle, signingBytes } from '../packages/domain/trust';
const [input, output] = process.argv.slice(2),
  keyPath = process.env.PIXUP_SIGNING_KEY_FILE,
  keyId = process.env.PIXUP_SIGNING_KEY_ID;
if (!input || !output || !keyPath || !keyId)
  throw new Error(
    'Use trust:sign request.json signature.json with PIXUP_SIGNING_KEY_FILE and PIXUP_SIGNING_KEY_ID. This offline script never loads .env.',
  );
const request = JSON.parse(await readFile(input, 'utf8'));
if (
  request.payload?.version !== 'pixup-trust-v1' ||
  !['certificate', 'checkpoint'].includes(request.payload.kind) ||
  request.request_id !== request.payload.request_id ||
  digest(canonical(request.payload)) !== request.payload_hash
)
  throw new Error('Invalid signing request envelope.');
if (
  request.payload.kind === 'checkpoint' &&
  (merkle(request.entries).root !== request.payload.root ||
    request.entries.length !== request.payload.count)
)
  throw new Error('Checkpoint root mismatch.');
const key = createPrivateKey(await readFile(keyPath, 'utf8'));
if (key.asymmetricKeyType !== 'ed25519') throw new Error('An Ed25519 private key is required.');
const artifact = {
  request_id: request.request_id,
  key_id: keyId,
  signature: sign(null, signingBytes(request.payload), key).toString('base64'),
};
if (request.payload.kind === 'checkpoint') {
  const archive = process.env.PIXUP_CHECKPOINT_ARCHIVE_DIR,
    sequence = request.payload.sequence;
  if (!archive || !Number.isSafeInteger(sequence) || sequence < 1)
    throw new Error(
      'Checkpoint signing requires an independently controlled PIXUP_CHECKPOINT_ARCHIVE_DIR and positive sequence.',
    );
  const name = (n: number) => join(archive, `${String(n).padStart(10, '0')}.json`);
  if (sequence === 1) {
    if (request.payload.previous_digest !== 'genesis')
      throw new Error('Initial checkpoint must start at genesis.');
  } else {
    const previous = JSON.parse(await readFile(name(sequence - 1), 'utf8'));
    if (
      previous.request.payload.sequence !== sequence - 1 ||
      digest(canonical(previous.request.payload)) !== request.payload.previous_digest
    )
      throw new Error('Checkpoint does not extend the independently archived predecessor.');
  }
  try {
    await writeFile(name(sequence), JSON.stringify({ request, artifact }, null, 2), {
      flag: 'wx',
      mode: 0o600,
      flush: true,
    });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    const prior = JSON.parse(await readFile(name(sequence), 'utf8'));
    if (canonical(prior) !== canonical({ request, artifact }))
      throw new Error('Refusing a checkpoint fork or replacement of the independent archive.');
  }
  const directory = await open(archive, 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
await writeFile(output, JSON.stringify(artifact, null, 2), {
  flag: 'wx',
  mode: 0o600,
  flush: true,
});
console.log(
  'Signature artifact written. Retain the reviewed request and checkpoint root independently.',
);
