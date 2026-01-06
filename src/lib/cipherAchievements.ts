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

type EnableArgs = {
  provider: any;
  signer: any;
  environment?: "TESTNET" | "LOCAL" | "MAINNET";
};

function getSdk(): any | null {
  // Prefer cofhejs if the loader exposes it
  if (window.cofhejs) return window.cofhejs;

  // Fallback if loader exposed only CoFHE
  if (window.CoFHE) return window.CoFHE;

  return null;
}

function getEncryptable(): any | null {
  return window.Encryptable ?? null;
}

export function useFHE() {
  const [status, setStatus] = useState<FHEStatus>("booting");
  const [error, setError] = useState<string | null>(null);

  const sdk = useMemo(() => getSdk(), [status]);
  const Encryptable = useMemo(() => getEncryptable(), [status]);

  useEffect(() => {
    const cdnStatus = window.__COFHE_STATUS__;

    if (cdnStatus === "failed") {
      setStatus("cdn-missing");
      setError("CoFHE CDN failed to load.");
      return;
    }

    const hasSdk = !!getSdk();
    const hasEncryptable = !!getEncryptable();

    if (cdnStatus === "loaded" && hasSdk && hasEncryptable) {
      setStatus("cdn-loaded");
      return;
    }

    setStatus("booting");
  }, []);

  const enableFHE = useCallback(async (args: EnableArgs) => {
    setError(null);

    const currentSdk = getSdk();
    const currentEncryptable = getEncryptable();

    if (!currentSdk || !currentEncryptable) {
      setStatus("mock");
      setError("CoFHE SDK globals are not available. Using mock mode.");
      return false;
    }

    if (!args?.provider || !args?.signer) {
      setStatus("needs-wallet");
      setError("Wallet/provider missing.");
      return false;
    }

    try {
      setStatus("initializing");

      // Initialize with ethers (newer API expects a single object)
      if (typeof currentSdk.initializeWithEthers === "function") {
        await currentSdk.initializeWithEthers({
          ethersProvider: args.provider,
          ethersSigner: args.signer,
          environment: args.environment ?? "TESTNET",
        });
      } else {
        throw new Error("initializeWithEthers is not available on the loaded SDK.");
      }

      // Create permit (required for unsealing/decryption)
      if (typeof currentSdk.createPermit === "function") {
        await currentSdk.createPermit();
      } else {
        // Some builds use different naming
        if (typeof currentSdk.generatePermit === "function") {
          await currentSdk.generatePermit();
        } else {
          throw new Error("Permit function not found (createPermit/generatePermit).");
        }
      }

      setStatus("ready");
      return true;
    } catch (e: any) {
      setStatus("error");
      setError(e?.message ?? String(e));
      return false;
    }
  }, []);

  const encryptUint32 = useCallback(async (value: number) => {
    const currentSdk = getSdk();
    const currentEncryptable = getEncryptable();

    if (
      status !== "ready" ||
      !currentSdk ||
      typeof currentSdk.encrypt !== "function" ||
      !currentEncryptable ||
      typeof currentEncryptable.uint32 !== "function"
    ) {
      return { mode: "mock" as const, data: value };
    }

    const result = await currentSdk.encrypt([currentEncryptable.uint32(value)]);
    const encrypted = result?.data?.[0];

    if (!encrypted) {
      // If encryption fails for any reason, keep app playable
      return { mode: "mock" as const, data: value };
    }

    return { mode: "cofhe" as const, data: encrypted as bigint };
  }, [status]);

  const unsealUint32 = useCallback(async (cipher: bigint) => {
    const currentSdk = getSdk();

    if (status !== "ready" || !currentSdk) {
      return { ok: false as const, error: "FHE is not ready (permit not available)." };
    }

    try {
      // Try common SDK shapes
      if (typeof currentSdk.unseal === "function") {
        const v = await currentSdk.unseal(cipher);
        return { ok: true as const, value: Number(v) };
      }

      if (typeof currentSdk.decrypt === "function") {
        const v = await currentSdk.decrypt(cipher);
        return { ok: true as const, value: Number(v) };
      }

      if (currentSdk.client && typeof currentSdk.client.unseal === "function") {
        const v = await currentSdk.client.unseal(cipher);
        return { ok: true as const, value: Number(v) };
      }

      return { ok: false as const, error: "No unseal/decrypt function found on SDK." };
    } catch (e: any) {
      return { ok: false as const, error: e?.message ?? String(e) };
    }
  }, [status]);

  const resetPermit = useCallback(() => {
    // Best-effort local reset (permit is stored inside SDK state)
    setStatus("cdn-loaded");
    setError(null);
  }, []);

  return {
    status,
    error,
    sdk,
    Encryptable,
    enableFHE,
    encryptUint32,
    unsealUint32,
    resetPermit,
  };
}
