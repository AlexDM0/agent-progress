/** Whether a domain on a ticket's `network` line is public, so no grant reaches this machine, its local network or the runner's own API. */
import {
  GLOBAL_UNICAST_IPV6_FIRST_GROUP,
  HEXADECIMAL_RADIX,
  IPV4_ADDRESS_BITS,
  IPV4_OCTET_BITS,
  IPV4_OCTET_MAXIMUM,
  LOCAL_NAME_SUFFIXES,
  LOOPBACK_HOST_NAMES,
  NON_PUBLIC_IPV4_BLOCKS
} from '../constants/NetworkDomains.ts';

const DOMAIN_LABEL        = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';
// A wildcard covers the subdomains of a name, and a public name has at least two labels, so `intranet` alone is not one.
const DOMAIN_NAME_PATTERN = new RegExp(`^(?:\\*\\.)?${DOMAIN_LABEL}(?:\\.${DOMAIN_LABEL})+$`);
// An octet with a leading zero reads as octal to some resolvers, so it is no IPv4 literal here and fails as a numeric name below.
const IPV4_PATTERN        = /^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/;
// No top-level domain is a number: a resolver reads such a name, `127.1` or `0x7f.0.0.1`, as an IPv4 address.
const NUMERIC_LAST_LABEL_PATTERN = /\.(?:\d+|0x[0-9a-f]*)$/;
const IPV6_PATTERN        = /^\[?([0-9a-f]*:[0-9a-f:.]*)\]?$/;

/** Lower case, as a host name is compared. */
function normalisedDomainOf(domain: string): string {
  return domain.trim().toLowerCase();
}

function ipv4AddressNumberOf(address: string): number | null {
  const octets = address.split('.').map(Number);
  if (octets.some((octet) => octet > IPV4_OCTET_MAXIMUM)) return null;
  return octets.reduce((addressNumber, octet) => ((addressNumber << IPV4_OCTET_BITS) | octet) >>> 0, 0);
}

function ipv4AddressIsInBlock(addressNumber: number, block: string): boolean {
  const [blockAddress = '', prefixLengthText = ''] = block.split('/');
  const blockNumber = ipv4AddressNumberOf(blockAddress) ?? 0;
  const hostBits    = IPV4_ADDRESS_BITS - Number(prefixLengthText);
  return Math.floor(addressNumber / 2 ** hostBits) === Math.floor(blockNumber / 2 ** hostBits);
}

function ipv4AddressIsPublic(address: string): boolean {
  const addressNumber = ipv4AddressNumberOf(address);
  return addressNumber !== null && !NON_PUBLIC_IPV4_BLOCKS.some((block) => ipv4AddressIsInBlock(addressNumber, block));
}

function ipv6AddressIsPublic(address: string): boolean {
  const [firstGroup = ''] = address.split(':');
  const firstGroupNumber  = Number.parseInt(firstGroup, HEXADECIMAL_RADIX);
  return firstGroup.length > 0 && firstGroupNumber >= GLOBAL_UNICAST_IPV6_FIRST_GROUP.lowest && firstGroupNumber <= GLOBAL_UNICAST_IPV6_FIRST_GROUP.highest;
}

/** A public host name, a public IPv4 literal or a global unicast IPv6 literal; anything else, malformed text included, is not public. */
function domainIsPublic(domain: string): boolean {
  const normalised = normalisedDomainOf(domain);
  if (IPV4_PATTERN.test(normalised)) return ipv4AddressIsPublic(normalised);
  const ipv6Match = IPV6_PATTERN.exec(normalised);
  if (ipv6Match !== null) return ipv6AddressIsPublic(ipv6Match[1] ?? '');
  if (!DOMAIN_NAME_PATTERN.test(normalised) || NUMERIC_LAST_LABEL_PATTERN.test(normalised)) return false;
  const name = normalised.startsWith('*.') ? normalised.slice('*.'.length) : normalised;
  return !(LOOPBACK_HOST_NAMES as readonly string[]).includes(name) && !LOCAL_NAME_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/** The domains as written, normalised and each kept once at its first place. */
function normalisedDomainListOf(domains: readonly string[]): string[] {
  return [...new Set(domains.map(normalisedDomainOf).filter((domain) => domain !== ''))];
}

export const NetworkDomainUtil = { domainIsPublic, normalisedDomainListOf } as const;
