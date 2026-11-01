import { defineConfig } from 'vitest/config'

export default defineConfig({
  build: {
    target: 'es2022',
    lib: {
      entry: {
        index: 'src/index.ts',
        tokenizer: 'src/core/tokenizer.ts',
        incremental: 'src/core/incremental.ts',
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
      cssFileName: 'StreamCode',
    },
    rollupOptions: {
      external: (id) => /^(react|react-dom|shiki)(\/|$)/.test(id),
      output: { assetFileNames: 'react/[name][extname]' },
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
})
