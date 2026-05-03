import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

// drizzle-kit prepends cwd to `out`, so keep it relative.
const ROOT = __dirname;
process.chdir(ROOT);

export default defineConfig({
  schema: path.relative(ROOT, path.join(ROOT, "src/schema/index.ts")),
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
