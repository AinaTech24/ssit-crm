import type { Config } from "drizzle-kit";
import "dotenv/config";

export default {
  schema: "./src/db/schema/*",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/mfd",
  },
  strict: true,
  verbose: true,
} satisfies Config;
