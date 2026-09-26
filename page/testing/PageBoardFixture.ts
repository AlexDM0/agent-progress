/**
 * The page's rows and tickets with the Board facts built the way the render service builds them, so a page spec never restates a board
 * rule. Test-only: nothing that ships may import `page/testing/`.
 */
import { ReviewBarNameUtil } from '../../src/adapters/legacy/utils/ReviewBarNameUtil.ts';
import type { Task }         from '../../src/lib/tracker-model/@types/Task.ts';
import type { Ticket }       from '../../src/lib/tracker-model/@types/Ticket.ts';
import { BoardFactsUtil }    from '../../src/services/render/utils/BoardFactsUtil.ts';
import type { PageTicket }   from '../../src/shared/@types/PagePayload.ts';
import { boardFixture }      from '../../src/testing/BoardFixtures.ts';
import type { PageBoard }    from '../@types/PageBoard.ts';
import { IslandUtil }        from '../utils/IslandUtil.ts';

function modelTicketOf(ticket: PageTicket): Ticket {
  const { filePath, bodyHtml, ...frontmatter } = ticket;
  return { frontmatter, body: '', filePath };
}

/** The tasks are linked as ingestion links a legacy review bar, before the Board answers anything about them. */
export function pageBoardFixture(contents: { tasks: readonly Task[]; tickets?: readonly PageTicket[] }): PageBoard {
  const tickets     = contents.tickets ?? [];
  const linkedTasks = contents.tasks.map((task) => ReviewBarNameUtil.linkedReviewBarOf(task));
  const { board }   = boardFixture({ tasks: linkedTasks, tickets: tickets.map(modelTicketOf) });
  return IslandUtil.pageBoardFrom(linkedTasks, BoardFactsUtil.boardFactsOf(board), tickets);
}
