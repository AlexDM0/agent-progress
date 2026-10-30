/**
 * One row of filter chips, as the static page drew and drove it: each chip leads with its lane dot or epic swatch, shows whether it is
 * pressed and its count, is marked empty at a count of zero, and hands its value on when clicked. Which chips are pressed and what they
 * count is the caller's, from `ChipFilterUtil`.
 */
export interface FilterChip {
  readonly value:       string;
  readonly label:       string;
  /** A state chip leads with the lane dot of this state. */
  readonly stateToken?: string;
  /** An epic chip leads with the swatch of this colour slot. */
  readonly slot?:       number;
}

export interface FilterChipGroupProps {
  readonly label:       string;
  readonly chips:       readonly FilterChip[];
  readonly pressed:     readonly string[];
  readonly countByChip: ReadonlyMap<string, number>;
  readonly onToggle:    (value: string) => void;
}

export function FilterChipGroup({
  label, chips, pressed, countByChip, onToggle
}: FilterChipGroupProps) {
  return (
    <div className="bridge-chips" role="group" aria-label={label}>
      {chips.map((chip) => {
        const count = countByChip.get(chip.value) ?? 0;
        return (
          <button
            key={chip.value}
            type="button"
            className="bridge-chip"
            data-chip={chip.value}
            data-state={chip.stateToken}
            data-epic-slot={chip.slot === undefined ? undefined : String(chip.slot)}
            data-empty={count === 0 ? '' : undefined}
            aria-pressed={pressed.includes(chip.value)}
            onClick={() => onToggle(chip.value)}
          >
            {chip.stateToken === undefined ? null : <span className="bridge-lane-dot" data-state={chip.stateToken} />}
            {chip.slot === undefined ? null : <span className="bridge-chip-swatch" data-epic-slot={String(chip.slot)} aria-hidden="true" />}
            {chip.label}
            {' '}
            <span className="bridge-chip-count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
