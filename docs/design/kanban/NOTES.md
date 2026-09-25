# Kanban tab — the approved design

`docs/design/kanban/kanban-mockup.html` is the design the user approved on 2026-09-25 for the page's
Kanban tab and its ticket dialog. It is a copy of `lib/render/page/template.html` with the tab, one
`/* Kanban */` CSS block, a static board rendered from a synthetic "Example Storefront" board and a
mockup script. Open it in a browser. The hash selects a state: `theme=light|dark`, `open=<ticket id>`,
`done=<n>`, `visibility=recent|all` and `abandoned=open|closed`, joined with `&`, e.g.
`kanban-mockup.html#theme=dark&open=059`. The mockup script is a demonstration and not the
implementation: what the page emits is decided by pure markup functions, held to the markup contract
below. This folder is deleted by the last Kanban ticket, once `lib/render/page/template.html` carries
the design.

## Decisions

1. **Tabs run Progress · Kanban · Tickets.** Progress stays the tab a fresh viewer lands on. The mockup
   opens on Kanban only to show it.
2. **Six lanes**, left to right: To do (`unstarted`), In progress (`wip`, `paused`), Review
   (`awaiting review`, `reviewing`, `reviewing N`), Awaiting merge, Done (`done`, meaning merged),
   and Abandoned. A card's lane is the pill its ticket's own row shows on the Progress tab. A ticket
   with no row reads its status's pill.
3. **Lanes are `.ap-card`s that grow with their cards**, stretched to the tallest lane, with no inner
   scroll. Below about 1250px the board scrolls sideways, and `#ap-kanban-frame` fades whichever edge
   can still scroll (`data-overflow="start end"`).
4. **Priority is order, dividers and marks.** The four open lanes sort high → normal → low, then by id.
   `HIGH 1 / NORMAL 3 / LOW 2` dividers split a lane that holds more than one priority. Every card
   carries the template's own marks next to its id: amber `high` and bordered `low`, as on the Tickets
   tab. Normal is unmarked. Done and Abandoned sort by their closing stamp, newest first.
5. **Held is neutral**: a dashed `--line-strong` chip on `--surface-2`, with the reason on hover.
   `waiting on #N` keeps the amber chip, on its own row under the title.
6. **The card edge is the row's bar** (3px, in the state's fill). A ticket with no row has no edge and
   says **"no row yet"**.
7. **Work versus waiting is a shape rule, so it holds in grayscale.** In In progress and Review, an
   agent at work is a solid, filled card. A ticket waiting for one (paused, awaiting review) is a
   dashed, unfilled card. The sub-count dots in a lane head are filled for work and hollow for waiting.
8. **Each sub-state is also written on the card**, in its state colour: `paused since 11:45 · 1h 51m`,
   `no reviewer yet · 16m`, `reviewer since 13:05`, `round 2 reviewer since 11:34`, `reviewed 12:10`
   on an Awaiting merge card, and the reason on an Abandoned card.
9. **The pill shows only in the lanes that mix states** (In progress, Review). The dialog always shows it.
10. **A stamp shows its date only when it is not from today**, everywhere on the page: `started 11:00`
    today, `delivered 09-24 23:48` on another day of the same year, the full date in another year, and
    the full stamp on hover.
11. **Done** shows `✓ reviewed` on a card reviewed before delivery and `✓ 15 reviewed first` in its head.
    It holds the latest 15, `Show 25 more` (fewer when fewer remain, `Show 12 more`) and `Latest 15`
    to go back, with `15 of 52 shown`. The Abandoned lane is collapsed to a 44px strip by default,
    opens on click or Enter, and takes the same cap. Hide / Show all applies to both lanes: in Hide,
    only tickets closed within the last day enter them.
12. **Abandoned cards** have a muted, struck-through title and no opacity (AA in both themes).
13. **Focus is a 2px `--link` ring set 3px off the card**, never mistaken for a waiting outline.
14. **The ticket dialog** runs head → facts → Timeline → Description, in the existing `#ap-detail`.
    The facts gain `reviewed`.
15. **The Timeline is the Progress chart's grid.** Its rows: Filed, a quiet outlined and hatched track
    from filed to the build's start with a firm mark at the filed instant, reading `queued 35m`, or
    `waiting 3h 24m` while not started (labelled `Filed 08:40` when filed today and plain `Filed`,
    stamp on hover, otherwise); Build, split into its recorded wip and paused segments; one Review N
    row per review pass, hatched while running; After build, the waits (awaiting review, reviewing,
    awaiting merge) as stretched pills, whose reviewing spans are derived from the review rows.
16. **The axis ends at a marker line**: red `now 13:36` while the ticket is open, `delivered 13:28` or
    `abandoned 09:40` in the state colour once closed. Tick labels it would cover are hidden by
    measurement after the dialog opens.
17. **A legend under the chart gives the time spent in each state**, so short phases can be read.
18. **The hidden note** counts the build and review rows of the hidden tickets as tasks.

## New names

- Classes: `ap-kanban-frame`, `ap-kanban`; `ap-lane`, `ap-lane-dot`, `ap-lane-count`, `ap-lane-sub`,
  `ap-lane-cards`, `ap-lane-group`, `ap-lane-group-count`, `ap-lane-more`, `ap-lane-toggle`;
  `ap-kanban-card`, `ap-kanban-card-head`, `ap-kanban-title`, `ap-kanban-marks`, `ap-kanban-held`,
  `ap-kanban-no-row`, `ap-kanban-note`, `ap-kanban-state`, `ap-kanban-stamp`; `ap-ticket-gantt`,
  `ap-ticket-gantt-ticks`, `ap-ticket-gantt-overlay`, `ap-ticket-gantt-end`,
  `ap-ticket-gantt-end-label`, `ap-ticket-gantt-filed`, `ap-ticket-gantt-legend`,
  `ap-ticket-gantt-swatch`, `ap-ticket-gantt-note`; `ap-bar-segment`, `ap-lifecycle-segment`.
- Attributes: `data-lane` and `data-collapsed` on a lane, `data-row="none"` on a card,
  `data-priority` on a lane divider, `data-overflow` on the frame, `data-live` on a bar,
  `data-covered` on a tick, `data-ticket-link` on a ticket link, `data-lane-more` and
  `data-lane-reset` on the Done and Abandoned controls.
- Ids: `ap-tab-kanban`, `ap-panel-kanban`, `ap-kanban-frame`, `ap-kanban`, `ap-lane-<lane>-cards`,
  `ap-kanban-<ticket id>`.
- Tokens: none; every colour is an existing token or a `[data-state]` variable.
- localStorage, per tracker: `agent-progress:<tracker>:kanban-done-shown`, `…:kanban-abandoned-shown`,
  `…:kanban-abandoned` (`open` or `closed`); the existing `…:visibility` is reused.

## Markup contract

The panel ships a static board so the template opens on its own. The markup functions emit exactly
these shapes; parts in `[ ]` are optional.

```html
<section data-panel="kanban" role="tabpanel" id="ap-panel-kanban" aria-labelledby="ap-tab-kanban" hidden>
  <div class="ap-kanban-frame" id="ap-kanban-frame"><div class="ap-kanban" id="ap-kanban"> six lanes </div></div>
</section>

<!-- lane; lane = todo | progress | review | merge | done | abandoned -->
<section class="ap-card ap-lane" data-lane="review" [data-collapsed] aria-label="Review">
  <div class="ap-card-head">
    <span class="ap-lane-dot" data-state="reviewing"></span><span class="ap-card-title">Review</span><span class="ap-lane-count">3</span>
    <span class="ap-lane-sub"><span class="ap-lane-dot" data-state="finished"></span>1 awaiting · <span class="ap-lane-dot" data-state="reviewing"></span>2 reviewing</span>
  </div>
  <div class="ap-lane-cards" id="ap-lane-review-cards">
    [<div class="ap-lane-group" data-priority="high">High <span class="ap-lane-group-count">1</span></div>]
    cards… | <div class="ap-empty">Nothing in review.</div>
  </div>
  [<div class="ap-lane-more"><span>15 of 52 shown</span><div class="ap-seg"><button type="button" data-lane-more="done">Show 25 more</button><button type="button" data-lane-reset="done">Latest 15</button></div></div>]
</section>
<!-- Abandoned: the head's first three children are wrapped in
     <button type="button" class="ap-lane-toggle" aria-expanded="false" aria-controls="ap-lane-abandoned-cards">…</button> -->

<!-- card; data-state is the row's state, as on the Progress tab -->
<article class="ap-kanban-card" id="ap-kanban-059" data-ticket-id="059" data-state="re-review" [data-row="none"] tabindex="0"
         aria-label="#059 Accent-blind search, reviewing 2, normal priority">
  <div class="ap-kanban-card-head"><span class="ap-ticket-id">#059</span>[priority mark]<span class="ap-detail-type">bug</span></div>
  [<span class="ap-tokens">4.2M tokens</span>]
  <p class="ap-kanban-title" title="Accent-blind search">Accent-blind search</p>
  [<div class="ap-kanban-marks">[<span class="ap-waiting">waiting on <a href="#ap-kanban-060" data-ticket-link="060">#060</a></span>]
     [<span class="ap-kanban-held" title="Held: …">held</span>] [<span class="ap-kanban-no-row" title="…">no row yet</span>]</div>]
  [<p class="ap-kanban-note">round 2 reviewer since 11:34</p>]
  <div class="ap-kanban-state">[<span class="ap-pill">reviewing 2</span>] [<span class="ap-reviewed-mark" data-state="reviewed" …>✓</span><span>reviewed</span>]</div>
  <span class="ap-kanban-stamp" title="finished 2026-09-25 10:48">finished 10:48</span>
</article>

<!-- #ap-detail-body for a ticket -->
<div class="ap-detail-head" data-state="re-review"><span class="ap-detail-id">#059</span><h2 class="ap-detail-title">…</h2>
  <span class="ap-pill">reviewing 2</span>[✓ mark][priority mark]<span class="ap-detail-type">bug</span></div>
<div class="ap-ticket-meta"><div><b>filed</b><span>08:40</span></div> … started, finished, reviewed, delivered, abandoned, reason, held, waiting on, branch, task</div>
<section class="ap-detail-section"><h3 class="ap-detail-section-title">Timeline</h3>
  <div class="ap-ticket-gantt">
    <div class="ap-grid-row ap-chart-head"><div class="ap-cell-name">Row</div><div class="ap-cell-pill">Time</div>
      <div class="ap-cell-track" style="height:100%"><div class="ap-ticket-gantt-ticks">
        <div class="ap-tick" style="left:x%"><span>09:00</span></div>…
        <span class="ap-ticket-gantt-end-label" [data-state="delivered"] style="left:x%">now 13:36</span></div></div></div>
    <div class="ap-body">
      <div class="ap-ticket-gantt-overlay"><div class="ap-grid-line" style="left:x%"></div>… <div class="ap-ticket-gantt-end" [data-state] style="left:x%"></div></div>
      <div class="ap-grid-row ap-row"><div class="ap-cell-name"><span class="ap-name">Filed <span class="mono">08:40</span></span></div><div class="ap-cell-pill">queued 35m</div>
        <div class="ap-cell-track"><div class="ap-bar ap-ticket-gantt-filed" style="left;width"></div></div></div>
      Build row: <div class="ap-bar ap-bar-segment" data-state="running|paused" [data-live]> per phase
      Review N row: <div class="ap-bar" data-state="reviewing|re-review" [data-live]>
      After build row: <div class="ap-bar ap-lifecycle-segment" data-state="finished|reviewing|re-review|reviewed">label when wide enough</div>
    </div>
  </div>
  <ul class="ap-ticket-gantt-legend"><li><span class="ap-ticket-gantt-swatch" data-state="pending"></span><b>unstarted</b><time>35m</time></li>…</ul>
  [<p class="ap-ticket-gantt-note">Not started: in the queue for 3h 24m.</p>]
</section>
<section class="ap-detail-section"><h3 class="ap-detail-section-title">Description</h3><div class="ap-ticket-body md">…</div></section>
```

Beyond markup, the page script sets the frame's `data-overflow` on scroll, on resize and when the tab
is selected, and a covered tick's `data-covered` after `showModal()`.
