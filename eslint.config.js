import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'src/types/database.ts'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Architectural boundary (ARCHITECTURE.md §2.3):
  // only src/services/* and src/lib/supabase.ts may talk to supabase-js.
  // This is what keeps a future swap to a Node API a one-folder change.
  // ───────────────────────────────────────────────────────────────────────────
  {
    files: ['src/features/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}', 'src/app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@supabase/supabase-js',
              message:
                'Do not use supabase-js directly in UI code. Add a function to src/services/ and call that instead.',
            },
          ],
          patterns: [
            {
              group: ['@/lib/supabase', '**/lib/supabase'],
              message:
                'The supabase client is private to src/services/. Add a service function and call that instead.',
            },
          ],
        },
      ],
    },
  },

  // Money must never be a JS number in code that computes it.
  {
    files: ['src/lib/money.ts', 'src/lib/gst.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
)
