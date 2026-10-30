import { createHash, createPublicKey, verify } from 'node:crypto';
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const signingBytes = (payload: unknown) =>
  Buffer.from('PIXUP-TRUST-V1\n' + canonical(payload));
export type Head = { asset_id: string; sequence: number; hash: string };
export function merkle(entries: Head[], index?: number) {
  let level = entries.map((e) => digest('leaf:' + canonical(e)));
  const proof: { side: 'left' | 'right'; hash: string }[] = [];
  let position = index;
  if (!level.length) return { root: digest('empty'), proof };
  while (level.length > 1) {
    if (position !== undefined) {
      const sibling = position % 2 ? position - 1 : Math.min(position + 1, level.length - 1);
      proof.push({ side: position % 2 ? 'left' : 'right', hash: level[sibling] });
      position = Math.floor(position / 2);
    }
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2)
      next.push(digest('node:' + level[i] + level[i + 1 < level.length ? i + 1 : i]));
    level = next;
  }
  return { root: level[0], proof };
}
export function verifyProof(
  head: Head,
  proof: { side: 'left' | 'right'; hash: string }[],
  root: string,
) {
  let hash = digest('leaf:' + canonical(head));
  for (const p of proof)
    hash = digest('node:' + (p.side === 'left' ? p.hash + hash : hash + p.hash));
  return hash === root;
}
export type TrustKey = {
  id: string;
  purpose: 'certificate' | 'checkpoint';
  public_key: string;
  not_before: string;
  not_after: string;
  revoked: boolean;
};
export function signatureValid(
  payload: Record<string, any>,
  signature: string,
  key: TrustKey | undefined,
) {
  if (
    !key ||
    key.revoked ||
    key.purpose !== payload.kind ||
    Date.parse(payload.issued_at) < Date.parse(key.not_before) ||
    Date.parse(payload.issued_at) > Date.parse(key.not_after)
  )
    return false;
  try {
    const publicKey = createPublicKey(key.public_key);
    return (
      publicKey.asymmetricKeyType === 'ed25519' &&
      verify(null, signingBytes(payload), publicKey, Buffer.from(signature, 'base64'))
    );
  } catch {
    return false;
  }
}
