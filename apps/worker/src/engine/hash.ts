import { createHash } from 'node:crypto';
import type { ParseResult } from '@gsb/parser';
import { stripQuery } from '@gsb/parser';
import type { ContentHashes } from '@gsb/shared';

export function sha(s: string, len = 32): string {
  return createHash('sha256').update(s).digest('hex').slice(0, len);
}

export function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(',')}}`;
}

/**
 * snapshotHash = everything; priceHash / importantFieldsHash / normalizedContentHash /
 * imageHash let the evaluator tell *what* changed without re-diffing.
 */
export function computeHashes(parse: ParseResult, price: number | null): ContentHashes {
  const p = sha(String(price ?? 'null'));
  const fields = sha(stableJson({ title: parse.title?.value ?? null, ...parse.fields }));
  const content = sha(parse.normalizedText);
  const image = sha(parse.imageUrl ? stripQuery(parse.imageUrl) : 'null');
  return { price: p, fields, content, image, snapshot: sha([p, fields, content, image].join('|')) };
}
