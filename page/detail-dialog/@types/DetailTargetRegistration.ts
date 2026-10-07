/** How one kind of detail target is found on its page and what it fills the detail panel with. */
export interface DetailTargetRegistration {
  /** What a click or a key on the page opens it from; null for a kind only a link opener opens. */
  readonly openerSelector: string | null;
  idOf(opener: HTMLElement): string;
  /** Takes the id already CSS-escaped; the selection mark and the focus return land on what it finds. */
  selectorFor(escapedId: string): string;
  /** An empty string means there is nothing to open. */
  markupOf(id: string): string;
  afterShown?(): void;
}

/** A link anywhere on the page, the panel included, that opens a target of its kind. */
export interface DetailLinkOpener<Kind extends string> {
  readonly kind:     Kind;
  readonly selector: string;
  idOf(link: HTMLElement): string;
}
