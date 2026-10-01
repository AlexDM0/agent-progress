/**
 * The page's rows and tickets with the Board facts built the way the render service builds them, so a page spec never restates a board
 * rule. Test-only: nothing that ships may import `page/testing/`.
 */
import type { Epic, EpicFrontmatter } from '../../src/lib/tracker-model/@types/Epic.ts';
import type { Task }                  from '../../src/lib/tracker-model/@types/Task.ts';
import type { Ticket }                from '../../src/lib/tracker-model/@types/Ticket.ts';
import { boardFactsOf }               from '../../src/services/render/BoardFacts.ts';
import type { PageTicket }            from '../../src/shared/@types/PagePayload.ts';
import { boardFixture }               from '../../src/testing/BoardFixtures.ts';
import type { PageBoard }             from '../@types/PageBoard.ts';
import { IslandUtil }                 from '../utils/IslandUtil.ts';

function modelTicketOf(ticket: PageTicket): Ticket {
  const { filePath, bodyHtml, ...frontmatter } = ticket;
  return { frontmatter, body: '', filePath };
}

/** The tasks arrive as the current format stores them, a review bar already linked by its `reviewOf` and `reviewBarRound`. */
export function pageBoardFixture(contents: { tasks: readonly Task[]; tickets?: readonly PageTicket[]; epics?: readonly EpicFrontmatter[] }): PageBoard {
  const tickets   = contents.tickets ?? [];
  const tasks     = [...contents.tasks];
  const epics     = (contents.epics ?? []).map((frontmatter): Epic => ({ frontmatter, body: '', filePath: `/example/.agent-progress/epics/${frontmatter.key}.md` }));
  const { board } = boardFixture({ tasks, tickets: tickets.map(modelTicketOf), epics });
  const epicDescriptions = epics.map((epic) => ({ key: epic.frontmatter.key, descriptionHtml: `<p>The ${epic.frontmatter.title} epic.</p>` }));
  return IslandUtil.pageBoardFrom(tasks, boardFactsOf(board), tickets, epicDescriptions);
}
