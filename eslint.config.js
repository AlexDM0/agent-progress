import base from '@reliquary/eslint-config';

export default [
  ...base,
  { ignores: ['**/*.js', 'node_modules/**', '.claude/**'] },
  {
    // Test-only helpers may import devDependencies; nothing that ships may import this folder.
    files: ['lib/tooling/dev/**/*.ts'],
    rules: { 'import/no-extraneous-dependencies': ['error', { devDependencies: true }] },
  },
];
