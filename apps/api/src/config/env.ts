import dotenv from "dotenv";

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";
const required = (name: string, fallback: string, minimumLength = 1) => {
  const value = process.env[name] ?? (isProduction ? "" : fallback);
  if (value.length < minimumLength) {
    throw new Error(name + " must be configured securely" + (isProduction ? " in production" : ""));
  }
  return value;
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: required("JWT_SECRET", "kcs-sentinel-dev-secret", isProduction ? 48 : 12),
  biometricSecret: required("BIOMETRIC_SECRET", "kcs-sentinel-biometric-key", isProduction ? 48 : 12),
  biometricProvider: process.env.BIOMETRIC_PROVIDER ?? "mock",
  biometricBridgeUrl: process.env.BIOMETRIC_BRIDGE_URL ?? "",
  biometricBridgeApiKey: process.env.BIOMETRIC_BRIDGE_API_KEY ?? "",
  biometricBridgeTimeoutMs: Number(process.env.BIOMETRIC_BRIDGE_TIMEOUT_MS ?? 15000),
  databaseUrl: required("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/kcs_sentinel"),
  nexusApiUrl: process.env.NEXUS_API_URL ?? "http://localhost:5000",
  orbitApiUrl: process.env.ORBIT_API_URL ?? "http://localhost:4500",
  orbitApiKey: required("ORBIT_API_KEY", "development-only-orbit-key", isProduction ? 24 : 1),
  orbitOrganizationId: process.env.ORBIT_ORGANIZATION_ID ?? "kinshasa-christian-school",
  directoryCacheSeconds: Number(process.env.DIRECTORY_CACHE_SECONDS ?? 60)
};