/** A table's search field on either page: typing hands the text on once the typing pauses, and a changed view writes its text back. */

const TICKET_SEARCH_DEBOUNCE_MILLISECONDS = 150;

export interface SearchInputController {
  wire(searchFor: (searchText: string) => void): void;
  /** Writes the view's text into the field when it differs, so a cleared or restored view shows in it. */
  reflect(searchText: string): void;
  focus(): void;
}

export function createSearchInputController(inputElementId: string): SearchInputController {
  let pendingSearch: ReturnType<typeof setTimeout> | null = null;

  const searchInput = (): HTMLInputElement | null => {
    const input = document.getElementById(inputElementId);
    return input instanceof HTMLInputElement ? input : null;
  };

  return {
    wire: (searchFor) => {
      searchInput()?.addEventListener('input', (event) => {
        const input = event.currentTarget;
        if (pendingSearch !== null) {
          clearTimeout(pendingSearch);
        }
        pendingSearch = setTimeout(() => {
          pendingSearch = null;
          if (input instanceof HTMLInputElement) {
            searchFor(input.value);
          }
        }, TICKET_SEARCH_DEBOUNCE_MILLISECONDS);
      });
    },
    reflect: (searchText) => {
      const input = searchInput();
      if (input !== null && input.value !== searchText) {
        input.value = searchText;
      }
    },
    focus: () => searchInput()?.focus(),
  };
}
