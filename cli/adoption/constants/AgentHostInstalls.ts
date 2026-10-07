/**
 * What `init` and `update` install for each agent host: the parts, in report order, each with the files it writes, how their text is
 * produced, the flag that opts out of it and its report label; and the host's own sentences, filled into the shared templates.
 */
import type { CommandHook }        from '../../../src/lib/claude-code/ClaudeSettings.ts';
import type { InstalledFilePaths } from '../../InstalledFiles.ts';

export type AgentHost = 'claude-code';

export const INSTALL_OPT_OUT_FLAGS = ['no-claude-md', 'no-hooks', 'no-workflow', 'no-agent-definition'] as const;

export type InstallOptOutFlag = typeof INSTALL_OPT_OUT_FLAGS[number];

export type InstalledFileName = Exclude<keyof InstalledFilePaths, 'installManifest'>;

export type InstalledTextSource =
  | { kind: 'template'; templateFileName: string }
  | { kind: 'dispatcher-bundle' };

export interface InstalledFile {
  name: InstalledFileName;
  text: InstalledTextSource;
}

/** A folder of this checkout's `skills/`, copied under the same name into the repository's `.claude/skills/`. */
export type InstalledSkillName = 'agent-progress' | 'agent-progress-orchestrate';

/**
 * `managed-block` keeps the rest of the file; `rewritten-files` replaces each file whole, and `briefs` does too but asks the reader to
 * re-read the last one, whose presence marks the files installed; `claude-settings-hooks` writes no file text, only Claude Code settings
 * entries; `skill-folders` rewrites every file of each skill folder, leaves any other file in it alone, and git-ignores the folder.
 */
export type InstalledPart =
  | { writing: 'managed-block'; reportLabel: string; optOutFlag: InstallOptOutFlag | null; file: InstalledFile }
  | { writing: 'briefs'; reportLabel: string; optOutFlag: null; files: readonly InstalledFile[] }
  | { writing: 'rewritten-files'; reportLabel: string; optOutFlag: InstallOptOutFlag | null; files: readonly InstalledFile[] }
  | { writing: 'claude-settings-hooks'; reportLabel: string; optOutFlag: InstallOptOutFlag | null; hooks: readonly CommandHook[] }
  | { writing: 'skill-folders'; reportLabel: string; optOutFlag: null; skillNames: readonly InstalledSkillName[] };

export interface AgentHostInstall {
  parts:         readonly InstalledPart[];
  hostSentences: Readonly<Record<string, string>>;
}

/** The matcher is empty so every subagent is recorded, matching the cohort `usage` reads; the timeout covers waiting on a held lock. */
const SUBAGENT_STOP_HOOK: CommandHook = {
  event:          'SubagentStop',
  matcher:        '',
  command:        'agent-progress hook subagent-stop',
  timeoutSeconds: 20,
};

/** Only a Bash call can change the check command, and the hook reads nothing but its input, so it needs no lock time. */
const PRE_TOOL_USE_HOOK: CommandHook = {
  event:          'PreToolUse',
  matcher:        'Bash',
  command:        'agent-progress hook pre-tool-use',
  timeoutSeconds: 10,
};

const CLAUDE_CODE_HOST_SENTENCES: Readonly<Record<string, string>> = {
  tokenHookClause: 'and the\n'
    + '  `SubagentStop` hook adds every token the agent processed to that row when it stops, so where the\n'
    + '  hook is installed pass no `--tokens`: it would replace the sum.',
  tokenHookPassage: 'the `SubagentStop` hook reads that line from the brief alone and adds the agent\'s `input` —\n'
    + 'every token it processed, the figure its log line names just before `output`,\n'
    + '`input 3.8M (cache read 3.6M)` — to the row when the agent stops. It adds rather than sets, so a row\n'
    + 'several agents worked on carries all of them, and a workflow script\'s agents reach their row the same\n'
    + 'way. A bundle, and a ticket without a row yet — a low one, whose row the builder\'s own claim creates —\n'
    + 'is named by ticket instead, `agent-progress ticket: 22, 20`, the same ids as the builder\'s one\n'
    + '`ticket claim 22 20`, and the hook divides evenly over their rows, looking each up when the agent\n'
    + 'stops; keep one of the two lines, since a brief with both is read by its row line alone. The review\n'
    + 'brief always names the review bar\'s own row. **Where the hook is installed, pass no `--tokens`**: it\n'
    + 'would replace the sum. The harness\'s own `subagent_tokens` is roughly the end context, far below what\n'
    + 'the agent processed and not by a constant factor, so it is the fallback for a repository without the\n'
    + 'hook only, recorded with `--tokens` as the understatement it is.',
  finishTokensNote: '`--tokens <subagent_tokens>` only without the hook; ',
};

export const AGENT_HOST_INSTALLS: Readonly<Record<AgentHost, AgentHostInstall>> = {
  'claude-code': {
    parts: [
      {
        writing:     'managed-block',
        reportLabel: 'CLAUDE.md',
        optOutFlag:  'no-claude-md',
        file:        { name: 'claudeInstructions', text: { kind: 'template', templateFileName: 'ClaudeInstructionsBlock.md' } },
      },
      {
        writing:     'briefs',
        reportLabel: 'brief',
        optOutFlag:  null,
        files:       [
          { name: 'builderBrief', text: { kind: 'template', templateFileName: 'BuilderBrief.md' } },
          { name: 'reviewBrief', text: { kind: 'template', templateFileName: 'ReviewBrief.md' } },
          { name: 'agentBrief', text: { kind: 'template', templateFileName: 'AgentBrief.md' } },
        ],
      },
      {
        writing:     'claude-settings-hooks',
        reportLabel: 'hooks',
        optOutFlag:  'no-hooks',
        hooks:       [SUBAGENT_STOP_HOOK, PRE_TOOL_USE_HOOK],
      },
      {
        writing:     'rewritten-files',
        reportLabel: 'workflow',
        optOutFlag:  'no-workflow',
        files:       [{ name: 'dispatcherScript', text: { kind: 'dispatcher-bundle' } }],
      },
      {
        writing:     'rewritten-files',
        reportLabel: 'agent',
        optOutFlag:  'no-agent-definition',
        files:       [{ name: 'agentDefinition', text: { kind: 'template', templateFileName: 'AgentProgressWorker.md' } }],
      },
      {
        writing:     'skill-folders',
        reportLabel: 'skills',
        optOutFlag:  null,
        skillNames:  ['agent-progress', 'agent-progress-orchestrate'],
      },
    ],
    hostSentences: CLAUDE_CODE_HOST_SENTENCES,
  },
};
