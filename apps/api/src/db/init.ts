import { pool } from "./pool.js";
import { databaseSchema } from "./schema.js";
import { seedDatabase } from "./seed.js";

export const initializeDatabase = async () => {
  await pool.query(databaseSchema);
  await seedDatabase();
};
