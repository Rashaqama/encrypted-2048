import { useCallback, useEffect, useMemo, useState } from "react";

declare global {
  interface Window {
    // Loaded by index.html
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
  // Prefer explicit global
  if (window.cofhejs) return window.cofhejs;

  // If index.html exposed the full module as window.CoFHE, it may contain cofhejs
  if (window.CoFHE?.cofhejs) return window.CoFHE.cofhejs;

  return null;
}

function getEncryptable(): any | null {
  if (window.Encryptable) return window.Encryptable;
  if (window.CoFHE?.Encryptable) return window.CoFHE.Encryptable;
  return null;
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: number | undefined;

  const timeout = new Promise<T>((_, reject) => {
    t = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });

  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (t !== undefined) window.clearTimeout(t);
  }
}

export function useFHE() {
  const [status, setStatus] = useState<FHEStatus>("booting");
  const [error, setError] = useState<string | null>(null);

  const sdk = useMemo(() => getCofheSdk(), [status]);
  const Encryptable = useMemo(() => getEncryptable(), [status]);

  useEffect(() => {
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;

      const cdnStatus = window.__COFHE_STATUS__;
      const hasSdk = !!getCofheSdk();
      const hasEncryptable = !!getEncryptable();

      if (cdnStatus === "loaded") {
        if (hasSdk && hasEncryptable) {
          setStatus("cdn-loaded");
          console.log("✅ CoFHE CDN is loaded and globals are available", {
            hasSdk,
            hasEncryptable,
          });
        } else {
          // CDN loaded, but globals are incomplete; still treat as loaded
          setStatus("cdn-loaded");
          console.warn("⚠️ CoFHE CDN loaded, but some globals are missing", {
            hasSdk,
            hasEncryptable,
          });
        }
        return;
      }

      if (cdnStatus === "failed") {
        setStatus("cdn-missing");
        console.warn("⚠️ CoFHE CDN failed to load. App can use mock mode.");
        return;
      }

      // Keep booting until index.html finishes
      setStatus("booting");
      window.setTimeout(tick, 200);
    };

    tick();

    return () => {
      cancelled = true;
    };
  }, []);

  const initWithEthers = useCallback(async (args: InitArgs) => {
    setError(null);

    const currentSdk = getCofheSdk();
    if (!currentSdk) {
      setStatus("mock");
      setError("cofhejs SDK is not available on window.");
      console.warn("⚠️ cofhejs SDK not found. Using mock mode.");
      return false;
    }

    if (!args?.provider || !args?.signer) {
      setStatus("needs-wallet");
      console.warn("🔌 Wallet/provider missing. CoFHE cannot initialize yet.");
      return false;
    }

    if (typeof currentSdk.initializeWithEthers !== "function") {
      setStatus("mock");
      setError("initializeWithEthers is not available on cofhejs SDK.");
      console.error("❌ cofhejs SDK does not expose initializeWithEthers", {
        keys: Object.keys(currentSdk ?? {}),
      });
      return false;
    }

    try {
      setStatus("initializing");
      console.log("🔄 Initializing cofhejs...");

      await withTimeout(
        currentSdk.initializeWithEthers({
          ethersProvider: args.provider,
          ethersSigner: args.signer,
          environment: args.environment ?? "TESTNET",
        }),
        20000,
        "cofhejs.initializeWithEthers"
      );

      setStatus("ready");
      console.log("✅ CoFHE initialized successfully");
      return true;
    } catch (e: any) {
      // Never get stuck on loading
      setStatus("mock");
      setError(e?.message ?? String(e));
      console.error("❌ CoFHE initialization failed; switching to mock mode", e);
      return false;
    }
  }, []);

  const encryptUint32 = useCallback(
    async (value: number, onState?: (s: string) => void) => {
      const currentSdk = getCofheSdk();
      const currentEncryptable = getEncryptable();

      // If not ready, fall back to mock behavior
      if (
        status !== "ready" ||
        !currentSdk ||
        typeof currentSdk.encrypt !== "function" ||
        !currentEncryptable ||
        typeof currentEncryptable.uint32 !== "function"
      ) {
        return { mode: "mock" as const, data: value };
      }

      const result = await currentSdk.encrypt([currentEncryptable.uint32(value)], onState);

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
