/**
 * A `network` line is a grant to an agent's sandbox, so the judgement fails closed: only a public name, a public IPv4 literal or a global
 * unicast IPv6 literal passes. Each refused form is planted: loopback names, `.local` names, IPv4 and IPv6 literals in loopback or private
 * ranges, single labels and malformed text. The block edges are planted too, since an off-by-one in a CIDR test would grant a private Watcher.
 */
import { expect, test } from 'bun:test';

import { NetworkDomainUtil } from './NetworkDomainUtil.ts';

const { domainIsPublic, normalisedDomainListOf } = NetworkDomainUtil;

test.each([
  'api.example.com',
  '*.example.com',
  'registry.npmjs.org',
  'API.Example.COM',
  '8.8.8.8',
  '172.15.255.255',
  '172.32.0.0',
  '100.128.0.1',
  '2001:db8::1',
  '[2606:4700::1111]',
])('%s is public', (domain) => {
  expect(domainIsPublic(domain)).toBe(true);
});

test.each([
  ['a loopback name', 'localhost'],
  ['a loopback name in capitals', 'LOCALHOST'],
  ['the loopback domain name', 'localhost.localdomain'],
  ['a name under localhost', 'api.localhost'],
  ['a .local name', 'printer.local'],
  ['a wildcard .local name', '*.local'],
  ['a wildcard under a .local name', '*.office.local'],
  ['an IPv4 loopback literal', '127.0.0.1'],
  ['the top of the IPv4 loopback block', '127.255.255.255'],
  ['the unspecified IPv4 address', '0.0.0.0'],
  ['a 10/8 private literal', '10.1.2.3'],
  ['the first 172.16/12 private literal', '172.16.0.0'],
  ['the last 172.16/12 private literal', '172.31.255.255'],
  ['a 192.168/16 private literal', '192.168.1.10'],
  ['a link-local literal', '169.254.169.254'],
  ['a shared address space literal', '100.64.0.1'],
  ['the IPv6 loopback literal', '::1'],
  ['the bracketed IPv6 loopback literal', '[::1]'],
  ['an IPv6 unique local literal', 'fd00::1'],
  ['an IPv6 link-local literal', 'fe80::1'],
  ['an IPv4-mapped IPv6 loopback literal', '::ffff:127.0.0.1'],
  ['a shortened IPv4 loopback literal', '127.1'],
  ['a shortened IPv4 private literal', '192.168.1'],
  ['a hexadecimal IPv4 loopback literal', '0x7f.0.0.1'],
  ['an octal IPv4 loopback literal', '0177.0.0.1'],
  ['a name whose last label is a number', 'example.123'],
  ['a single label', 'intranet'],
  ['an IPv4 literal with an octet past 255', '300.1.1.1'],
  ['a URL rather than a domain', 'https://example.com'],
  ['a name with a port', 'example.com:8080'],
  ['empty text', ''],
])('%s is not public: %s', (_form, domain) => {
  expect(domainIsPublic(domain)).toBe(false);
});

test('a list is lower-cased, trimmed and kept once per domain at its first place, empty parts dropped', () => {
  expect(normalisedDomainListOf(['API.example.com', ' cdn.example.com ', '', 'api.example.com'])).toEqual(['api.example.com', 'cdn.example.com']);
});
