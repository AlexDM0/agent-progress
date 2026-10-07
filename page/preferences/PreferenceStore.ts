/** The one module where a page script touches browser storage: text, choices and lists kept under one key prefix. */
import type { PreferenceStorage } from '../@types/ViewerChoices.ts';
import { JsonValueUtil }          from '../utils/JsonValueUtil.ts';

export interface PreferenceStore {
  /** The text stored under the bare prefix, or `null` when there is none or storage is blocked. */
  readonly readText:      () => string | null;
  /** `null` removes the bare prefix's key. */
  readonly writeText:     (text: string | null) => void;
  readonly readChoice:    (choiceName: string) => string | null;
  /** A choice equal to its default removes the key, so a viewer who never departs from a default leaves nothing behind. */
  readonly writeChoice:   (choiceName: string, choice: string, defaultChoice: string) => void;
  readonly readTextList:  (choiceName: string) => string[];
  /** An empty list removes the key. */
  readonly writeTextList: (choiceName: string, texts: readonly string[]) => void;
}

/** The browser's storage areas; each is a function, because merely reaching one throws where storage is blocked. */
export const BROWSER_STORAGE_AREAS = Object.freeze({
  local:   (): PreferenceStorage => window.localStorage,
  session: (): PreferenceStorage => window.sessionStorage,
});

/** `storageOf` is called inside each read and write, so blocked storage reads as nothing and drops every write, never throwing. */
export function createPreferenceStore(keyPrefix: string, storageOf: () => PreferenceStorage): PreferenceStore {
  const choiceKeyOf = (choiceName: string): string => `${keyPrefix}:${choiceName}`;

  const readStoredText = (storageKey: string): string | null => {
    try {
      return storageOf().getItem(storageKey);
    } catch {
      return null;
    }
  };

  const writeStoredText = (storageKey: string, text: string | null): void => {
    try {
      if (text === null) {
        storageOf().removeItem(storageKey);
        return;
      }
      storageOf().setItem(storageKey, text);
    } catch {
      // The page works without persistence.
    }
  };

  return {
    readText:     () => readStoredText(keyPrefix),
    writeText:    (text) => writeStoredText(keyPrefix, text),
    readChoice:   (choiceName) => readStoredText(choiceKeyOf(choiceName)),
    writeChoice:  (choiceName, choice, defaultChoice) => writeStoredText(choiceKeyOf(choiceName), choice === defaultChoice ? null : choice),
    readTextList: (choiceName) => {
      try {
        return JsonValueUtil.textListOf(JSON.parse(readStoredText(choiceKeyOf(choiceName)) ?? '[]'));
      } catch {
        return [];
      }
    },
    writeTextList: (choiceName, texts) => writeStoredText(choiceKeyOf(choiceName), texts.length === 0 ? null : JSON.stringify(texts)),
  };
}
