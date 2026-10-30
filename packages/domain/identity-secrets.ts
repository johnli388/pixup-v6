import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHmac,
  timingSafeEqual,
} from 'node:crypto';
import { check } from './core';
export class SecretBox {
  private key: Buffer;
  constructor(encoded: string) {
    check(
      /^[a-f0-9]{64}$/i.test(encoded),
      'IDENTITY_KEY_REQUIRED',
      'Configure a persistent 32-byte hex identity encryption key.',
      503,
    );
    this.key = Buffer.from(encoded, 'hex');
  }
  seal(value: string) {
    const nonce = randomBytes(12),
      c = createCipheriv('aes-256-gcm', this.key, nonce);
    c.setAAD(Buffer.from('pixup-identity-v1'));
    return Buffer.concat([nonce, c.update(value, 'utf8'), c.final(), c.getAuthTag()]).toString(
      'base64',
    );
  }
  open(value: string) {
    const b = Buffer.from(value, 'base64'),
      d = createDecipheriv('aes-256-gcm', this.key, b.subarray(0, 12));
    d.setAAD(Buffer.from('pixup-identity-v1'));
    d.setAuthTag(b.subarray(-16));
    return Buffer.concat([d.update(b.subarray(12, -16)), d.final()]).toString('utf8');
  }
}
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes: Buffer) {
  let bits = 0,
    value = 0,
    out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
function decode32(secret: string) {
  let bits = 0,
    value = 0;
  const out: number[] = [];
  for (const c of secret) {
    value = (value << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
export function totp(secret: string, step = Math.floor(Date.now() / 30000)) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', decode32(secret)).update(counter).digest(),
    offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
export function matchTotp(secret: string, code: string, lastStep: number) {
  if (!/^\d{6}$/.test(code)) return null;
  const now = Math.floor(Date.now() / 30000);
  for (const step of [now - 1, now, now + 1])
    if (step > lastStep && timingSafeEqual(Buffer.from(totp(secret, step)), Buffer.from(code)))
      return step;
  return null;
}
