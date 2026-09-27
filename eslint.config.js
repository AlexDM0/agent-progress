import base from '@reliquary/eslint-config';

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
      'src/adapters/legacy/testing/**/*.ts',
      'src/services/tracker/testing/**/*.ts',
      'dispatcher/testing/**/*.ts',
      'page/testing/**/*.ts',
    ],
    rules: { 'import/no-extraneous-dependencies': ['error', { devDependencies: true }] },
  },
  { files: ['**/*.ts'], rules: { 'import/enforce-node-protocol-usage': ['error', 'always'] } },
  {
    // One style for local specifiers, the `.ts` file name; the resolver knows `.ts`, so an extensionless specifier is found and reported.
    files:    ['**/*.ts'],
    settings: { 'import/resolver': { node: { extensions: ['.ts'] } } },
    rules:    { 'import/extensions': ['error', 'always', { ignorePackages: true }] },
  },
];
