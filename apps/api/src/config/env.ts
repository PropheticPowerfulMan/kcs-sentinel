import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? "kcs-sentinel-dev-secret",
  biometricSecret: process.env.BIOMETRIC_SECRET ?? "kcs-sentinel-biometric-key",
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/kcs_sentinel"
};
