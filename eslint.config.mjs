import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  {
    files: ['electron/**/*.ts', 'tests/**/*.ts', '*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['src/docs-ops/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
