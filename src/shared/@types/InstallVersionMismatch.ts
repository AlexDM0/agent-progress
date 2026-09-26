/** How the install version a tracked repository records disagrees with the running agent-progress; `unversioned` predates the manifest. */
export type InstallVersionMismatch =
  | { reason: 'older' | 'newer'; installedVersion: number }
  | { reason: 'unversioned' }
  | { reason: 'unreadable'; manifestProblem: string };
