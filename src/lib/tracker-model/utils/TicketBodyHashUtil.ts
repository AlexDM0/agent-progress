/**
 * The content hash a claim records of a ticket's body, so whether the builder saw the latest body is a hash comparison, never a clock. The
 * hash is 64-bit FNV-1a over the body's UTF-8 bytes, computed in plain script because the page compiles this model.
 */
import type { Ticket } from '../@types/Ticket.ts';

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME        = 0x100000001b3n;
const HASH_WIDTH_BITS  = 64;
const HASH_HEX_DIGITS  = 16;

function bodyHashOf(body: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of new TextEncoder().encode(body)) {
    hash = BigInt.asUintN(HASH_WIDTH_BITS, (hash ^ BigInt(byte)) * FNV_PRIME);
  }
  return hash.toString(16).padStart(HASH_HEX_DIGITS, '0');
}

/** Undefined for a ticket never claimed or started, which has no hash to compare with. */
function bodyChangedSinceClaimOf(ticket: Readonly<Ticket>): boolean | undefined {
  const { claimedBodyHash } = ticket.frontmatter;
  return claimedBodyHash === undefined ? undefined : bodyHashOf(ticket.body) !== claimedBodyHash;
}

export const TicketBodyHashUtil = { bodyChangedSinceClaimOf, bodyHashOf } as const;
