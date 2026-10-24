/** A draft is a working record a filing session builds tickets from, never a ticket: it has no status, row or move. */
export interface DraftClaim {
  owner:     string;
  claimedAt: string;
}

export interface Draft {
  /** `D1`, `D2`, …: the draft's file name too. */
  id:       string;
  title:    string;
  /** The user's request in their own words, kept byte for byte. */
  request:  string;
  openedAt: string;
  /** Null while nobody holds the draft. */
  claim:    DraftClaim | null;
  /** Every stored key the model does not own, in stored order, so a rewrite does not eat it. */
  extra:    Array<[key: string, value: unknown]>;
}

export interface DraftOpening {
  title:   string;
  request: string;
  owner:   string;
}

/** What `status --json` and the page list for each open draft. */
export interface DraftSummary {
  id:         string;
  title:      string;
  claimOwner: string | null;
  openedAt:   string;
}
