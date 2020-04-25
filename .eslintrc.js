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
}
