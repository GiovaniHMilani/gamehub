import { defineConfig } from 'drizzle-kit'

// Used only to generate SQL migrations (`pnpm db:generate`). The app applies
// the generated files at startup with drizzle-orm's migrator.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/persistence/schema.ts',
  out: './drizzle',
})
