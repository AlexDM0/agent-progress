/** What a ticket's `network` line may never grant: loopback and local names, and the IPv4 ranges that reach this machine or its network. */

export const LOOPBACK_HOST_NAMES = ['localhost', 'localhost.localdomain'] as const;

/** A name ending in one of these resolves on this machine or its local network. */
export const LOCAL_NAME_SUFFIXES = ['.localhost', '.local'] as const;

/** This network, private, carrier-grade shared, loopback and link-local, as CIDR blocks. */
export const NON_PUBLIC_IPV4_BLOCKS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.168.0.0/16',
] as const;

export const IPV4_OCTET_BITS = 8;

export const IPV4_ADDRESS_BITS = 32;

export const IPV4_OCTET_MAXIMUM = 255;

/** Global unicast IPv6, 2000::/3: the only IPv6 literals granted, so loopback, private, link-local and mapped addresses all fail closed. */
export const GLOBAL_UNICAST_IPV6_FIRST_GROUP = { lowest: 0x2000, highest: 0x3fff } as const;

export const HEXADECIMAL_RADIX = 16;
