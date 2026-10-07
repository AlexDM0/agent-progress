/** A link to a work item as a page draws it: the text shown, where it leads and the hook attribute a controller follows it by, if any. */
export interface WorkItemLink {
  text:          string;
  href:          string;
  hookAttribute: { name: string; value: string } | null;
}
