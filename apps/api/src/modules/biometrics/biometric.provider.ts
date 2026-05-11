import { env } from "../../config/env.js";

export type BiometricCapturePurpose = "verify" | "enroll" | "exit";

type BridgeCaptureResponse = {
  template?: string;
  message?: string;
  deviceName?: string;
  quality?: number;
};

export const isLiveBiometricCaptureEnabled = () => env.biometricProvider === "http-bridge" && Boolean(env.biometricBridgeUrl);

export const captureFingerprintTemplate = async (purpose: BiometricCapturePurpose) => {
  if (!isLiveBiometricCaptureEnabled()) {
    throw new Error("Live biometric capture is not configured on this server");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), env.biometricBridgeTimeoutMs);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    if (env.biometricBridgeApiKey) {
      headers["x-api-key"] = env.biometricBridgeApiKey;
    }

    const response = await fetch(`${env.biometricBridgeUrl.replace(/\/$/, "")}/capture`, {
      method: "POST",
      headers,
      body: JSON.stringify({ purpose }),
      signal: controller.signal
    });

    const payload = (await response.json().catch(() => null)) as BridgeCaptureResponse | null;

    if (!response.ok) {
      throw new Error(payload?.message ?? "The biometric bridge rejected the capture request");
    }

    if (!payload?.template || payload.template.trim().length < 3) {
      throw new Error("The biometric bridge did not return a usable fingerprint template");
    }

    return payload.template.trim();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("The fingerprint scanner did not answer before the capture timeout");
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};