// Byte → string decoding with charset detection (many Japanese sites still use Shift_JIS / EUC-JP).

const ALIASES: Record<string, string> = {
  'shift-jis': 'shift_jis',
  shift_jis: 'shift_jis',
  sjis: 'shift_jis',
  'x-sjis': 'shift_jis',
  'windows-31j': 'shift_jis',
  cp932: 'shift_jis',
  ms932: 'shift_jis',
  'ms_kanji': 'shift_jis',
  'euc-jp': 'euc-jp',
  eucjp: 'euc-jp',
  'x-euc-jp': 'euc-jp',
  'iso-2022-jp': 'iso-2022-jp',
  utf8: 'utf-8',
  'utf-8': 'utf-8',
};

export function normalizeCharset(label: string | null | undefined): string | null {
  if (!label) return null;
  const l = label.trim().toLowerCase().replace(/^["']|["']$/g, '');
  return ALIASES[l] ?? l;
}

function latin1(bytes: Uint8Array, max = 4096): string {
  let s = '';
  const n = Math.min(bytes.length, max);
  for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[i]!);
  return s;
}

export function sniffCharset(bytes: Uint8Array, contentType?: string | null): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  const fromHeader = /charset\s*=\s*["']?([\w:.-]+)/i.exec(contentType ?? '');
  if (fromHeader) return normalizeCharset(fromHeader[1]) ?? 'utf-8';
  const head = latin1(bytes);
  const meta =
    /<meta[^>]+charset\s*=\s*["']?([\w:.-]+)/i.exec(head) ??
    /<meta[^>]+content\s*=\s*["'][^"']*charset=([\w:.-]+)/i.exec(head);
  if (meta) return normalizeCharset(meta[1]) ?? 'utf-8';
  return 'utf-8';
}

export function decodeHtml(bytes: Uint8Array, contentType?: string | null): string {
  const charset = sniffCharset(bytes, contentType);
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}
