import base       from '@reliquary/eslint-config';
import reactHooks from 'eslint-plugin-react-hooks';

const STORAGE_MESSAGE = 'Browser storage is reached only in bridge/preferences/PreferenceStore.ts.';
const STORAGE_SITES = ['bridge/preferences/PreferenceStore.ts'];

const TYPESCRIPT_FILES = ['**/*.{ts,tsx}'];

const RAW_MARKUP_MESSAGE = 'React escapes every value; agent-written HTML reaches the DOM only as a sandboxed iframe\'s srcdoc.';

/** Each process or browser reach CLAUDE.md confines, with the exact files allowed to make it. */
const CONFINED_REACHES = [
  {
    // src/shared/Environment.spec.ts tests the getters themselves (a Deviation).
    allowedIn: ['src/shared/Environment.ts', 'src/shared/Environment.spec.ts'],
    property:  { object: 'process', property: 'env', message: 'Read the environment through src/shared/Environment.ts.' },
  },
  {
    allowedIn: ['agent-progress.ts', 'agent-host.ts'],
    property:  { object: 'process', property: 'exit', message: 'Only agent-progress.ts and agent-host.ts exit; return an exit code.' },
  },
  { allowedIn: [], property: { object: 'process', property: 'chdir', message: 'Never change the working directory; pass a directory instead.' } },
  {
    // The bundle spec proves a fixture lies outside the test runner's directory.
    allowedIn: ['cli/CommandContext.ts', 'src/lib/claude-code/WorkflowScriptBundle.spec.ts'],
    property:  { object: 'process', property: 'cwd', message: 'Take the directory from the CommandContext.' },
  },
  {
    allowedIn:  ['cli/CommandContext.ts'],
    importName: { name: 'node:os', importNames: ['homedir'], message: 'Take the home directory from the CommandContext.' },
  },
  ...['localStorage', 'sessionStorage'].flatMap((storageName) => [
    { allowedIn: STORAGE_SITES, property: { object: 'window', property: storageName, message: STORAGE_MESSAGE } },
    { allowedIn: STORAGE_SITES, global: { name: storageName, message: STORAGE_MESSAGE } },
  ]),
];

function confinedReachRules(exemptFile) {
  const binding = CONFINED_REACHES.filter((reach) => !reach.allowedIn.includes(exemptFile));
  return {
    'no-restricted-properties': ['error', ...binding.filter((reach) => reach.property).map((reach) => reach.property)],
    'no-restricted-globals':    ['error', ...binding.filter((reach) => reach.global).map((reach) => reach.global)],
    'no-restricted-imports':    ['error', { paths: binding.filter((reach) => reach.importName).map((reach) => reach.importName) }],
  };
}

const CONFINED_REACH_SITES = [...new Set(CONFINED_REACHES.flatMap((reach) => reach.allowedIn))];

const CLOCK_MESSAGE = 'Take the clock from the CommandContext.';

const SPECS_AND_TESTING_FOLDERS = ['**/*.spec.ts', '**/*.dom.tsx', '**/testing/**/*.ts'];

export default [
  ...base,
  { ignores: ['**/*.js', 'node_modules/**', '.claude/**'] },
  {
    // Test-only helpers may import devDependencies; nothing that ships may import these folders.
    files: [
      'src/testing/**/*.ts',
      'src/lib/tracker-model/testing/**/*.ts',
      'cli/testing/**/*.ts',
      'src/adapters/progress/testing/**/*.ts',
      'src/services/tracker/testing/**/*.ts',
      'bridge/testing/**/*.ts',
      'bridge/**/*.dom.tsx',
    ],
    rules: { 'import/no-extraneous-dependencies': ['error', { devDependencies: true }] },
  },
  { files: TYPESCRIPT_FILES, rules: { 'import/enforce-node-protocol-usage': ['error', 'always'] } },
  // The shared config's object-curly-newline fix leaves a trailing space where it breaks a line of properties, which then want one per line.
  { files: TYPESCRIPT_FILES, rules: { '@stylistic/no-trailing-spaces': 'error' } },
  {
    // One style for local specifiers, the full file name; the resolver knows both, so an extensionless specifier is found and reported.
    files:    TYPESCRIPT_FILES,
    settings: { 'import/resolver': { node: { extensions: ['.ts', '.tsx'] } } },
    rules:    { 'import/extensions': ['error', 'always', { ignorePackages: true }] },
  },
  { files: TYPESCRIPT_FILES, rules: confinedReachRules(null) },
  ...CONFINED_REACH_SITES.map((site) => ({ files: [site], rules: confinedReachRules(site) })),
  {
    files:   ['src/**/*.ts', 'cli/**/*.ts', 'agent-progress.ts', 'agent-host.ts'],
    ignores: [...SPECS_AND_TESTING_FOLDERS, 'cli/CommandContext.ts', 'agent-host.ts'],
    rules:   {
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: CLOCK_MESSAGE },
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: CLOCK_MESSAGE },
      ],
    },
  },
  {
    files:   ['bridge/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules:   {
      ...reactHooks.configs.flat.recommended.rules,
      'react-hooks/exhaustive-deps': 'error',
      'no-restricted-syntax':        [
        'error',
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: RAW_MARKUP_MESSAGE },
        { selector: "AssignmentExpression > MemberExpression.left[property.name=/^(innerHTML|outerHTML)$/]", message: RAW_MARKUP_MESSAGE },
      ],
    },
  },
  {
    files: TYPESCRIPT_FILES,
    rules: {
      '@typescript-eslint/no-non-null-assertion':  'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-warning-comments':                       ['error', { terms: ['todo', 'fixme', 'xxx', 'hack'], location: 'anywhere' }],
      'id-length':                                 ['error', { min: 2, exceptions: ['i', 'a', 'b'], properties: 'never' }],
    },
  },
  {
    files:   TYPESCRIPT_FILES,
    ignores: [...SPECS_AND_TESTING_FOLDERS, '**/constants/**/*.ts'],
    rules:   {
      '@typescript-eslint/no-magic-numbers': ['error', {
        // Arithmetic identities stay inline: a step, a halving, the hexadecimal radix, a percent.
        ignore:                        [-1, 0, 1, 2, 16, 100],
        ignoreArrayIndexes:            true,
        ignoreDefaultValues:           true,
        ignoreEnums:                   true,
        ignoreNumericLiteralTypes:     true,
        ignoreReadonlyClassProperties: true,
        ignoreTypeIndexes:             true,
      }],
    },
  },
];
