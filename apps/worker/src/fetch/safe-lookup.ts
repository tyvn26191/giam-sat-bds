// DNS lookup that refuses private / internal addresses. Passed to http(s).request as `lookup`,
// so the address that is checked is the address that is connected to (no DNS-rebinding gap).

import dns from 'node:dns';
import type { LookupAddress, LookupAllOptions, LookupOneOptions } from 'node:dns';
import { isPrivateIp } from '@gsb/shared';
import { FetchError } from './errors';

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

export type Resolver = (host: string) => Promise<LookupAddress[]>;

export const systemResolver: Resolver = (host) => dns.promises.lookup(host, { all: true, verbatim: true });

export async function resolvePublic(host: string, resolver: Resolver = systemResolver): Promise<LookupAddress[]> {
  const addrs = await resolver(host);
  if (addrs.length === 0) throw new FetchError('DNS_ERROR', `no address for ${host}`);
  const bad = addrs.find((a) => isPrivateIp(a.address));
  if (bad) throw new FetchError('SSRF_BLOCKED', `${host} resolves to a private address`);
  return addrs;
}

export function createSafeLookup(resolver: Resolver = systemResolver) {
  return function safeLookup(hostname: string, options: LookupOneOptions | LookupAllOptions | number, callback: LookupCallback): void {
    const all = typeof options === 'object' && options !== null && (options as LookupAllOptions).all === true;
    const family = typeof options === 'number' ? options : (options as LookupOneOptions)?.family;
    resolvePublic(hostname, resolver)
      .then((addrs) => {
        const list = family === 4 || family === 6 ? addrs.filter((a) => a.family === family) : addrs;
        if (list.length === 0) {
          callback(Object.assign(new Error(`no IPv${family} address for ${hostname}`), { code: 'ENOTFOUND' }), all ? [] : '', 0);
          return;
        }
        if (all) callback(null, list);
        else callback(null, list[0]!.address, list[0]!.family);
      })
      .catch((err: Error) => {
        const e = err instanceof FetchError ? Object.assign(new Error(err.message), { code: 'ESSRF' }) : err;
        callback(e as NodeJS.ErrnoException, all ? [] : '', 0);
      });
  };
}
