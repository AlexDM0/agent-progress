/** What the page header shows: its title and its statistics, each a figure under a label. */

export interface HeaderStatisticModel {
  readonly figure:    string;
  readonly label:     string;
  /** The Kanban lane the statistic selects; null leaves it plain text. */
  readonly opensLane: string | null;
  readonly state:     string | null;
}

/** One figure of the embedded summary line; its state names the lane colour of its dot, null drawing no dot. */
export interface SummaryLineFigureModel {
  readonly figure: string;
  readonly label:  string;
  readonly state:  string | null;
}

export interface SummaryLineModel {
  readonly states: readonly SummaryLineFigureModel[];
  readonly today:  readonly SummaryLineFigureModel[];
}

export interface HeaderModel {
  readonly projectTitle: string;
  readonly statistics:   readonly HeaderStatisticModel[];
}
