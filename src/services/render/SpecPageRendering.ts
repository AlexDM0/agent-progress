/**
 * The spec view of a spec-kit repository, end to end: scanned, derived, stored as `progress-spec.json`, read back and filled into
 * `progress-spec.html`. It takes no lock and touches no tracker file, since the tracker is not its source: the repository is.
 */
import { join } from 'node:path';

import { createSpecKitRepositoryScan }                             from '../../adapters/spec-kit/SpecKitRepositoryScan.ts';
import { SpecSnapshotFileIngestion, type SpecSnapshotFileReading } from '../../adapters/spec-snapshot/SpecSnapshotFileIngestion.ts';
import { createSpecSnapshotFileWriter }                            from '../../adapters/spec-snapshot/SpecSnapshotFileWriter.ts';
import { SPEC_SNAPSHOT_FILE_NAME }                                 from '../../adapters/spec-snapshot/constants/SpecSnapshotFile.ts';
import { writeFileAtomically }                                     from '../../lib/atomic-file/AtomicFile.ts';
import { deriveSpecSnapshot }                                      from '../../lib/spec-snapshot/SpecSnapshotDerivation.ts';
import type { RenderState }                                        from './RenderState.ts';
import { fillSpecPageTemplate }                                    from './SpecPageTemplateFill.ts';

const SPEC_PAGE_FILE_NAME = 'progress-spec.html';

export interface SpecPageRenderingInput {
  specKitRootDirectory: string;
  /** Where both files go, created when missing. */
  trackerDirectory:     string;
  /** The caller's clock, never one read here. */
  generatedAt:          Date;
}

export type SpecPageRenderOutcome =
  | { verdict: 'rendered'; snapshotFilePath: string; pageFilePath: string; pageScriptFailure: string | null }
  | { verdict: 'unreadable-snapshot'; snapshotFilePath: string; reading: Exclude<SpecSnapshotFileReading, { verdict: 'readable' }> };

/** The page is filled from the snapshot read back from disk, so it shows what `progress-spec.json` holds and nothing the write lost. */
export async function renderSpecPage(input: SpecPageRenderingInput, renderState: RenderState): Promise<SpecPageRenderOutcome> {
  const { specKitRootDirectory, trackerDirectory, generatedAt } = input;
  const snapshotFilePath = join(trackerDirectory, SPEC_SNAPSHOT_FILE_NAME);

  const scan = createSpecKitRepositoryScan().scan(specKitRootDirectory);
  createSpecSnapshotFileWriter(trackerDirectory).write(deriveSpecSnapshot(scan, generatedAt));
  const reading = new SpecSnapshotFileIngestion(trackerDirectory).read();
  if (reading.verdict !== 'readable') return { verdict: 'unreadable-snapshot', snapshotFilePath, reading };

  const pageBundle        = await renderState.specPageBundler.bundlePageScript();
  const pageScriptFailure = pageBundle.verdict === 'failed' ? pageBundle.reason : null;
  const document          = fillSpecPageTemplate({
    snapshot:   reading.snapshot,
    pageScript: pageBundle.verdict === 'built' ? pageBundle.script : null,
    pageScriptFailure,
  });
  const pageFilePath = join(trackerDirectory, SPEC_PAGE_FILE_NAME);
  writeFileAtomically(pageFilePath, document);
  return {
    verdict: 'rendered', snapshotFilePath, pageFilePath, pageScriptFailure
  };
}
