import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['out/', 'dist/', 'release/', '.dev/', 'node_modules/', 'plugins/', 'scripts/*.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['src/renderer/**/*.{ts,tsx}'], plugins: { 'react-hooks': reactHooks }, rules: reactHooks.configs.recommended.rules, languageOptions: { globals: globals.browser } },
  { files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'test/**/*.ts', '*.ts'], languageOptions: { globals: globals.node } },
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] } },
)
