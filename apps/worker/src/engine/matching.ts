// "Possible same property": compare a property's fingerprint with the owner's other properties
// in the same city. Only scores ≥ SAME_PROPERTY_THRESHOLD are kept, never a hard "same".

import { SAME_PROPERTY_THRESHOLD, compareFingerprints, type Fingerprint, type PropertyMatch } from '@gsb/shared';
import type { PropertyRecord, Store } from '../store/types';

export async function findMatches(
  store: Store,
  selfId: string,
  ownerId: string,
  fingerprint: Fingerprint,
): Promise<{ matches: PropertyMatch[]; records: PropertyRecord[] }> {
  if (!fingerprint.cityKey) return { matches: [], records: [] };
  const candidates = await store.queryByCity(ownerId, fingerprint.cityKey);
  const scored: { match: PropertyMatch; rec: PropertyRecord }[] = [];
  for (const c of candidates) {
    if (c.id === selfId || !c.data.fingerprint) continue;
    const r = compareFingerprints(fingerprint.parts, c.data.fingerprint.parts);
    if (r.confidence < SAME_PROPERTY_THRESHOLD) continue;
    scored.push({
      rec: c,
      match: {
        propertyId: c.id,
        confidence: r.confidence,
        url: c.data.url,
        title: c.data.name || c.data.title,
        status: c.data.status,
        price: c.data.price,
        reasons: r.reasons.slice(0, 6),
      },
    });
  }
  scored.sort((a, b) => b.match.confidence - a.match.confidence);
  const top = scored.slice(0, 5);
  return { matches: top.map((s) => s.match), records: top.map((s) => s.rec) };
}

/** Add/refresh `self` in another property's match list (best effort, outside the check batch). */
export function mergeMatch(list: PropertyMatch[], m: PropertyMatch): PropertyMatch[] {
  return [m, ...list.filter((x) => x.propertyId !== m.propertyId)].sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}
