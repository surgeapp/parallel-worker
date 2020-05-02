'use strict'

module.exports = {
  extends: [
    '@strv/eslint-config-node/v12',
    '@strv/eslint-config-node/optional',
    '@strv/eslint-config-typescript',
    '@strv/eslint-config-typescript/style',
  ],
  parserOptions: {
    // The project field is required in order for some TS-syntax-specific rules to function at all
    // @see https://github.com/typescript-eslint/typescript-eslint/tree/master/packages/parser#configuration
    project: './tsconfig.json',
  },
  rules: {
    'require-atomic-updates': 'off',
    'no-process-exit': 'off',
    'max-len': ['warn', { code: 130 }],
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/prefer-readonly-parameter-types': 'off',
    '@typescript-eslint/no-unnecessary-condition': 'off',
    '@typescript-eslint/restrict-template-expressions': 'off',
    '@typescript-eslint/no-misused-promises': 'off',
    '@typescript-eslint/require-await': 'off', // duplicate of require-await, reports error twice
    'import/group-exports': 'off',
    'import/no-unused-modules': 'off'
  }
}
