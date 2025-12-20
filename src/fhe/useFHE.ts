import { useCallback, useEffect, useMemo, useState } from "react";

declare global {
  interface Window {
    cofhejs?: any;
    CoFHE?: any;
    Encryptable?: any;
    FheTypes?: any;
    __COFHE_STATUS__?: string;
  }
}

type FHEStatus =
  | "booting"
  | "cdn-missing"
  | "cdn-loaded"
  | "needs-wallet"
  | "initializing"
  | "permit-needed"
  | "ready"
  | "mock"
  | "error";

type InitArgs = {
  provider: any;
  signer: any;
  issuer?: string;
  environment?: "TESTNET" | "LOCAL" | "MAINNET";
};

function getCofhejs(): any | null {
  if (window.cofhejs) return window.cofhejs;
  if (window.CoFHE?.cofhejs) return window.CoFHE.cofhejs;
  return null;
}

function getEncryptable(): any | null {
  if (window.Encryptable) return window.Encryptable;
  if (window.CoFHE?.Encryptable) return window.CoFHE.Encryptable;
  return null;
}

function getFheTypes(): any | null {
  if (window.FheTypes) return window.FheTypes;
  if (window.CoFHE?.FheTypes) return window.CoFHE.FheTypes;
  return null;
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: number | undefined;

  const timeout = new Promise<T>((_, reject) => {
    t = window.setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
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
  const [hasPermit, setHasPermit] = useState(false);

  const cofhejs = useMemo(() => getCofhejs(), [status]);
  const Encryptable = useMemo(() => getEncryptable(), [status]);
  const FheTypes = useMemo(() => getFheTypes(), [status]);

  // Detect CDN readiness (do not block UI forever)
  useEffect(() => {
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;

      const cdnStatus = window.__COFHE_STATUS__;
      const hasSdk = !!getCofhejs();
      const hasEnc = !!getEncryptable();

      if (cdnStatus === "loaded") {
        setStatus("cdn-loaded");
        if (hasSdk && hasEnc) {
          console.log("✅ CoFHE CDN is loaded and globals are available", {
            hasSdk: true,
            hasEncryptable: true,
          });
        } else {
          console.warn("⚠️ CoFHE CDN loaded but globals are incomplete", {
            hasSdk,
            hasEncryptable: hasEnc,
          });
        }
        return;
      }

      if (cdnStatus === "failed") {
        setStatus("cdn-missing");
        console.warn("⚠️ CoFHE CDN failed to load. App can use mock mode.");
        return;
      }

      setStatus("booting");
      window.setTimeout(tick, 200);
    };

    tick();
    return () => {
      cancelled = true;
    };
  }, []);

  // Step 1: Initialize cofhejs (no automatic permit prompt)
  const initCoFHE = useCallback(async (args: InitArgs) => {
    setError(null);

    const sdk = getCofhejs();
    if (!sdk) {
      setStatus("mock");
      setError("cofhejs SDK is not available on window.");
      return false;
    }

    if (!args?.provider || !args?.signer) {
      setStatus("needs-wallet");
      return false;
    }

    if (typeof sdk.initializeWithEthers !== "function") {
      setStatus("mock");
      setError("initializeWithEthers is not available on cofhejs SDK.");
      return false;
    }

    try {
      setStatus("initializing");

      await withTimeout(
        sdk.initializeWithEthers({
          ethersProvider: args.provider,
          ethersSigner: args.signer,
          environment: args.environment ?? "TESTNET",
          generatePermit: false,
        }),
        20000,
        "cofhejs.initializeWithEthers"
      );

      setStatus("permit-needed");
      console.log("✅ cofhejs initialized (permit not generated yet)");
      return true;
    } catch (e: any) {
      setStatus("mock");
      setError(e?.message ?? String(e));
      console.error("❌ cofhejs init failed; switching to mock mode", e);
      return false;
    }
  }, []);

  // Step 2: Create permit manually (button-driven UX)
  const generatePermit = useCallback(async (issuer: string) => {
    setError(null);

    const sdk = getCofhejs();
    if (!sdk || typeof sdk.createPermit !== "function") {
      setStatus("mock");
      setError("createPermit is not available on cofhejs SDK.");
      return false;
    }

    try {
      setStatus("permit-needed");

      // 24 hours expiration (recommended in docs)
      const expiration = Math.round(Date.now() / 1000) + 24 * 60 * 60;

      const result = await withTimeout(
        sdk.createPermit({
          type: "self",
          name: "Encrypted 2048",
          issuer,
          expiration,
        }),
        20000,
        "cofhejs.createPermit"
      );

      if (result && typeof result === "object" && "success" in result) {
        if (!result.success) {
          throw new Error(result.error || "Permit creation failed");
        }
      }

      setHasPermit(true);
      setStatus("ready");
      console.log("✅ Permit generated successfully");
      return true;
    } catch (e: any) {
      setHasPermit(false);
      setStatus("permit-needed");
      setError(e?.message ?? String(e));
      console.error("❌ Permit generation failed", e);
      return false;
    }
  }, []);

  // A compatibility client for your game logic
  const client = useMemo(() => {
    const sdk = getCofhejs();
    const enc = getEncryptable();
    const types = getFheTypes();

    const mock = {
      encrypt32: (v: number) => v,
      unseal: (x: any) => Number(x ?? 0),
    };

    if (status !== "ready" || !sdk || !enc || !types) {
      return mock;
    }

    return {
      encrypt32: async (v: number, onState?: (s: string) => void) => {
        const out = await sdk.encrypt([enc.uint32(BigInt(v))], onState);
        return out?.data?.[0];
      },
      unseal: async (encryptedHandle: any) => {
        // Decrypt encrypted handle off-chain (requires permit)
        const res = await sdk.decrypt(encryptedHandle, types.Uint32);
        if (res && typeof res === "object" && "success" in res) {
          if (!res.success) throw new Error(res.error || "Decrypt failed");
          return Number(res.data);
        }
        return Number(res);
      },
    };
  }, [status]);

  return {
    status,
    error,
    cofhejs,
    Encryptable,
    FheTypes,
    hasPermit,
    initCoFHE,
    generatePermit,
    client,
    initialized: status === "ready",
    isCdnLoaded: window.__COFHE_STATUS__ === "loaded",
  };
}
