import { useCallback, useEffect, useMemo, useRef, useState } from "react";

declare global {
  interface Window {
    cofhejs?: any;
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
  | "permit-required"
  | "ready"
  | "mock"
  | "error";

type InitArgs = {
  provider: any;
  signer: any;
  environment?: "TESTNET" | "LOCAL" | "MAINNET";
};

type PermitState = {
  issuer: string;
  hash: string;
  raw: any;
} | null;

function getSdk(): any | null {
  return window.cofhejs ?? null;
}

function getEncryptable(): any | null {
  return window.Encryptable ?? null;
}

function isResultShape(x: any): x is { success: boolean; data?: any; error?: any } {
  return !!x && typeof x === "object" && typeof x.success === "boolean";
}

function safeErrorMessage(e: any): string {
  return e?.message ?? (typeof e === "string" ? e : JSON.stringify(e));
}

export function useFHE() {
  const [status, setStatus] = useState<FHEStatus>("booting");
  const [error, setError] = useState<string | null>(null);

  const [permit, setPermit] = useState<PermitState>(null);

  // We store plaintext alongside encrypted payloads so the game can run client-side.
  // This does not expose plaintext in UI, but allows deterministic gameplay logic.
  const plainStoreRef = useRef(new WeakMap<object, number>());

  const sdk = useMemo(() => getSdk(), [status]);
  const Encryptable = useMemo(() => getEncryptable(), [status]);

  const hasCdnGlobals = useMemo(() => {
    const hasCdnFlag = window.__COFHE_STATUS__ === "loaded";
    return hasCdnFlag && !!getSdk() && !!getEncryptable();
  }, []);

  useEffect(() => {
    const hasCdnFlag = window.__COFHE_STATUS__ === "loaded";
    const hasSdk = !!getSdk();
    const hasEnc = !!getEncryptable();

    if (hasCdnFlag && hasSdk && hasEnc) {
      setStatus("cdn-loaded");
      return;
    }

    if (window.__COFHE_STATUS__ === "failed") {
      setStatus("cdn-missing");
      setError("CoFHE CDN failed to load. Using mock mode.");
      return;
    }

    setStatus("booting");
  }, []);

  const initWithEthers = useCallback(async (args: InitArgs) => {
    setError(null);

    const currentSdk = getSdk();
    if (!currentSdk) {
      setStatus("mock");
      setError("CoFHE SDK is not available on window.");
      return false;
    }

    if (!args?.provider || !args?.signer) {
      setStatus("needs-wallet");
      setError("Wallet/provider missing.");
      return false;
    }

    if (typeof currentSdk.initializeWithEthers !== "function") {
      setStatus("error");
      setError("initializeWithEthers is not available on the loaded SDK.");
      return false;
    }

    try {
      setStatus("initializing");

      // IMPORTANT: Use a single object param (new API style).
      // Also disable auto-permit generation so we can control it from UI.
      const initPayload = {
        // Newer docs naming
        ethersProvider: args.provider,
        ethersSigner: args.signer,

        // Back-compat naming (some builds use these)
        provider: args.provider,
        signer: args.signer,

        environment: args.environment ?? "TESTNET",
        generatePermit: false,
      };

      const res = await currentSdk.initializeWithEthers(initPayload);

      if (isResultShape(res) && !res.success) {
        setStatus("error");
        setError(res?.error?.message ?? JSON.stringify(res.error ?? res));
        return false;
      }

      // If it doesn't return a Result object, treat it as success if no exception.
      setStatus(permit ? "ready" : "permit-required");
      return true;
    } catch (e: any) {
      setStatus("error");
      setError(safeErrorMessage(e));
      return false;
    }
  }, [permit]);

  const createSelfPermit = useCallback(async (issuer: string) => {
    setError(null);

    const currentSdk = getSdk();
    if (!currentSdk || typeof currentSdk.createPermit !== "function") {
      setStatus("mock");
      setError("createPermit is not available on the loaded SDK.");
      return false;
    }

    try {
      // Docs-style: createPermit({ type: 'self', issuer })
      const res = await currentSdk.createPermit({ type: "self", issuer });

      if (isResultShape(res) && !res.success) {
        setStatus("error");
        setError(res?.error?.message ?? JSON.stringify(res.error ?? res));
        return false;
      }

      const p = isResultShape(res) ? res.data : res;

      const permitIssuer = p?.issuer ?? p?.data?.issuer ?? issuer;
      const hashFn = p?.getHash ?? p?.data?.getHash;

      const permitHash =
        typeof hashFn === "function" ? String(hashFn.call(p?.data ?? p)) : "";

      setPermit({
        issuer: String(permitIssuer),
        hash: String(permitHash),
        raw: p,
      });

      setStatus("ready");
      return true;
    } catch (e: any) {
      setStatus("error");
      setError(safeErrorMessage(e));
      return false;
    }
  }, []);

  const resetPermit = useCallback(() => {
    setPermit(null);
    // If CDN is available, go back to "cdn-loaded" so UI can re-init.
    if (hasCdnGlobals) {
      setStatus("cdn-loaded");
      setError(null);
    } else {
      setStatus("mock");
      setError(null);
    }
  }, [hasCdnGlobals]);

  const client = useMemo(() => {
    const currentSdk = getSdk();
    const currentEnc = getEncryptable();

    const encrypt32 = (value: number) => {
      // Always allow mock encryption so the game never blocks.
      if (!currentSdk || !currentEnc || status !== "ready") {
        return value;
      }

      // Some SDKs require bigint, keep it safe.
      const encValue = currentEnc.uint32(BigInt(value));

      // We return a wrapper object so we can keep plaintext for local gameplay.
      // The actual encrypted payload is stored under "__cipher".
      const wrapper: any = { __cipher: encValue };
      plainStoreRef.current.set(wrapper, value);
      return wrapper;
    };

    const unseal = (maybeEncrypted: any) => {
      if (maybeEncrypted == null) return 0;
      if (typeof maybeEncrypted === "number") return maybeEncrypted;

      if (typeof maybeEncrypted === "object") {
        const v = plainStoreRef.current.get(maybeEncrypted);
        if (typeof v === "number") return v;
      }

      // Fallback: unknown shape
      return 0;
    };

    return {
      mode: status === "ready" ? "cofhe" : "mock",
      encrypt32,
      unseal,
    };
  }, [status]);

  return {
    client,
    initialized: true, // Always true so the game UI never shows a blank screen
    status,
    error,
    initWithEthers,
    createSelfPermit,
    resetPermit,
  };
}
