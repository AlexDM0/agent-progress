import base from '@reliquary/eslint-config';

export default [
  ...base,
  { ignores: ['**/*.js', 'node_modules/**', '.claude/**'] },
  {
    // Test-only helpers may import devDependencies; a guard spec asserts nothing shipped imports
    // this folder, which is what keeps the exemption honest.
    files: ['lib/tooling/dev/**/*.ts'],
    rules: { 'import/no-extraneous-dependencies': ['error', { devDependencies: true }] },
  },
];
