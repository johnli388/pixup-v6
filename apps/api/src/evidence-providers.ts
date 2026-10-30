import { createHash, createHmac } from 'node:crypto';
import { connect } from 'node:net';
import { check, DomainError } from '../../../packages/domain/core';

export const digest = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
export interface ObjectStore {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
export interface Scanner {
  scan(bytes: Buffer): Promise<{ clean: boolean; engine: string }>;
}
export type EvidenceOptions = {
  store?: ObjectStore;
  scanner?: Scanner;
  managedArtwork?: boolean;
  requireCapture?: boolean;
};

// Bounded single-object requests; credentials and URLs never reach browsers.
export class S3Store implements ObjectStore {
  constructor(
    private config: {
      endpoint: string;
      bucket: string;
      region: string;
      accessKey: string;
      secretKey: string;
      sessionToken?: string;
    },
    private transport: typeof fetch = fetch,
  ) {
    const u = new URL(config.endpoint);
    check(
      u.protocol === 'https:' &&
        u.pathname === '/' &&
        !u.search &&
        !u.hash &&
        !u.username &&
        !u.password,
      'STORAGE_CONFIG',
      'Use an HTTPS S3 endpoint origin.',
      500,
    );
    check(
      /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket) &&
        /^[a-z0-9-]+$/.test(config.region),
      'STORAGE_CONFIG',
      'Invalid S3 bucket or region.',
      500,
    );
  }
  private async request(method: string, key: string, body?: Buffer) {
    check(
      /^pixup\/[a-f0-9-]{36}\/(original|preview)$/.test(key),
      'STORAGE_KEY',
      'Invalid object key.',
      500,
    );
    const url = new URL(`/${this.config.bucket}/${key}`, this.config.endpoint);
    const time = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''),
      day = time.slice(0, 8),
      hash = digest(body || Buffer.alloc(0));
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-date': time,
      'x-amz-content-sha256': hash,
    };
    if (this.config.sessionToken) headers['x-amz-security-token'] = this.config.sessionToken;
    if (method === 'PUT') {
      headers['if-none-match'] = '*';
      headers['x-amz-server-side-encryption'] = 'AES256';
    }
    const names = Object.keys(headers).sort(),
      signed = names.join(';');
    const canonical = [
      method,
      url.pathname,
      '',
      names.map((n) => `${n}:${headers[n]}\n`).join(''),
      signed,
      hash,
    ].join('\n');
    const scope = `${day}/${this.config.region}/s3/aws4_request`;
    const mac = (key: Buffer | string, value: string) =>
      createHmac('sha256', key).update(value).digest();
    const signing = mac(
      mac(mac(mac(`AWS4${this.config.secretKey}`, day), this.config.region), 's3'),
      'aws4_request',
    );
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.config.accessKey}/${scope}, SignedHeaders=${signed}, Signature=${mac(signing, `AWS4-HMAC-SHA256\n${time}\n${scope}\n${digest(canonical)}`).toString('hex')}`;
    try {
      return await this.transport(url, {
        method,
        headers,
        body: body as any,
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new DomainError(
        503,
        'STORAGE_UNAVAILABLE',
        'Private object storage is unavailable; retry the same upload.',
      );
    }
  }
  async put(key: string, bytes: Buffer) {
    const r = await this.request('PUT', key, bytes);
    if (r.status === 412) {
      check(
        digest(await this.get(key)) === digest(bytes),
        'STORAGE_CONFLICT',
        'The stored object has different contents.',
        409,
      );
      return;
    }
    check(r.ok, 'STORAGE_UNAVAILABLE', 'Private object storage rejected the upload.', 503);
  }
  async get(key: string) {
    const r = await this.request('GET', key);
    check(r.ok && r.body, 'STORAGE_UNAVAILABLE', 'Private object could not be retrieved.', 503);
    const chunks: Buffer[] = [];
    let size = 0;
    const reader = r.body.getReader();
    try {
      while (true) {
        const v = await reader.read();
        if (v.done) break;
        size += v.value.length;
        check(size <= 10485760, 'STORAGE_SIZE', 'Stored object exceeds its limit.', 503);
        chunks.push(Buffer.from(v.value));
      }
    } finally {
      await reader.cancel();
    }
    return Buffer.concat(chunks);
  }
  async delete(key: string) {
    const r = await this.request('DELETE', key);
    check(
      r.ok || r.status === 404,
      'STORAGE_UNAVAILABLE',
      'Object deletion could not be confirmed.',
      503,
    );
  }
}
// clamd has no transport authentication. Use a private local Unix socket only.
export class ClamScanner implements Scanner {
  constructor(private socketPath: string) {}
  scan(bytes: Buffer): Promise<{ clean: boolean; engine: string }> {
    return new Promise((resolve, reject) => {
      const socket = connect(this.socketPath);
      let response = '';
      let done = false;
      const finish = (error?: Error, clean = false) => {
        if (done) return;
        done = true;
        socket.destroy();
        error ? reject(error) : resolve({ clean, engine: 'clamd/INSTREAM' });
      };
      const failure = () =>
        finish(
          new DomainError(
            503,
            'SCANNER_UNAVAILABLE',
            'Malware scanning is unavailable; this upload remains quarantined.',
          ),
        );
      socket.setTimeout(15000, failure);
      socket.on('error', failure);
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        for (let offset = 0; offset < bytes.length; offset += 65536) {
          const b = bytes.subarray(offset, offset + 65536),
            n = Buffer.alloc(4);
          n.writeUInt32BE(b.length);
          socket.write(n);
          socket.write(b);
        }
        socket.write(Buffer.alloc(4));
      });
      socket.on('data', (chunk) => {
        response += chunk.toString('utf8');
        if (response.length > 4096) return failure();
        if (!response.includes('\0')) return;
        const line = response.slice(0, response.indexOf('\0'));
        if (line === 'stream: OK') finish(undefined, true);
        else if (/^stream: .+ FOUND$/.test(line)) finish(undefined, false);
        else failure();
      });
      socket.on('end', () => {
        if (!done) failure();
      });
    });
  }
}
export function evidenceConfiguration(env: NodeJS.ProcessEnv = process.env): EvidenceOptions {
  const provider = env.EVIDENCE_STORAGE || 'database';
  check(
    ['database', 's3'].includes(provider),
    'STORAGE_CONFIG',
    'Unsupported evidence storage provider.',
    500,
  );
  const scanner = env.CLAMAV_SOCKET ? new ClamScanner(env.CLAMAV_SOCKET) : undefined;
  let store: ObjectStore | undefined;
  if (provider === 's3') {
    for (const key of [
      'S3_ENDPOINT',
      'S3_BUCKET',
      'S3_REGION',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
    ])
      check(env[key], 'STORAGE_CONFIG', `Configure ${key} for private storage.`, 500);
    check(scanner, 'STORAGE_CONFIG', 'S3 mode requires the configured malware scanner.', 500);
    store = new S3Store({
      endpoint: env.S3_ENDPOINT!,
      bucket: env.S3_BUCKET!,
      region: env.S3_REGION!,
      accessKey: env.S3_ACCESS_KEY_ID!,
      secretKey: env.S3_SECRET_ACCESS_KEY!,
      sessionToken: env.S3_SESSION_TOKEN,
    });
  }
  return {
    store,
    scanner,
    managedArtwork: provider === 's3' || env.MANAGED_ARTWORK === 'true',
    requireCapture: env.PHYSICAL_CAPTURE_REQUIRED === 'true',
  };
}
