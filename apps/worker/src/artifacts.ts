// Optional Cloud Storage for screenshots / HTML of important changes (never on every check).

import { gzipSync } from 'node:zlib';

export interface ArtifactStore {
  put(path: string, data: Buffer, contentType: string, contentEncoding?: string): Promise<string>;
  signedUrl(path: string, ttlMs: number): Promise<string>;
}

interface BucketLike {
  file(path: string): {
    save(data: Buffer, opts: { contentType: string; metadata?: Record<string, unknown>; resumable: boolean }): Promise<unknown>;
    getSignedUrl(opts: { version: 'v4'; action: 'read'; expires: number }): Promise<[string]>;
  };
}

export class GcsArtifactStore implements ArtifactStore {
  constructor(private readonly bucket: BucketLike) {}

  async put(path: string, data: Buffer, contentType: string, contentEncoding?: string): Promise<string> {
    await this.bucket.file(path).save(data, {
      contentType,
      resumable: false,
      metadata: contentEncoding ? { contentEncoding, cacheControl: 'private, max-age=0' } : { cacheControl: 'private, max-age=0' },
    });
    return path;
  }

  async signedUrl(path: string, ttlMs: number): Promise<string> {
    const [url] = await this.bucket.file(path).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + ttlMs });
    return url;
  }
}

export function gzipHtml(html: string): Buffer {
  return gzipSync(Buffer.from(html, 'utf8'));
}
