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

type Tile = number;

type Achievement = {
  id: "medium" | "big" | "legendary";
  title: string;
  description: string;
  threshold: number;
  levelIndex: number;
};

const ARB_SEPOLIA_CHAIN_ID = 421614;
const ARB_SEPOLIA_HEX = "0x66eee";

const ACHIEVEMENTS: Achievement[] = [
  {
    id: "medium",
    title: "Medium Power Unlocked",
    description: "Reach an encrypted tile threshold for the first time.",
    threshold: 128,
    levelIndex: 0,
  },
  {
    id: "big",
    title: "Big Power Unlocked",
    description: "Reach a bigger encrypted tile threshold for the first time.",
    threshold: 512,
    levelIndex: 1,
  },
  {
    id: "legendary",
    title: "Legendary Power",
    description: "Reach the legendary tile threshold. Insane!",
    threshold: 2048,
    levelIndex: 2,
  },
];

function shortAddr(addr: string) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function emptyBoard(): (Tile | null)[][] {
  return Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => null));
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function rotateRight(mat: (number | null)[][]) {
  const out: (number | null)[][] = emptyBoard();
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

async function switchOrAddChain(chainIdHex: string) {
  const eth = window.ethereum;
  if (!eth?.request) throw new Error("No wallet provider found.");

  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
    return;
  } catch (e: any) {
    if (e?.code !== 4902) throw e;
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

function tileColorClass(v: number) {
  if (v >= 2048) return "bg-amber-500 text-white";
  if (v >= 1024) return "bg-orange-500 text-white";
  if (v >= 512) return "bg-violet-500 text-white";
  if (v >= 256) return "bg-emerald-500 text-white";
  if (v >= 128) return "bg-blue-500 text-white";
  if (v >= 64) return "bg-slate-700 text-white";
  if (v >= 32) return "bg-slate-600 text-white";
  if (v >= 16) return "bg-slate-500 text-white";
  if (v >= 8) return "bg-slate-400 text-white";
  if (v >= 4) return "bg-slate-300 text-slate-900";
  return "bg-slate-200 text-slate-900";
}

export default function Home() {
  const fhe = useFHE() as any;
  const fheStatus = fhe?.status ?? "unknown";
  const fheError = fhe?.error ?? null;
  const enableFHE = fhe?.enableFHE ?? fhe?.initWithEthers ?? null;
  const resetPermit = fhe?.resetPermit ?? null;

  const [board, setBoard] = useState<(Tile | null)[][]>(() => emptyBoard());
  const [score, setScore] = useState(0);

  const [walletAccount, setWalletAccount] = useState<string | null>(null);
  const [walletProvider, setWalletProvider] = useState<BrowserProvider | null>(null);
  const [walletSigner, setWalletSigner] = useState<any | null>(null);

  const [claimed, setClaimed] = useState<Record<string, boolean>>({});
  const [txMessage, setTxMessage] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);

  const movingRef = useRef(false);

  const preventScrollKeys = useCallback((e: KeyboardEvent) => {
    const keys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "];
    if (keys.includes(e.key)) e.preventDefault();
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", preventScrollKeys, { passive: false });
    return () => window.removeEventListener("keydown", preventScrollKeys as any);
  }, [preventScrollKeys]);

  const addRandomTile = useCallback((b: (Tile | null)[][]) => {
    const empties: { r: number; c: number }[] = [];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if (b[r][c] == null) empties.push({ r, c });
      }
    }
    if (empties.length === 0) return b;

    const { r, c } = randomChoice(empties);
    const value = Math.random() < 0.9 ? 2 : 4;

    const next = b.map((row) => row.slice());
    next[r][c] = value;
    return next;
  }, []);

  const bootGame = useCallback(() => {
    setScore(0);
    let b = emptyBoard();
    b = addRandomTile(b);
    b = addRandomTile(b);
    setBoard(b);
  }, [addRandomTile]);

  useEffect(() => {
    bootGame();
  }, [bootGame]);

  const maxPlainValue = useCallback(() => {
    let maxV = 0;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const v = board[r][c];
        if (typeof v === "number" && v > maxV) maxV = v;
      }
    }
    return maxV;
  }, [board]);

  const move = useCallback(
    (dir: Direction) => {
      if (movingRef.current) return;
      movingRef.current = true;

      try {
        let working = board.map((row) => row.slice()) as (number | null)[][];

        const rotateTimes =
          dir === "left" ? 0 : dir === "up" ? 3 : dir === "right" ? 2 : 1;
        for (let k = 0; k < rotateTimes; k++) working = rotateRight(working);

        let gainedTotal = 0;
        const slid = working.map((row) => {
          const { row: nextRow, gained } = slideRowLeft(row);
          gainedTotal += gained;
          return nextRow;
        });

        let restored = slid;
        for (let k = 0; k < (4 - rotateTimes) % 4; k++) restored = rotateRight(restored);

        const changed = JSON.stringify(restored) !== JSON.stringify(board);
        if (!changed) return;

        const withNewTile = addRandomTile(restored);

        setBoard(withNewTile);
        setScore((s) => s + gainedTotal);
      } finally {
        movingRef.current = false;
      }
    },
    [board, addRandomTile]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp") move("up");
      if (e.key === "ArrowDown") move("down");
      if (e.key === "ArrowLeft") move("left");
      if (e.key === "ArrowRight") move("right");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [move]);

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
    if (Number(net.chainId) !== ARB_SEPOLIA_CHAIN_ID) {
      try {
        await switchOrAddChain(ARB_SEPOLIA_HEX);
      } catch (e: any) {
        setTxMessage(e?.message ?? String(e));
      }
    }
  }, []);

  const disconnectWallet = useCallback(() => {
    setWalletProvider(null);
    setWalletSigner(null);
    setWalletAccount(null);
    setTxMessage(null);
    setClaimed({});
  }, []);

  const onEnableFHE = useCallback(async () => {
    setTxMessage(null);

    if (!walletProvider || !walletSigner) {
      setTxMessage("Connect wallet first.");
      return;
    }

    try {
      const net = await walletProvider.getNetwork();
      if (Number(net.chainId) !== ARB_SEPOLIA_CHAIN_ID) {
        await switchOrAddChain(ARB_SEPOLIA_HEX);
      }

      if (typeof enableFHE !== "function") {
        setTxMessage("FHE hook does not expose enableFHE/initWithEthers.");
        return;
      }

      const ok = await enableFHE({
        provider: walletProvider,
        signer: walletSigner,
        environment: "TESTNET",
      });

      if (!ok) setTxMessage("FHE enable failed. Check FHE status/error.");
    } catch (e: any) {
      setTxMessage(e?.message ?? String(e));
    }
  }, [walletProvider, walletSigner, enableFHE]);

  const onResetPermit = useCallback(async () => {
    setTxMessage(null);
    try {
      if (typeof resetPermit === "function") {
        await resetPermit();
        setTxMessage("Permit reset requested.");
        return;
      }
      setTxMessage("resetPermit is not available in your useFHE hook.");
    } catch (e: any) {
      setTxMessage(e?.message ?? String(e));
    }
  }, [resetPermit]);

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
        if (Number(net.chainId) !== ARB_SEPOLIA_CHAIN_ID) {
          await switchOrAddChain(ARB_SEPOLIA_HEX);
        }

        const maxV = maxPlainValue();
        if (maxV < ach.threshold) {
          setTxMessage("Threshold not reached yet.");
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
    [walletProvider, walletSigner, walletAccount, maxPlainValue]
  );

  const footerText = useMemo(() => "Made with love by mora", []);

  const cellClass = "w-[74px] h-[74px] rounded-xl bg-slate-100 shadow-inner flex items-center justify-center";
  const tileBase = "w-full h-full rounded-xl flex items-center justify-center font-extrabold";

  return (
    <div className="h-[100dvh] overflow-hidden bg-white">
      <div className="mx-auto max-w-[860px] px-4 py-6 h-full flex flex-col gap-4">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight">Encrypted 2048 - test</h1>
          <div className="text-slate-500 mt-1">Score: {score}</div>
        </div>

        <div className="border rounded-xl p-4 flex items-start justify-between gap-4">
          <div className="min-w-[240px]">
            <div className="font-semibold">FHE Access</div>
            <div className="text-xs text-slate-500 mt-1">Status: {String(fheStatus)}</div>

            {fheError ? (
              <div className="text-xs text-red-600 mt-1">{String(fheError)}</div>
            ) : null}

            {txMessage ? (
              <div className="text-xs text-slate-700 mt-1">{txMessage}</div>
            ) : null}

            <div className="text-xs text-slate-500 mt-2">
              Wallet: {walletAccount ? shortAddr(walletAccount) : "not connected"}
            </div>

            <div className="text-xs text-slate-500 mt-1">
              Threshold: {maxPlainValue() >= 128 ? "reached" : "not reached yet"}
            </div>
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
              <div className="flex flex-col items-end gap-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => void onEnableFHE()}
                    className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold disabled:opacity-50"
                    disabled={fheStatus === "initializing" || fheStatus === "ready"}
                  >
                    Enable FHE (Generate Permit)
                  </button>

                  <button
                    onClick={() => void onResetPermit()}
                    className="px-4 py-2 rounded-lg border text-sm font-semibold"
                  >
                    Reset Permit
                  </button>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => bootGame()}
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
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col items-center gap-4">
          <div className="p-4 rounded-2xl bg-white shadow-2xl">
            <div className="grid grid-cols-4 gap-3">
              {board.flatMap((row, r) =>
                row.map((cell, c) => {
                  return (
                    <div key={`${r}-${c}`} className={cellClass}>
                      {cell != null ? (
                        <div className={`${tileBase} ${tileColorClass(cell)}`}>
                          <span className="text-xl">{cell}</span>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex flex-col items-center gap-3">
            <button
              onClick={() => move("up")}
              className="px-14 py-3 rounded-lg bg-slate-900 text-white font-semibold"
            >
              Up
            </button>
            <div className="flex gap-3">
              <button
                onClick={() => move("left")}
                className="px-14 py-3 rounded-lg bg-slate-900 text-white font-semibold"
              >
                Left
              </button>
              <button
                onClick={() => move("down")}
                className="px-14 py-3 rounded-lg bg-slate-900 text-white font-semibold"
              >
                Down
              </button>
              <button
                onClick={() => move("right")}
                className="px-14 py-3 rounded-lg bg-slate-900 text-white font-semibold"
              >
                Right
              </button>
            </div>
          </div>
        </div>

        <div className="border rounded-xl p-4 flex-1 min-h-0 overflow-hidden">
          <div className="font-semibold text-sm">FHE Achievements (Arbitrum Sepolia)</div>
          <div className="text-xs text-slate-500 mt-1">
            Mint happens on Arbitrum Sepolia (CipherAchievements).
          </div>

          <div className="mt-3 h-full overflow-auto pr-2">
            <div className="flex flex-col gap-3 pb-2">
              {ACHIEVEMENTS.map((ach) => {
                const isDone = !!claimed[ach.id];
                const eligible = maxPlainValue() >= ach.threshold;

                return (
                  <div
                    key={ach.id}
                    className="border rounded-xl p-3 flex items-center justify-between gap-3"
                  >
                    <div className="flex flex-col gap-1">
                      <div className="text-sm font-semibold">{ach.title}</div>
                      <div className="text-xs text-slate-600">{ach.description}</div>
                      <div className="text-[11px] text-slate-500">
                        Threshold: value ≥ {ach.threshold}{" "}
                        <span className={eligible ? "text-emerald-600" : "text-slate-500"}>
                          ({eligible ? "reached" : "not yet"})
                        </span>
                      </div>
                    </div>

                    <div className="flex items-end flex-col gap-2">
                      <div className="text-[11px] text-slate-500">
                        {isDone ? "Claimed" : eligible ? "Unlocked" : "Locked"}
                      </div>

                      <button
                        onClick={() => void claimNft(ach)}
                        disabled={isClaiming || isDone || !walletAccount || !eligible}
                        className="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold disabled:opacity-50"
                      >
                        {isDone ? "Minted" : "Claim NFT"}
                      </button>
                    </div>
                  </div>
                );
              })}
              <div className="text-center text-xs text-slate-400 mt-2">{footerText}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
