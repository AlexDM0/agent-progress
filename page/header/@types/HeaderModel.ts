/** What a page edition's header shows: its title and its statistics, each a figure under a label. */

export interface HeaderStatisticModel {
  readonly figure:    string;
  readonly label:     string;
  /** The Kanban lane the statistic selects; null leaves it plain text. */
  readonly opensLane: string | null;
  readonly state:     string | null;
}

export interface HeaderModel {
  readonly projectTitle: string;
  readonly statistics:   readonly HeaderStatisticModel[];
}
