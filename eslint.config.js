const eslint = require('@eslint/js');
const tseslint = require('@typescript-eslint/eslint-plugin');
const tsparser = require('@typescript-eslint/parser');
const prettierConfig = require('eslint-config-prettier');
const path = require('path');

module.exports = [
    // Global ignores
    {
        ignores: ['**/*.test.ts', 'dist/**', 'node_modules/**'],
    },
    // Base ESLint recommended rules
    eslint.configs.recommended,
    // TypeScript files configuration
    {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                tsconfigRootDir: __dirname,
                project: ['./tsconfig.json'],
                ecmaVersion: 2020,
                sourceType: 'module',
            },
            globals: {
                console: 'readonly',
                process: 'readonly',
                Buffer: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                module: 'readonly',
                require: 'readonly',
                exports: 'readonly',
            },
        },
        plugins: {
            '@typescript-eslint': tseslint,
        },
        rules: {
            ...tseslint.configs.recommended.rules,
            '@typescript-eslint/no-explicit-any': 0,
            '@typescript-eslint/ban-ts-comment': 0,
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                },
            ],
        },
    },
    // Prettier config (disables conflicting rules)
    prettierConfig,
];
