import { pool } from "./pool.js";
import { databaseSchema } from "./schema.js";

export const initializeDatabase = async () => {
  await pool.query(databaseSchema);
  if (process.env.NODE_ENV !== "production" && process.env.SEED_DEMO_DATA === "true") {
    const { seedDatabase } = await import("./seed.js");
    await seedDatabase();
  }
};
