/**
 * The one Bridge module that touches browser storage. Keys keep the static page's form: `<STORAGE_PREFIX>:theme` for the theme, which
 * every board shares, and `<STORAGE_PREFIX>:<trackerId>:<choice>` for a board's own choices.
 */
import { PRODUCT_NAMES }          from '../../src/shared/constants/ProductNames.ts';
import type { PreferenceStorage } from '../@types/PreferenceStorage.ts';

export interface PreferenceStore {
  readonly readChoice:    (choiceName: string) => string | null;
  /** A choice equal to its default removes the key, so a viewer who never departs from a default leaves nothing behind. */
  readonly writeChoice:   (choiceName: string, choice: string, defaultChoice: string) => void;
  /** A JSON list of texts, as the static page stored one; anything else reads as the empty list. */
  readonly readTextList:  (choiceName: string) => string[];
  /** An empty list removes the key. */
  readonly writeTextList: (choiceName: string, texts: readonly string[]) => void;
}

function textListOf(storedText: string | null): string[] {
  try {
    const value: unknown = JSON.parse(storedText ?? '[]');
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

export const BROWSER_STORAGE_AREAS = Object.freeze({ local: (): PreferenceStorage => window.localStorage });

/** `storageOf` is called inside each read and write, so blocked storage reads as nothing and drops every write, never throwing. */
export function createPreferenceStore(keyPrefix: string, storageOf: () => PreferenceStorage): PreferenceStore {
  const keyOf = (choiceName: string): string => `${keyPrefix}:${choiceName}`;
  const readStoredText = (choiceName: string): string | null => {
    try {
      return storageOf().getItem(keyOf(choiceName));
    } catch {
      return null;
    }
  };
  const writeStoredText = (choiceName: string, text: string | null): void => {
    try {
      if (text === null) storageOf().removeItem(keyOf(choiceName));
      else storageOf().setItem(keyOf(choiceName), text);
    } catch {
      // The Bridge works without persistence.
    }
  };
  return {
    readChoice:    readStoredText,
    writeChoice:   (choiceName, choice, defaultChoice) => writeStoredText(choiceName, choice === defaultChoice ? null : choice),
    readTextList:  (choiceName) => textListOf(readStoredText(choiceName)),
    writeTextList: (choiceName, texts) => writeStoredText(choiceName, texts.length === 0 ? null : JSON.stringify(texts)),
  };
}

/** The store every board shares, which holds the theme. */
export function sharedPreferenceStoreOf(storageOf: () => PreferenceStorage = BROWSER_STORAGE_AREAS.local): PreferenceStore {
  return createPreferenceStore(PRODUCT_NAMES.STORAGE_PREFIX, storageOf);
}

export function boardPreferenceStoreOf(trackerId: string, storageOf: () => PreferenceStorage = BROWSER_STORAGE_AREAS.local): PreferenceStore {
  return createPreferenceStore(`${PRODUCT_NAMES.STORAGE_PREFIX}:${trackerId}`, storageOf);
}
