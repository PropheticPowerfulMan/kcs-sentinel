import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { initializeDatabase } from "./db/init.js";

const app = createApp();

try {
  await initializeDatabase();

  app.listen(env.port, () => {
    console.log(`KCS SENTINEL API running on http://localhost:${env.port}`);
  });
} catch (error) {
  console.error("KCS SENTINEL API could not connect to PostgreSQL. Check DATABASE_URL and ensure the database server is running.");
  if (error instanceof Error) {
    console.error(error.message);
  }
  process.exit(1);
}