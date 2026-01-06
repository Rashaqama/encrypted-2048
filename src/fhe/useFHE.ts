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
  | "permit-required"
  | "ready"
  | "mock"
  | "error";

type InitArgs = {
  provider: any;
  signer: any;
  environment?: "TESTNET" | "LOCAL" | "MAINNET";
};

type UnsealResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

const PERMIT_STORAGE_KEY = "cofhe_permit_v1";

function getSdk(): any | null {
  if (window.cofhejs) return window.cofhejs;
  if (window.CoFHE) return window.CoFHE;
  return null;
}

function getEncryptable(): any | null {
  return window.Encryptable ?? null;
}

function readStoredPermit(): any | null {
  try {
    const raw = localStorage.getItem(PERMIT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeStoredPermit(permit: any) {
  localStorage.setItem(PERMIT_STORAGE_KEY, JSON.stringify(permit));
}

function clearStoredPermit() {
  localStorage.removeItem(PERMIT_STORAGE_KEY);
}

export function useFHE() {
  const [status, setStatus] = useState<FHEStatus>("booting");
  const [error, setError] = useState<string | null>(null);

  const sdk = useMemo(() => getSdk(), [status]);
  const Encryptable = useMemo(() => getEncryptable(), [status]);

  useEffect(() => {
    const hasCdn = window.__COFHE_STATUS__ === "loaded";
    const hasSdk = !!getSdk();
    const hasEncryptable = !!getEncryptable();

    if (hasCdn && hasSdk && hasEncryptable) {
      setStatus("cdn-loaded");
      setError(null);
      return;
    }

    if (window.__COFHE_STATUS__ === "failed") {
      setStatus("cdn-missing");
      setError("CoFHE CDN failed to load.");
      return;
    }

    setStatus("booting");
  }, []);

  const resetPermit = useCallback(() => {
    clearStoredPermit();

    const s = getSdk();
    if (s && typeof s.setPermit === "function") {
      try {
        s.setPermit(null);
      } catch {
        // ignore
      }
    }

    setError(null);
    setStatus("cdn-loaded");
  }, []);

  const enableFHE = useCallback(
    async (args: InitArgs) => {
      setError(null);

      const s = getSdk();
      const e = getEncryptable();

      if (!s || !e) {
        setStatus("mock");
        setError("CoFHE SDK globals are not available.");
        return false;
      }

      if (!args?.provider || !args?.signer) {
        setStatus("needs-wallet");
        setError("Wallet provider/signer is missing.");
        return false;
      }

      if (typeof s.initializeWithEthers !== "function") {
        setStatus("error");
        setError("initializeWithEthers is not available on the loaded SDK.");
        return false;
      }

      try {
        setStatus("initializing");

        await s.initializeWithEthers({
          ethersProvider: args.provider,
          ethersSigner: args.signer,
          environment: args.environment ?? "TESTNET",
        });

        const stored = readStoredPermit();
        if (stored && typeof s.setPermit === "function") {
          try {
            s.setPermit(stored);
            setStatus("ready");
            return true;
          } catch {
            clearStoredPermit();
          }
        }

        if (typeof s.createPermit !== "function") {
          setStatus("permit-required");
          setError("SDK does not expose createPermit().");
          return false;
        }

        setStatus("permit-required");
        const permit = await s.createPermit();
        if (!permit) {
          setStatus("error");
          setError("createPermit() returned empty permit.");
          return false;
        }

        if (typeof s.setPermit === "function") {
          s.setPermit(permit);
        }

        writeStoredPermit(permit);

        setStatus("ready");
        return true;
      } catch (err: any) {
        setStatus("error");
        setError(err?.message ?? String(err));
        return false;
      }
    },
    []
  );

  const encryptUint32 = useCallback(
    async (value: number, onState?: (s: string) => void) => {
      const s = getSdk();
      const e = getEncryptable();

      if (
        status !== "ready" ||
        !s ||
        typeof s.encrypt !== "function" ||
        !e ||
        typeof e.uint32 !== "function"
      ) {
        return { mode: "mock" as const, data: value };
      }

      const res = await s.encrypt([e.uint32(value)], onState);
      const encrypted = res?.data?.[0];

      if (encrypted === undefined || encrypted === null) {
        return { mode: "mock" as const, data: value };
      }

      return { mode: "cofhe" as const, data: encrypted as any };
    },
    [status]
  );

  const unsealUint32 = useCallback(
    async (cipher: any): Promise<UnsealResult> => {
      const s = getSdk();

      if (status !== "ready" || !s) {
        return { ok: false, error: "FHE is not ready." };
      }

      try {
        if (typeof s.unseal === "function") {
          const v = await s.unseal(cipher);
          const n = Number(v);
          if (!Number.isFinite(n)) return { ok: false, error: "Unseal returned NaN." };
          return { ok: true, value: n };
        }

        if (typeof s.decrypt === "function") {
          const v = await s.decrypt(cipher);
          const n = Number(v);
          if (!Number.isFinite(n)) return { ok: false, error: "Decrypt returned NaN." };
          return { ok: true, value: n };
        }

        return { ok: false, error: "SDK does not expose unseal/decrypt." };
      } catch (err: any) {
        return { ok: false, error: err?.message ?? String(err) };
      }
    },
    [status]
  );

  return {
    status,
    error,
    sdk,
    Encryptable,
    enableFHE,
    resetPermit,
    encryptUint32,
    unsealUint32,
    isReady: status === "ready",
    isCdnLoaded: window.__COFHE_STATUS__ === "loaded",
  };
}
