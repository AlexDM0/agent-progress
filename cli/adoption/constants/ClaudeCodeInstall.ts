/**
 * What `init` and `update` install for Claude Code: the parts, in report order, each with the files it writes, how their text is
 * produced, the flag that opts out of it and its report label; and the Claude Code sentences, filled into the shared templates.
 */
import type { CommandHook }        from '../../../src/lib/claude-code/ClaudeSettings.ts';
import type { InstalledFilePaths } from '../../InstalledFiles.ts';

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
export type InstalledSkillName = 'agent-po' | 'agent-progress-orchestrate';

/** A skill folder an earlier install version wrote under `.claude/skills/`, with the file names it installed there. */
export interface RetiredSkillFolder {
  skillName:          string;
  installedFileNames: readonly string[];
}

const INSTALLED_SKILL_NAMES: readonly InstalledSkillName[] = ['agent-po', 'agent-progress-orchestrate'];

const RETIRED_SKILL_FOLDERS: readonly RetiredSkillFolder[] = [{ skillName: 'agent-progress', installedFileNames: ['SKILL.md', 'Reference.md'] }];

/**
 * `managed-block` keeps the rest of the file; `rewritten-files` replaces each file whole, and `briefs` does too but asks the reader to
 * re-read the last one, whose presence marks the files installed; `claude-settings-hooks` writes no file text, only Claude Code settings
 * entries; `skill-folders` rewrites every file of each skill folder, leaves any other file in it alone, and git-ignores the folder, and
 * removes each retired folder's installed files and its `.gitignore` entry.
 */
export type InstalledPart =
  | { writing: 'managed-block'; reportLabel: string; optOutFlag: InstallOptOutFlag | null; file: InstalledFile }
  | { writing: 'briefs'; reportLabel: string; optOutFlag: null; files: readonly InstalledFile[] }
  | { writing: 'rewritten-files'; reportLabel: string; optOutFlag: InstallOptOutFlag | null; files: readonly InstalledFile[] }
  | { writing: 'claude-settings-hooks'; reportLabel: string; optOutFlag: InstallOptOutFlag | null; hooks: readonly CommandHook[] }
  | {
    writing:             'skill-folders';
    reportLabel:         string;
    optOutFlag:          null;
    skillNames:          readonly InstalledSkillName[];
    retiredSkillFolders: readonly RetiredSkillFolder[];
  };

export interface ClaudeCodeInstall {
  parts:     readonly InstalledPart[];
  sentences: Readonly<Record<string, string>>;
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

const CLAUDE_CODE_SENTENCES: Readonly<Record<string, string>> = {
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
    + 'stops; keep one of the two lines, since a brief with both is read by its row line alone. A workflow\n'
    + 'agent\'s first message is the harness relaying the session user\'s request, beginning\n'
    + '`[Workflow harness — user request]`; its brief is then the message right after it, the one beginning\n'
    + '`[Workflow harness — computed task]`, and a relay followed by anything else has no brief at all. The review\n'
    + 'brief always names the review bar\'s own row. **Where the hook is installed, pass no `--tokens`**: it\n'
    + 'would replace the sum. The harness\'s own `subagent_tokens` is roughly the end context, far below what\n'
    + 'the agent processed and not by a constant factor, so it is the fallback for a repository without the\n'
    + 'hook only, recorded with `--tokens` as the understatement it is.',
  finishTokensNote:       '`--tokens <subagent_tokens>` only without the hook; ',
  dispatcherWorkflowName: '`.agent-progress/agent-progress-dispatch.js`',
  installCheck:           'read `.claude/settings.local.json` and `.claude/settings.json` for\n'
    + '  `agent-progress hook subagent-stop`. `init` and `update` write it into the local file by default, so it is\n'
    + '  normally in one of them and there is nothing to say. If it is in neither — the repository was adopted before the\n'
    + '  hook existed, or somebody ran `--no-hooks` — say so once and offer `agent-progress update`: it is what puts every\n'
    + '  agent\'s cost on its row; without it a workflow\'s agents reach no row at all. Then check\n'
    + '  `.agent-progress/agent-progress-dispatch.js` exists. If not — adopted before the dispatcher, or `--no-workflow` —\n'
    + '  say so once and offer `agent-progress update` the same way; until then only the manual path is open.',
  askingTheUser:    'the AskUserQuestion tool, up to four questions per call.',
  dispatcherLaunch: '`Workflow({ scriptPath: \'<mainCheckout>/.agent-progress/agent-progress-dispatch.js\',\n'
    + '  args: <the args> })`, by this path only: it has no name to launch it by. The result names the run\'s `runId`.\n'
    + '  The session\'s guideline of 10 agents per workflow does not bound this one.',
  dispatcherRunEnd: 'the Workflow call runs as a background task; a task notification says when it\n'
    + '  returns, with its summary, or that it was stopped or died.',
  dispatcherResume: '`Workflow({ scriptPath: \'<mainCheckout>/.agent-progress/agent-progress-dispatch.js\',\n'
    + '  resumeFromRunId: \'<the stored run id>\', args: <the launch\'s args> })`, its result naming the new `runId`.',
  dispatcherStop: 'stop the Workflow task itself.',
  agentByHand:    'the Agent tool with `subagent_type: \'agent-progress-worker\'`, the installed definition\n'
    + '  `.claude/agents/agent-progress-worker.md` that carries the default model and effort.',
};

export const CLAUDE_CODE_INSTALL: ClaudeCodeInstall = {
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
        { name: 'reference', text: { kind: 'template', templateFileName: 'Reference.md' } },
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
      writing:             'skill-folders',
      reportLabel:         'skills',
      optOutFlag:          null,
      skillNames:          INSTALLED_SKILL_NAMES,
      retiredSkillFolders: RETIRED_SKILL_FOLDERS,
    },
  ],
  sentences: CLAUDE_CODE_SENTENCES,
};
