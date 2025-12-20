import { useCallback, useEffect, useMemo, useState } from "react";

declare global {
  interface Window {
    cofhejs?: any;
    CoFHE?: any;
    Encryptable?: any;
    __COFHE_STATUS__?: string;
  }
}

type FHEStatus =
  | "booting"
  | "cdn-missing"
  | "cdn-loaded"
  | "needs-wallet"
  | "initializing"
  | "ready"
  | "mock"
  | "error";

type InitArgs = {
  provider: any;
  signer: any;
  environment?: "TESTNET" | "LOCAL" | "MAINNET";
};

function getCofheSdk(): any | null {
  // Prefer the official "cofhejs" namespace if present.
  if (window.cofhejs) return window.cofhejs;

  // Backwards compatibility if older code stored it here.
  if (window.CoFHE) return window.CoFHE;

  return null;
}

function getEncryptable(): any | null {
  return window.Encryptable ?? null;
}

export function useFHE() {
  const [status, setStatus] = useState<FHEStatus>("booting");
  const [error, setError] = useState<string | null>(null);

  const sdk = useMemo(() => getCofheSdk(), [status]);
  const Encryptable = useMemo(() => getEncryptable(), [status]);

  useEffect(() => {
    const hasCdn = window.__COFHE_STATUS__ === "loaded";
    const hasSdk = !!getCofheSdk();
    const hasEncryptable = !!getEncryptable();

    if (hasCdn && hasSdk && hasEncryptable) {
      setStatus("cdn-loaded");
      console.log("✅ CoFHE CDN is loaded and globals are available", {
        hasSdk,
        hasEncryptable,
      });
      return;
    }

    // CDN loader sets __COFHE_STATUS__ to "failed" on error.
    if (window.__COFHE_STATUS__ === "failed") {
      setStatus("cdn-missing");
      console.warn("⚠️ CoFHE CDN failed to load. App will use mock mode.");
      return;
    }

    // If neither loaded nor failed, keep booting briefly.
    setStatus("booting");
  }, []);

  const initWithEthers = useCallback(async (args: InitArgs) => {
    setError(null);

    const currentSdk = getCofheSdk();
    if (!currentSdk) {
      setStatus("mock");
      setError("CoFHE SDK is not available on window.");
      console.warn("⚠️ No CoFHE SDK found on window. Using mock mode.");
      return false;
    }

    if (!args?.provider || !args?.signer) {
      setStatus("needs-wallet");
      console.warn("🔌 Wallet/provider missing. CoFHE cannot initialize yet.");
      return false;
    }

    if (typeof currentSdk.initializeWithEthers !== "function") {
      setStatus("error");
      setError("initializeWithEthers is not available on the loaded SDK.");
      console.error("❌ Loaded SDK does not expose initializeWithEthers", {
        keys: Object.keys(currentSdk ?? {}),
      });
      return false;
    }

    try {
      setStatus("initializing");

      await currentSdk.initializeWithEthers({
        ethersProvider: args.provider,
        ethersSigner: args.signer,
        environment: args.environment ?? "TESTNET",
      });

      setStatus("ready");
      console.log("✅ CoFHE initialized successfully");
      return true;
    } catch (e: any) {
      setStatus("error");
      setError(e?.message ?? String(e));
      console.error("❌ CoFHE initialization failed", e);
      return false;
    }
  }, []);

  const encryptUint32 = useCallback(
    async (value: number, onState?: (s: string) => void) => {
      const currentSdk = getCofheSdk();
      const currentEncryptable = getEncryptable();

      // If not ready, fall back to mock behavior (but do NOT claim CDN failed).
      if (
        status !== "ready" ||
        !currentSdk ||
        typeof currentSdk.encrypt !== "function" ||
        !currentEncryptable ||
        typeof currentEncryptable.uint32 !== "function"
      ) {
        return { mode: "mock" as const, data: value };
      }

      const result = await currentSdk.encrypt(
        [currentEncryptable.uint32(value)],
        onState
      );

      const encrypted = result?.data?.[0];
      if (!encrypted) {
        throw new Error("Encryption returned empty result.data[0].");
      }

      return { mode: "cofhe" as const, data: encrypted };
    },
    [status]
  );

  return {
    status,
    error,
    sdk,
    Encryptable,
    initWithEthers,
    encryptUint32,
    isReady: status === "ready",
    isCdnLoaded: window.__COFHE_STATUS__ === "loaded",
  };
}
