import base from '@reliquary/eslint-config';

export default [
  ...base,
  { ignores: ['**/*.js', 'node_modules/**', '.claude/**'] },
  {
    // Test-only helpers may import devDependencies; nothing that ships may import these folders.
    files: ['src/testing/**/*.ts', 'cli/testing/**/*.ts', 'src/adapters/progress/testing/**/*.ts', 'dispatcher/testing/**/*.ts', 'page/testing/**/*.ts'],
    rules: { 'import/no-extraneous-dependencies': ['error', { devDependencies: true }] },
  },
  { files: ['**/*.ts'], rules: { 'import/enforce-node-protocol-usage': ['error', 'always'] } },
];
