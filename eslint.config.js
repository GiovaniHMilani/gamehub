import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

const NODE_BUILTINS = [
  'fs', 'path', 'os', 'child_process', 'crypto', 'net', 'http', 'https', 'url',
  'worker_threads', 'module', 'process', 'stream', 'zlib', 'util', 'events',
]
const nodeImportPatterns = ['node:*', ...NODE_BUILTINS, ...NODE_BUILTINS.map((m) => `${m}/*`)]

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'release/**', 'node_modules/**', 'playwright-report/**', 'test-results/**', 'bench/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'tests/**/*.ts', '*.config.{ts,js}'],
    languageOptions: { globals: globals.node },
  },
  {
    // Renderer: UI only. No Electron, no Node (CLAUDE.md §4).
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: 'electron', message: 'Renderer must use window.gamehub, not Electron.' }],
        patterns: [{ group: nodeImportPatterns, message: 'Renderer must not import Node APIs.' }],
      }],
    },
  },
  {
    // Shared: pure TypeScript usable from every layer.
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'electron', message: 'src/shared must stay runtime-agnostic.' },
          { name: 'react', message: 'src/shared must stay runtime-agnostic.' },
        ],
        patterns: [{ group: nodeImportPatterns, message: 'src/shared must stay runtime-agnostic.' }],
      }],
    },
  },
  {
    // Preload: only the bridge; never re-export raw Electron objects.
    files: ['src/preload/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{ group: nodeImportPatterns, message: 'Preload must not use Node APIs.' }],
      }],
    },
  },
)
