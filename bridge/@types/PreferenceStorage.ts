/** The part of a browser storage area the preference store uses, so a spec can hand it an in-memory one. */
export type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
