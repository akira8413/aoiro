import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL || "postgresql://aoiro:aoiro@127.0.0.1:1/aoiro_missing_database_url";

if (!process.env.DATABASE_URL && process.env.NODE_ENV !== "production") {
  console.warn("DATABASE_URL is not set. Database routes will fail until it is configured.");
}

const client = postgres(connectionString);
export const db = drizzle(client, { schema });
