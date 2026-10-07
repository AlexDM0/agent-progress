/** One row of filter chips on either page: it shows which chips are pressed and each chip's count, and hands a clicked chip's value on. */

export interface ChipGroupSettings {
  containerId:   string;
  /** The attribute each chip carries its value on. */
  attributeName: string;
}

export interface ChipGroupController {
  /** A chip of no count is marked empty. */
  reflect(pressedValues: readonly string[], countByValue: ReadonlyMap<string, number>): void;
  wire(toggleValue: (value: string) => void): void;
}

export function createChipGroupController(settings: ChipGroupSettings): ChipGroupController {
  const { containerId, attributeName } = settings;

  return {
    reflect: (pressedValues, countByValue) => {
      for (const button of document.getElementById(containerId)?.querySelectorAll<HTMLElement>(`[${attributeName}]`) ?? []) {
        const value = button.getAttribute(attributeName) ?? '';
        const count = countByValue.get(value) ?? 0;
        button.setAttribute('aria-pressed', String(pressedValues.includes(value)));
        button.toggleAttribute('data-empty', count === 0);
        const countElement = button.querySelector('.ap-chip-count');
        if (countElement !== null) {
          countElement.textContent = String(count);
        }
      }
    },
    wire: (toggleValue) => {
      document.getElementById(containerId)?.addEventListener('click', (event) => {
        const button = event.target instanceof Element ? event.target.closest(`[${attributeName}]`) : null;
        if (button instanceof HTMLElement) {
          toggleValue(button.getAttribute(attributeName) ?? '');
        }
      });
    },
  };
}
