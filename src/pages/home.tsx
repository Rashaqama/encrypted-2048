import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserProvider, Contract } from "ethers";
import { useFHE } from "../fhe/useFHE";
import {
  CIPHER_ACHIEVEMENTS_ADDRESS,
  CIPHER_ACHIEVEMENTS_ABI,
} from "../lib/cipherAchievements";

declare global {
  interface Window {
    ethereum?: any;
  }
}

type Direction = "left" | "right" | "up" | "down";

type Tile =
  | { mode: "mock"; data: number }
  | { mode: "cofhe"; data: bigint };

type Achievement = {
  id: "medium" | "big" | "legendary";
  title: string;
  description: string;
  threshold: number;
  levelIndex: number;
};

const BASE_SEPOLIA_CHAIN_ID = 84532;
const ARB_SEPOLIA_CHAIN_ID = 421614;

const BASE_SEPOLIA_HEX = "0x14a34";
const ARB_SEPOLIA_HEX = "0x66eee";

const ACHIEVEMENTS: Achievement[] = [
  {
    id: "medium",
    title: "Medium Power Unlocked",
    description: "You reached a Medium-level encrypted tile for the first time.",
    threshold: 128,
    levelIndex: 0,
  },
  {
    id: "big",
    title: "Big Power Unlocked",
    description: "You reached a Big-level encrypted tile for the first time.",
    threshold: 512,
    levelIndex: 1,
  },
  {
    id: "legendary",
    title: "Legendary Power",
    description: "You reached a Legendary-level encrypted tile. Insane!",
    threshold: 2048,
    levelIndex: 2,
  },
];

function shortAddr(addr: string) {
  return addr.slice(0, 5) + "..." + addr.slice(-4);
}

async function switchChain(chainIdHex: string) {
  const eth = window.ethereum;
  if (!eth?.request) throw new Error("Wallet does not support chain switching.");

  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
    return;
  } catch (e: any) {
    if (e?.code !== 4902) throw e;
  }

  if (chainIdHex === BASE_SEPOLIA_HEX) {
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: BASE_SEPOLIA_HEX,
          chainName: "Base Sepolia",
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://sepolia.base.org"],
          blockExplorerUrls: ["https://sepolia.basescan.org"],
        },
      ],
    });
    return;
  }

  if (chainIdHex === ARB_SEPOLIA_HEX) {
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: ARB_SEPOLIA_HEX,
          chainName: "Arbitrum Sepolia",
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://sepolia-rollup.arbitrum.io/rpc"],
          blockExplorerUrls: ["https://sepolia.arbiscan.io"],
        },
      ],
    });
    return;
  }

  throw new Error("Unknown chain config for addEthereumChain.");
}

function emptyBoard(): (Tile | null)[][] {
  return Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => null));
}

function emptyPlainBoard(): (number | null)[][] {
  return Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => null));
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function clampNumber(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return n;
}

export default function Home() {
  const { status: fheStatus, error: fheError, enableFHE, encryptUint32, unsealUint32, resetPermit } = useFHE();

  const [board, setBoard] = useState<(Tile | null)[][]>(() => emptyBoard());
  const [score, setScore] = useState(0);

  const [walletAccount, setWalletAccount] = useState<string | null>(null);
  const [walletProvider, setWalletProvider] = useState<BrowserProvider | null>(null);
  const [walletSigner, setWalletSigner] = useState<any | null>(null);

  const [claimed, setClaimed] = useState<Record<string, boolean>>({});
  const [unlocked, setUnlocked] = useState<Record<string, boolean>>({});
  const [txMessage, setTxMessage] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);

  const movingRef = useRef(false);

  const footerText = useMemo(() => "Made with love by mora", []);

  const preventScrollKeys = useCallback((e: KeyboardEvent) => {
    const keys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "];
    if (keys.includes(e.key)) e.preventDefault();
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", preventScrollKeys, { passive: false });
    return () => window.removeEventListener("keydown", preventScrollKeys as any);
  }, [preventScrollKeys]);

  const connectWallet = useCallback(async () => {
    setTxMessage(null);

    const eth = window.ethereum;
    if (!eth?.request) {
      setTxMessage("No wallet detected. Please install a wallet extension.");
      return;
    }

    const provider = new BrowserProvider(eth);
    await provider.send("eth_requestAccounts", []);

    const signer = await provider.getSigner();
    const addr = await signer.getAddress();

    setWalletProvider(provider);
    setWalletSigner(signer);
    setWalletAccount(addr);

    const net = await provider.getNetwork();
    if (Number(net.chainId) !== BASE_SEPOLIA_CHAIN_ID) {
      try {
        await switchChain(BASE_SEPOLIA_HEX);
      } catch {
        // ignore
      }
    }
  }, []);

  const disconnectWallet = useCallback(() => {
    setWalletProvider(null);
    setWalletSigner(null);
    setWalletAccount(null);
    setTxMessage(null);
  }, []);

  const addRandomTile = useCallback(
    async (b: (Tile | null)[][]) => {
      const empties: { r: number; c: number }[] = [];
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          if (!b[r][c]) empties.push({ r, c });
        }
      }
      if (empties.length === 0) return b;

      const { r, c } = randomChoice(empties);
      const value = Math.random() < 0.9 ? 2 : 4;
      const enc = await encryptUint32(value);

      const next = b.map((row) => row.slice());
      next[r][c] = enc;
      return next;
    },
    [encryptUint32]
  );

  const unsealTile = useCallback(
    async (t: Tile | null) => {
      if (!t) return null;
      if (t.mode === "mock") return t.data;

      const res = await unsealUint32(t.data);
      if (!res.ok) throw new Error(res.error);
      return res.value;
    },
    [unsealUint32]
  );

  const sealValue = useCallback(
    async (v: number | null): Promise<Tile | null> => {
      if (v === null) return null;
      return await encryptUint32(v);
    },
    [encryptUint32]
  );

  const bootGame = useCallback(async () => {
    setScore(0);
    setTxMessage(null);

    let b = emptyBoard();
    b = await addRandomTile(b);
    b = await addRandomTile(b);
    setBoard(b);
  }, [addRandomTile]);

  useEffect(() => {
    void bootGame();
  }, [bootGame]);

  function rotateRight(mat: (number | null)[][]) {
    const out = emptyPlainBoard();
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        out[c][3 - r] = mat[r][c];
      }
    }
    return out;
  }

  function slideRowLeft(row: (number | null)[]) {
    const filtered = row.filter((x) => x !== null) as number[];
    const out: (number | null)[] = [];
    let gained = 0;

    for (let i = 0; i < filtered.length; i++) {
      if (i < filtered.length - 1 && filtered[i] === filtered[i + 1]) {
        const merged = filtered[i] * 2;
        out.push(merged);
        gained += merged;
        i++;
      } else {
        out.push(filtered[i]);
      }
    }

    while (out.length < 4) out.push(null);
    return { row: out, gained };
  }

  const refreshUnlocks = useCallback(async () => {
    try {
      let maxV = 0;
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          const v = await unsealTile(board[r][c]);
          const n = clampNumber(v);
          if (typeof n === "number" && n > maxV) maxV = n;
        }
      }

      const next: Record<string, boolean> = {};
      for (const ach of ACHIEVEMENTS) {
        next[ach.id] = maxV >= ach.threshold;
      }
      setUnlocked(next);
    } catch {
      // If unseal fails (no permit), do not crash UI
    }
  }, [board, unsealTile]);

  const upgradeBoardToCofhe = useCallback(async () => {
    // Once FHE is ready, re-encrypt all mock tiles so board becomes fully encrypted
    const next = emptyBoard();
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const t = board[r][c];
        if (!t) {
          next[r][c] = null;
          continue;
        }

        if (t.mode === "cofhe") {
          next[r][c] = t;
          continue;
        }

        next[r][c] = await encryptUint32(t.data);
      }
    }
    setBoard(next);
  }, [board, encryptUint32]);

  useEffect(() => {
    if (fheStatus === "ready") {
      void upgradeBoardToCofhe().then(() => refreshUnlocks());
    }
  }, [fheStatus, upgradeBoardToCofhe, refreshUnlocks]);

  const move = useCallback(
    async (dir: Direction) => {
      if (movingRef.current) return;
      movingRef.current = true;

      try {
        const plain = emptyPlainBoard();
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 4; c++) {
            plain[r][c] = await unsealTile(board[r][c]);
          }
        }

        let working = plain;
        const rotateTimes = dir === "left" ? 0 : dir === "up" ? 3 : dir === "right" ? 2 : 1;
        for (let k = 0; k < rotateTimes; k++) working = rotateRight(working);

        let gainedTotal = 0;
        const slid = working.map((row) => {
          const { row: nextRow, gained } = slideRowLeft(row);
          gainedTotal += gained;
          return nextRow;
        });

        let restored = slid;
        for (let k = 0; k < (4 - rotateTimes) % 4; k++) restored = rotateRight(restored);

        const changed = JSON.stringify(restored) !== JSON.stringify(plain);
        if (!changed) return;

        const sealed = emptyBoard();
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 4; c++) {
            sealed[r][c] = await sealValue(restored[r][c]);
          }
        }

        const withNewTile = await addRandomTile(sealed);

        setBoard(withNewTile);
        setScore((s) => s + gainedTotal);
      } catch (e: any) {
        console.error("Move failed:", e);
      } finally {
        movingRef.current = false;
      }
    },
    [board, addRandomTile, sealValue, unsealTile]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp") void move("up");
      if (e.key === "ArrowDown") void move("down");
      if (e.key === "ArrowLeft") void move("left");
      if (e.key === "ArrowRight") void move("right");
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [move]);

  useEffect(() => {
    void refreshUnlocks();
  }, [board, refreshUnlocks]);

  const onEnableFHE = useCallback(async () => {
    setTxMessage(null);

    if (!walletProvider || !walletSigner || !walletAccount) {
      setTxMessage("Connect wallet first.");
      return;
    }

    try {
      // 1) Switch to Arbitrum Sepolia for permit generation (Fhenix testnet)
      await switchChain(ARB_SEPOLIA_HEX);

      // 2) Enable FHE + create permit
      const ok = await enableFHE({
        provider: walletProvider,
        signer: walletSigner,
        environment: "TESTNET",
      });

      if (!ok) {
        setTxMessage("FHE enable failed. Check the error above.");
      } else {
        setTxMessage("FHE enabled (permit generated).");
      }

      // 3) Switch back to Base Sepolia for NFT minting
      await switchChain(BASE_SEPOLIA_HEX);
    } catch (e: any) {
      setTxMessage(e?.message ?? String(e));
    }
  }, [walletProvider, walletSigner, walletAccount, enableFHE]);

  const resetGame = useCallback(() => {
    void bootGame();
  }, [bootGame]);

  const claimNft = useCallback(
    async (ach: Achievement) => {
      setTxMessage(null);

      if (!walletProvider || !walletSigner || !walletAccount) {
        setTxMessage("Connect wallet first.");
        return;
      }

      try {
        setIsClaiming(true);

        const net = await walletProvider.getNetwork();
        if (Number(net.chainId) !== BASE_SEPOLIA_CHAIN_ID) {
          await switchChain(BASE_SEPOLIA_HEX);
        }

        // Require unlock based on decrypted max (permit needed)
        if (!unlocked[ach.id]) {
          setTxMessage("Not unlocked yet (enable FHE and reach the threshold).");
          return;
        }

        const contract = new Contract(
          CIPHER_ACHIEVEMENTS_ADDRESS,
          CIPHER_ACHIEVEMENTS_ABI,
          walletSigner
        );

        const canClaim: boolean = await contract.canClaim(walletAccount, ach.levelIndex);
        if (!canClaim) {
          setTxMessage("Not claimable (already claimed or not eligible).");
          return;
        }

        const tx = await contract.mintAchievement(ach.levelIndex);
        setTxMessage("Transaction sent. Waiting for confirmation...");
        await tx.wait();

        setClaimed((m) => ({ ...m, [ach.id]: true }));
        setTxMessage("Mint successful!");
      } catch (e: any) {
        setTxMessage(e?.shortMessage ?? e?.message ?? String(e));
      } finally {
        setIsClaiming(false);
      }
    },
    [walletProvider, walletSigner, walletAccount, unlocked]
  );

  const cellClass = "w-[74px] h-[74px] rounded-xl bg-slate-100 shadow-inner";
  const tileClass = "w-[74px] h-[74px] rounded-xl bg-slate-700";

  return (
    <div className="h-[100dvh] overflow-hidden bg-white">
      <div className="mx-auto max-w-[860px] px-4 py-6 h-full flex flex-col min-h-0">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight">Encrypted 2048 - test</h1>
          <div className="text-slate-500 mt-1">Score: {score}</div>
        </div>

        <div className="mt-4 flex flex-col gap-3 flex-1 min-h-0">
          <div className="border rounded-xl p-4 flex items-start justify-between gap-4">
            <div className="min-w-[220px]">
              <div className="font-semibold">FHE Access</div>
              <div className="text-xs text-slate-500 mt-1">Status: {fheStatus}</div>
              {fheError ? <div className="text-xs text-red-600 mt-1">{String(fheError)}</div> : null}
              {txMessage ? <div className="text-xs text-slate-700 mt-1">{txMessage}</div> : null}
              {walletAccount ? (
                <div className="text-xs text-slate-500 mt-2">Wallet: {shortAddr(walletAccount)}</div>
              ) : (
                <div className="text-xs text-slate-500 mt-2">Wallet: not connected</div>
              )}
            </div>

            <div className="flex flex-col items-end gap-2">
              {!walletAccount ? (
                <button
                  onClick={() => void connectWallet()}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold"
                >
                  Connect wallet
                </button>
              ) : (
                <div className="flex gap-2 flex-wrap justify-end">
                  <button
                    onClick={() => void onEnableFHE()}
                    disabled={fheStatus === "initializing" || fheStatus === "ready"}
                    className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold disabled:opacity-50"
                  >
                    Enable FHE (Generate Permit)
                  </button>

                  <button
                    onClick={() => resetPermit()}
                    className="px-4 py-2 rounded-lg border text-sm font-semibold"
                  >
                    Reset Permit
                  </button>

                  <button
                    onClick={() => resetGame()}
                    className="px-4 py-2 rounded-lg border text-sm font-semibold"
                  >
                    Reset Game
                  </button>

                  <button
                    onClick={() => disconnectWallet()}
                    className="px-4 py-2 rounded-lg border text-sm font-semibold"
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col items-center gap-4">
            <div className="p-4 rounded-2xl bg-white shadow-2xl">
              <div className="grid grid-cols-4 gap-3">
                {board.flatMap((row, r) =>
                  row.map((cell, c) => {
                    const hasTile = !!cell;
                    return (
                      <div key={`${r}-${c}`} className={cellClass}>
                        {hasTile ? <div className={tileClass} /> : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="flex flex-col items-center gap-3">
              <button
                onClick={() => void move("up")}
                className="px-14 py-3 rounded-lg bg-slate-900 text-white font-semibold"
              >
                Up
              </button>
              <div className="flex gap-3">
                <button
                  onClick={() => void move("left")}
                  className="px-14 py-3 rounded-lg bg-slate-900 text-white font-semibold"
                >
                  Left
                </button>
                <button
                  onClick={() => void move("down")}
                  className="px-14 py-3 rounded-lg bg-slate-900 text-white font-semibold"
                >
                  Down
                </button>
                <button
                  onClick={() => void move("right")}
                  className="px-14 py-3 rounded-lg bg-slate-900 text-white font-semibold"
                >
                  Right
                </button>
              </div>
            </div>
          </div>

          <div className="border rounded-xl p-4 flex-1 min-h-0 overflow-hidden">
            <div className="font-semibold text-sm">FHE Achievements (on-chain ready)</div>
            <div className="text-xs text-slate-500 mt-1">
              Mint happens on Base Sepolia (CipherAchievements).
            </div>

            <div className="mt-3 h-full overflow-auto pr-2">
              <div className="flex flex-col gap-3">
                {ACHIEVEMENTS.map((ach) => {
                  const isDone = !!claimed[ach.id];
                  const isUnlocked = !!unlocked[ach.id];

                  return (
                    <div
                      key={ach.id}
                      className="border rounded-xl p-3 flex items-center justify-between gap-3"
                    >
                      <div className="flex flex-col gap-1">
                        <div className="text-sm font-semibold">{ach.title}</div>
                        <div className="text-xs text-slate-600">{ach.description}</div>
                        <div className="text-[11px] text-slate-500">
                          Threshold: value ≥ {ach.threshold}
                        </div>
                      </div>

                      <div className="flex items-end flex-col gap-2">
                        <div className="text-[11px] text-slate-500">
                          {isDone ? "Claimed" : isUnlocked ? "Unlocked" : "Locked"}
                        </div>
                        <button
                          onClick={() => void claimNft(ach)}
                          disabled={isClaiming || isDone || !walletAccount || !isUnlocked}
                          className="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold disabled:opacity-50"
                        >
                          {isDone ? "Minted" : "Claim NFT"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="pt-2">
          <div className="text-center text-xs text-slate-400">{footerText}</div>
        </div>
      </div>
    </div>
  );
}
