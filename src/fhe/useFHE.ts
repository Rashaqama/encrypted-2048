import { useCallback, useEffect, useMemo, useState } from "react";

declare global {
  interface Window {
    cofhejs?: any;
    Encryptable?: any;
    CoFHE?: any;
    __COFHE_STATUS__?: string;
  }
}

type FHEStatus =
  | "booting"
  | "cdn-missing"
  | "cdn-loaded"
  | "needs-wallet"
  | "initializing"
  | "permit-required"
  | "ready"
  | "mock"
  | "error";

type InitArgs = {
  provider: any;
  signer: any;
  environment?: "TESTNET" | "LOCAL" | "MAINNET";
};

type PermitArgs = {
  issuer: string;
  name?: string;
  daysValid?: number;
};

function getCofheSdk(): any | null {
  if (window.cofhejs) return window.cofhejs;
  if (window.CoFHE) return window.CoFHE;
  return null;
}

function getEncryptable(): any | null {
  return window.Encryptable ?? null;
}

function safeClearCofheLocalStorage() {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const lk = k.toLowerCase();
      if (lk.includes("cofhe") || lk.includes("permit") || lk.includes("fhenix")) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Ignore storage errors (private mode, blocked, etc.)
  }
}

export function useFHE() {
  const [status, setStatus] = useState<FHEStatus>("booting");
  const [error, setError] = useState<string | null>(null);

  // Backwards-compatible flags expected by your existing home.tsx
  const initialized = true;

  const sdk = useMemo(() => getCofheSdk(), [status]);
  const Encryptable = useMemo(() => getEncryptable(), [status]);

  // A tiny client wrapper to keep your current game code working
  // (Your game logic uses client.encrypt32() and client.unseal() synchronously.)
  const client = useMemo(() => {
    return {
      encrypt32: (value: number) => {
        // Current game code expects sync behavior.
        // We keep it sync to avoid refactoring the whole game to async.
        // Real CoFHE encryption is async and will be used later when we refactor.
        return value;
      },
      unseal: (cipher: any) => {
        // If it's already a number (mock mode), return it.
        if (typeof cipher === "number") return cipher;

        // If in the future you store { __plain }, support it.
        if (cipher && typeof cipher === "object" && typeof cipher.__plain === "number") {
          return cipher.__plain;
        }

        // Fallback
        return 0;
      },
    };
  }, []);

  useEffect(() => {
    const cdnStatus = window.__COFHE_STATUS__;
    const hasSdk = !!getCofheSdk();
    const hasEncryptable = !!getEncryptable();

    if (cdnStatus === "failed") {
      setStatus("cdn-missing");
      return;
    }

    if (cdnStatus === "loaded" && hasSdk && hasEncryptable) {
      setStatus("cdn-loaded");
      return;
    }

    // If not sure yet, stay booting shortly.
    setStatus("booting");
  }, []);

  const initWithEthers = useCallback(async (args: InitArgs) => {
    setError(null);

    const currentSdk = getCofheSdk();
    if (!currentSdk) {
      setStatus("mock");
      setError("CoFHE SDK is not available on window.");
      return false;
    }

    if (!args?.provider || !args?.signer) {
      setStatus("needs-wallet");
      return false;
    }

    if (typeof currentSdk.initializeWithEthers !== "function") {
      setStatus("error");
      setError("initializeWithEthers is not available on the loaded SDK.");
      return false;
    }

    try {
      setStatus("initializing");

      const env = args.environment ?? "TESTNET";

      // Support both possible signatures:
      // - initializeWithEthers({ ... })
      // - initializeWithEthers(provider, signer, env, ...)
      if (currentSdk.initializeWithEthers.length >= 2) {
        await currentSdk.initializeWithEthers(args.provider, args.signer, env, false);
      } else {
        const result = await currentSdk.initializeWithEthers({
          provider: args.provider,
          signer: args.signer,
          ethersProvider: args.provider,
          ethersSigner: args.signer,
          environment: env,
          generatePermit: false,
        });

        // Some versions return { success, error }
        if (result && typeof result === "object" && "success" in result && result.success === false) {
          throw new Error(result.error ?? "initializeWithEthers failed");
        }
      }

      setStatus("permit-required");
      return true;
    } catch (e: any) {
      setStatus("error");
      setError(e?.message ?? String(e));
      return false;
    }
  }, []);

  const createSelfPermit = useCallback(async (args: PermitArgs) => {
    setError(null);

    const currentSdk = getCofheSdk();
    if (!currentSdk) {
      setStatus("mock");
      setError("CoFHE SDK is not available on window.");
      return false;
    }

    if (typeof currentSdk.createPermit !== "function") {
      setStatus("error");
      setError("createPermit is not available on the loaded SDK.");
      return false;
    }

    try {
      const days = args.daysValid ?? 30;
      const expiration = Math.floor(Date.now() / 1000) + days * 24 * 60 * 60;

      const result = await currentSdk.createPermit({
        type: "self",
        issuer: args.issuer,
        name: args.name ?? "Encrypted 2048 Permit",
        expiration,
      });

      // Some versions return { success, error }
      if (result && typeof result === "object" && "success" in result && result.success === false) {
        throw new Error(result.error ?? "Permit creation failed");
      }

      setStatus("ready");
      return true;
    } catch (e: any) {
      // If permit fails, do NOT break the app. Just stay in permit-required and show error.
      setStatus("permit-required");
      setError(e?.message ?? String(e));
      return false;
    }
  }, []);

  const resetPermit = useCallback(() => {
    safeClearCofheLocalStorage();
    setError(null);

    // If CDN is loaded, go back to cdn-loaded. Otherwise fallback to mock.
    if (window.__COFHE_STATUS__ === "loaded" && getCofheSdk() && getEncryptable()) {
      setStatus("cdn-loaded");
    } else {
      setStatus("mock");
    }
  }, []);

  return {
    // Current API
    status,
    error,
    sdk,
    Encryptable,
    initWithEthers,
    createSelfPermit,
    resetPermit,

    // Backwards-compatible API used by your current home.tsx
    client,
    initialized,
  };
}
