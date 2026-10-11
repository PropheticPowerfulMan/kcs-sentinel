import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? "kcs-sentinel-dev-secret",
  biometricSecret: process.env.BIOMETRIC_SECRET ?? "kcs-sentinel-biometric-key",
  biometricProvider: process.env.BIOMETRIC_PROVIDER ?? "mock",
  biometricBridgeUrl: process.env.BIOMETRIC_BRIDGE_URL ?? "",
  biometricBridgeApiKey: process.env.BIOMETRIC_BRIDGE_API_KEY ?? "",
  biometricBridgeTimeoutMs: Number(process.env.BIOMETRIC_BRIDGE_TIMEOUT_MS ?? 15000),
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/kcs_sentinel",
  nexusApiUrl: process.env.NEXUS_API_URL ?? "http://localhost:5000",
  orbitApiUrl: process.env.ORBIT_API_URL ?? "http://localhost:4500",
  orbitApiKey: process.env.ORBIT_API_KEY ?? "",
  orbitOrganizationId: process.env.ORBIT_ORGANIZATION_ID ?? "kinshasa-christian-school",
  directoryCacheSeconds: Number(process.env.DIRECTORY_CACHE_SECONDS ?? 60)
};