/**
 * The one Bridge module that touches browser storage. Keys keep the static page's form: `<STORAGE_PREFIX>:theme` for the theme, which
 * every board shares, and `<STORAGE_PREFIX>:<trackerId>:<choice>` for a board's own choices.
 */
import { PRODUCT_NAMES }          from '../../src/shared/constants/ProductNames.ts';
import type { PreferenceStorage } from '../@types/PreferenceStorage.ts';

export interface PreferenceStore {
  readonly readChoice:  (choiceName: string) => string | null;
  /** A choice equal to its default removes the key, so a viewer who never departs from a default leaves nothing behind. */
  readonly writeChoice: (choiceName: string, choice: string, defaultChoice: string) => void;
}

export const BROWSER_STORAGE_AREAS = Object.freeze({ local: (): PreferenceStorage => window.localStorage });

/** `storageOf` is called inside each read and write, so blocked storage reads as nothing and drops every write, never throwing. */
export function createPreferenceStore(keyPrefix: string, storageOf: () => PreferenceStorage): PreferenceStore {
  const keyOf = (choiceName: string): string => `${keyPrefix}:${choiceName}`;
  return {
    readChoice: (choiceName) => {
      try {
        return storageOf().getItem(keyOf(choiceName));
      } catch {
        return null;
      }
    },
    writeChoice: (choiceName, choice, defaultChoice) => {
      try {
        if (choice === defaultChoice) storageOf().removeItem(keyOf(choiceName));
        else storageOf().setItem(keyOf(choiceName), choice);
      } catch {
        // The Bridge works without persistence.
      }
    },
  };
}

/** The store every board shares, which holds the theme. */
export function sharedPreferenceStoreOf(storageOf: () => PreferenceStorage = BROWSER_STORAGE_AREAS.local): PreferenceStore {
  return createPreferenceStore(PRODUCT_NAMES.STORAGE_PREFIX, storageOf);
}

export function boardPreferenceStoreOf(trackerId: string, storageOf: () => PreferenceStorage = BROWSER_STORAGE_AREAS.local): PreferenceStore {
  return createPreferenceStore(`${PRODUCT_NAMES.STORAGE_PREFIX}:${trackerId}`, storageOf);
}
