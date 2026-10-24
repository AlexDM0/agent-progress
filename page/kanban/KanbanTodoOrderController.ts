/** The filter menu's "Order To do" switch for the Kanban: filed or by wave, kept per viewer; hidden, and filed, on a board without dependencies. */

import type { TodoOrderChoice, ViewerPreferences } from '../@types/ViewerChoices.ts';
import { DomUtil }                                 from '../utils/DomUtil.ts';

const TODO_ORDER_ELEMENT_ID = 'ap-kanban-order';

const TODO_ORDER_CHOICES: readonly TodoOrderChoice[] = ['filed', 'by-wave'];

interface KanbanTodoOrderSources {
  preferences:          ViewerPreferences;
  boardHasDependencies: boolean;
  /** Called after the switch changed the order, so the board is laid out again. */
  applyOrder:           () => void;
}

export interface KanbanTodoOrderController {
  wire(): void;
  readOrder(): TodoOrderChoice;
  /** Back to filed, stored, without laying the board out again. */
  reset(): void;
}

export function createKanbanTodoOrderController(sources: KanbanTodoOrderSources): KanbanTodoOrderController {
  const { preferences, boardHasDependencies } = sources;
  let order = preferences.readTodoOrder();

  const render = (): void => {
    for (const button of document.querySelectorAll<HTMLElement>(`#${TODO_ORDER_ELEMENT_ID} [data-todo-order]`)) {
      button.setAttribute('aria-pressed', String(button.dataset['todoOrder'] === order));
    }
  };

  return {
    wire: () => {
      DomUtil.setHidden(TODO_ORDER_ELEMENT_ID, !boardHasDependencies);
      render();
      document.getElementById(TODO_ORDER_ELEMENT_ID)?.addEventListener('click', (event) => {
        const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-todo-order]') : null;
        const chosen = TODO_ORDER_CHOICES.find((choice) => choice === button?.dataset['todoOrder']);
        if (chosen === undefined || chosen === order) {
          return;
        }
        order = chosen;
        preferences.writeTodoOrder(chosen);
        render();
        sources.applyOrder();
      });
    },
    readOrder: () => (boardHasDependencies ? order : 'filed'),
    reset:     () => {
      if (order === 'filed') {
        return;
      }
      order = 'filed';
      preferences.writeTodoOrder(order);
      render();
    },
  };
}
