/**
 * What the stored pipeline means to the gate runs that still take one checks line and one install line: the gates joined in order, the
 * prepare steps joined in order, and the content hash a row records of the pipeline it is judged by.
 */
import type { Pipeline, PipelineGate } from '../@types/Pipeline.ts';
import { TicketBodyHashUtil }          from './TicketBodyHashUtil.ts';

/** An empty gate list is no gates on purpose: a line that always passes, so a landing goes ahead. */
const NO_GATES_LINE = 'true';

const LINE_JOINER = ' && ';

function quotedForTheShell(text: string): string {
  return `'${text.replaceAll('\'', '\'\\\'\'')}'`;
}

function gateLineOf(gate: Readonly<PipelineGate>): string {
  return gate.in === undefined ? gate.run : `cd ${quotedForTheShell(gate.in)} && (${gate.run})`;
}

/** Every key in a fixed order, so a hand edit that only reorders or reindents keeps the hash. */
function pipelineHashOf(pipeline: Readonly<Pipeline>): string {
  const canonical = {
    prepare: pipeline.prepare.map((step) => ({ name: step.name, run: step.run })),
    gates:   pipeline.gates.map((gate) => ({
      name:         gate.name,
      run:          gate.run,
      fix:          gate.fix ?? null,
      in:           gate.in ?? null,
      definedBy:    gate.definedBy ?? [],
      network:      gate.network ?? [],
      writes:       gate.writes ?? [],
      overseerOnly: gate.overseerOnly ?? false,
    })),
    review:       pipeline.review === undefined ? null : { name: pipeline.review.name, model: pipeline.review.model ?? null, effort: pipeline.review.effort ?? null },
    constitution: pipeline.constitution ?? [],
    agents:       Object.entries(pipeline.agents ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  };
  return TicketBodyHashUtil.bodyHashOf(JSON.stringify(canonical));
}

/** One line alone runs as written, so a pipeline of one step runs exactly the line it was given. */
function joinedLineOf(lines: readonly string[]): string {
  return lines.length === 1 ? (lines[0] ?? '') : lines.map((line) => `(${line})`).join(LINE_JOINER);
}

function checksLineOf(pipeline: Readonly<Pipeline>): string {
  return pipeline.gates.length === 0 ? NO_GATES_LINE : joinedLineOf(pipeline.gates.map(gateLineOf));
}

/** `null` when the pipeline prepares nothing. */
function installLineOf(pipeline: Readonly<Pipeline>): string | null {
  return pipeline.prepare.length === 0 ? null : joinedLineOf(pipeline.prepare.map((step) => step.run));
}

function definitionFilesOf(pipeline: Readonly<Pipeline>): string[] {
  return [...new Set(pipeline.gates.flatMap((gate) => gate.definedBy ?? []))];
}

function writablePathsOf(pipeline: Readonly<Pipeline>): string[] {
  return [...new Set(pipeline.gates.flatMap((gate) => gate.writes ?? []))];
}

export const PipelineUtil = Object.freeze({
  pipelineHashOf,
  checksLineOf,
  installLineOf,
  definitionFilesOf,
  writablePathsOf,
});
