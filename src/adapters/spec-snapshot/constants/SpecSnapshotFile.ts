/** Inside the tracker folder, beside `progress.json`, and named here because the tracker's own file names are the tracker service's. */
export const SPEC_SNAPSHOT_FILE_NAME = 'progress-spec.json';

/** The version every write stores and the only one a read accepts, checked by equality: the document is regenerated, never migrated. */
export const CURRENT_SPEC_SNAPSHOT_FILE_VERSION = 1;
