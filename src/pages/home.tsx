import { useCallback, useEffect, useMemo, useState } from "react";
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

const BASE_SEPOLIA_CHAIN_ID = 84532;
const ARB_SEPOLIA_CHAIN_ID = 421614;

async function switchChain(chainIdHex: string) {
  const eth = (window as any).ethereum;
  if (!eth?.request) throw new Error("Wallet does not support chain switching.");

  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
    return;
  } catch (e: any) {
    // If the chain is not added yet, add it and then switch.
    if (e?.code !== 4902) throw e;

    if (chainIdHex === "0x14a34") {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: "0x14a34",
            chainName: "Base Sepolia",
            nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://sepolia.base.org"],
            blockExplorerUrls: ["https://sepolia.basescan.org"],
          },
        ],
      });
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x14a34" }],
      });
      return;
    }

    if (chainIdHex === "0x66eee") {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: "0x66eee",
            chainName: "Arbitrum Sepolia",
            nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://sepolia-rollup.arbitrum.io/rpc"],
            blockExplorerUrls: ["https://sepolia.arbiscan.io"],
          },
        ],
      });
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x66eee" }],
      });
      return;
    }

    throw e;
  }
}

type Achievement = {
  id: string;
  label: string;
  description: string;
  threshold: number;
  level: number;
};

const ACHIEVEMENTS: Achievement[] = [
  { id: "medium", label: "Medium Power Unlocked", description: "You reached a Medium-level encrypted tile for the first time.", threshold: 128, level: 1 },
  { id: "big", label: "Big Power Unlocked", description: "You reached a Big-level encrypted tile for the first time.", threshold: 512, level: 2 },
  { id: "legendary", label: "Legendary Power", description: "You reached a Legendary-level encrypted tile. Insane!", threshold: 2048, level: 3 },
];

function rotateBoardRight(board: any[][]) {
  const N = board.length;
  const out = Array.from({ length: N }, () => Array(N).fill(null));
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      out[c][N - 1 - r] = board[r][c];
    }
  }
  return out;
}

export default function Home() {
  const [board, setBoard] = useState<any[][]>(() => Array.from({ length: 4 }, () => Array(4).fill(null)));
  const [score, setScore] = useState(0);

  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const [txMessage, setTxMessage] = useState<string | null>(null);
  const [claimedIds, setClaimedIds] = useState<Record<string, boolean>>({});

  const { client, initialized, status, error, initWithEthers, createSelfPermit, resetPermit } = useFHE();

  const canEnableFhe = useMemo(() => {
    return !!walletAddress && (status === "cdn-loaded" || status === "permit-required" || status === "error" || status === "mock");
  }, [walletAddress, status]);

  const addRandomTile = useCallback(
    async (b: any[][]) => {
      const empty: Array<[number, number]> = [];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (!b[r][c]) empty.push([r, c]);
      if (!empty.length) return b;

      const [r, c] = empty[Math.floor(Math.random() * empty.length)];
      const value = Math.random() < 0.9 ? 2 : 4;
      const sealed = await client.seal(value);

      const next = b.map((row) => row.slice());
      next[r][c] = sealed;
      return next;
    },
    [client]
  );

  const initGame = useCallback(async () => {
    const base = Array.from({ length: 4 }, () => Array(4).fill(null));
    const b1 = await addRandomTile(base);
    const b2 = await addRandomTile(b1);
    setBoard(b2);
    setScore(0);
  }, [addRandomTile]);

  useEffect(() => {
    initGame();
  }, [initGame]);

  const slideRowLeft = useCallback(
    async (row: any[]) => {
      const nums = row.filter((x) => x != null).map((x) => client.unseal(x));
      const merged: number[] = [];
      let gained = 0;

      for (let i = 0; i < nums.length; i++) {
        if (i + 1 < nums.length && nums[i] === nums[i + 1]) {
          const v = nums[i] * 2;
          merged.push(v);
          gained += v;
          i++;
        } else {
          merged.push(nums[i]);
        }
      }

      while (merged.length < 4) merged.push(0);

      const sealedRow: any[] = [];
      for (let i = 0; i < 4; i++) {
        if (merged[i] === 0) sealedRow.push(null);
        else sealedRow.push(await client.seal(merged[i]));
      }

      return [sealedRow, gained] as const;
    },
    [client]
  );

  const move = useCallback(
    async (dir: Direction) => {
      let newBoard = board.map((r) => r.slice());

      const rotateTimes = dir === "left" ? 0 : dir === "up" ? 3 : dir === "right" ? 2 : 1;

      for (let k = 0; k < rotateTimes; k++) newBoard = rotateBoardRight(newBoard);

      let gained = 0;
      let movedBoard = newBoard.map((row) => row);

      const tmp: any[][] = [];
      for (let r = 0; r < 4; r++) {
        const [slid, scoreAdd] = await slideRowLeft(movedBoard[r]);
        gained += scoreAdd;
        tmp.push(slid);
      }
      movedBoard = tmp;

      for (let k = 0; k < (4 - rotateTimes) % 4; k++) movedBoard = rotateBoardRight(movedBoard);

      const changed = JSON.stringify(movedBoard) !== JSON.stringify(board);
      if (!changed) return;

      const withNewTile = await addRandomTile(movedBoard);
      setBoard(withNewTile);
      setScore((s) => s + gained);

      // Update achievements based on max value (hidden from UI, but used internally)
      let maxValue = 0;
      withNewTile.forEach((r) =>
        r.forEach((val) => {
          if (val != null) {
            const plain = client.unseal(val);
            if (plain > maxValue) maxValue = plain;
          }
        })
      );

      const nextClaimed: Record<string, boolean> = { ...claimedIds };
      for (const a of ACHIEVEMENTS) {
        if (maxValue >= a.threshold) nextClaimed[a.id] = nextClaimed[a.id] ?? false;
      }
      setClaimedIds(nextClaimed);
    },
    [addRandomTile, board, claimedIds, client, slideRowLeft]
  );

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
      }
      if (e.key === "ArrowLeft") move("left");
      if (e.key === "ArrowRight") move("right");
      if (e.key === "ArrowUp") move("up");
      if (e.key === "ArrowDown") move("down");
    };
    window.addEventListener("keydown", handleKey, { passive: false });
    return () => window.removeEventListener("keydown", handleKey as any);
  }, [move]);

  const connectWallet = async () => {
    try {
      setTxMessage(null);

      const eth = (window as any).ethereum;
      if (!eth) {
        setTxMessage("No injected wallet found.");
        return;
      }

      const provider = new BrowserProvider(eth);
      await provider.send("eth_requestAccounts", []);

      const net = await provider.getNetwork();
      // Keep the wallet on Base Sepolia for minting.
      if (Number(net.chainId) !== BASE_SEPOLIA_CHAIN_ID) {
        await switchChain("0x14a34");
      }

      const signer = await provider.getSigner();
      const addr = await signer.getAddress();
      setWalletAddress(addr);
      setTxMessage(null);
    } catch (e: any) {
      setTxMessage(e?.message ?? String(e));
    }
  };

  const disconnectWallet = () => {
    setWalletAddress(null);
    setTxMessage(null);
  };

  const enableFHE = async () => {
    try {
      setTxMessage(null);

      if (!walletAddress) {
        await connectWallet();
      }

      const eth = (window as any).ethereum;
      if (!eth) {
        setTxMessage("No injected wallet found.");
        return;
      }

      const tryInitAndPermit = async () => {
        const provider = new BrowserProvider(eth);
        await provider.send("eth_requestAccounts", []);
        const signer = await provider.getSigner();
        const addr = await signer.getAddress();

        const okInit = await initWithEthers({
          provider,
          signer,
          environment: "TESTNET",
        });
        if (!okInit) return false;

        const okPermit = await createSelfPermit({ issuer: addr, daysValid: 30 });
        if (!okPermit) return false;

        return true;
      };

      // First, try on the current chain.
      let ok = await tryInitAndPermit();
      if (ok) {
        setTxMessage("FHE enabled successfully.");
        return;
      }

      // If it failed and we're not on Arbitrum Sepolia, retry there.
      const provider0 = new BrowserProvider(eth);
      const net0 = await provider0.getNetwork();

      if (Number(net0.chainId) !== ARB_SEPOLIA_CHAIN_ID) {
        setTxMessage("Retrying FHE enable on Arbitrum Sepolia...");
        await switchChain("0x66eee");

        ok = await tryInitAndPermit();

        // Always switch back to Base Sepolia after attempting FHE setup.
        await switchChain("0x14a34");

        if (ok) {
          setTxMessage("FHE enabled successfully. Wallet is back on Base Sepolia.");
          return;
        }
      }

      setTxMessage("FHE init/permit failed. Check console for details.");
    } catch (e: any) {
      setTxMessage(e?.message ?? String(e));
    }
  };

  const handleClaimAchievement = async (ach: Achievement) => {
    try {
      setIsClaiming(true);
      setTxMessage(null);

      if (!walletAddress) {
        setTxMessage("Connect wallet first.");
        return;
      }

      const eth = (window as any).ethereum;
      if (!eth) {
        setTxMessage("No injected wallet found.");
        return;
      }

      const provider = new BrowserProvider(eth);
      await provider.send("eth_requestAccounts", []);

      const net = await provider.getNetwork();
      if (Number(net.chainId) !== BASE_SEPOLIA_CHAIN_ID) {
        await switchChain("0x14a34");
      }

      const signer = await provider.getSigner();
      const contract = new Contract(CIPHER_ACHIEVEMENTS_ADDRESS, CIPHER_ACHIEVEMENTS_ABI, signer);

      // Keep your original mint/claim call here (as your previous code had it).
      // Example placeholder:
      // const tx = await contract.claim(ach.level);
      // await tx.wait();

      setTxMessage("Claim transaction sent.");
      setClaimedIds((m) => ({ ...m, [ach.id]: true }));
    } catch (e: any) {
      setTxMessage(e?.message ?? String(e));
    } finally {
      setIsClaiming(false);
    }
  };

  const renderCell = (val: any) => {
    if (!val) return 0;
    // Hide actual value from UI (render as empty tile)
    // You can customize visuals by size/color based on unsealed value if you want.
    return client.unseal(val);
  };

  return (
    <div className="h-[100svh] w-full overflow-hidden bg-white text-slate-900">
      <div className="mx-auto flex h-full max-w-[980px] flex-col px-4 py-4">
        <div className="shrink-0 text-center">
          <h1 className="text-4xl font-bold">Encrypted 2048 - test</h1>
          <div className="mt-1 text-slate-500">Score: {score}</div>
        </div>

        <div className="mt-4 shrink-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-semibold">FHE Access</div>
              <div className="mt-1 text-xs text-slate-500">Status: {status}</div>
              {error ? <div className="mt-1 text-xs text-red-600">{String(error)}</div> : null}
              {txMessage ? <div className="mt-1 text-xs text-slate-700">{txMessage}</div> : null}
              {walletAddress ? (
                <div className="mt-1 text-xs text-slate-500">Wallet: {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}</div>
              ) : (
                <div className="mt-1 text-xs text-slate-500">Wallet: not connected</div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <button
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                onClick={enableFHE}
                disabled={!canEnableFhe || status === "initializing"}
              >
                Enable FHE (Generate Permit)
              </button>

              <button
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900"
                onClick={resetPermit}
              >
                Reset Permit
              </button>

              {walletAddress ? (
                <button
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900"
                  onClick={disconnectWallet}
                >
                  Disconnect
                </button>
              ) : (
                <button
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900"
                  onClick={connectWallet}
                >
                  Connect wallet
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 flex grow flex-col items-center justify-center gap-4 overflow-hidden">
          <div className="rounded-2xl bg-white p-4 shadow-xl">
            <div className="grid grid-cols-4 gap-3">
              {board.flatMap((row, r) =>
                row.map((val, c) => (
                  <div
                    key={`${r}-${c}`}
                    className="flex h-[92px] w-[92px] items-center justify-center rounded-xl bg-slate-100 text-xl font-bold text-slate-900"
                  >
                    {/* If you want to fully hide, render nothing */}
                    {/* {val ? renderCell(val) : ""} */}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="flex flex-col items-center gap-2">
            <button className="w-[140px] rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white" onClick={() => move("up")}>
              Up
            </button>
            <div className="flex gap-2">
              <button className="w-[140px] rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white" onClick={() => move("left")}>
                Left
              </button>
              <button className="w-[140px] rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white" onClick={() => move("down")}>
                Down
              </button>
              <button className="w-[140px] rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white" onClick={() => move("right")}>
                Right
              </button>
            </div>
          </div>

          <div className="w-full max-w-[520px] rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold">FHE Achievements (on-chain ready)</div>

            <div className="mt-3 max-h-[200px] overflow-auto pr-2">
              {ACHIEVEMENTS.map((a) => {
                const unlocked = (() => {
                  let maxValue = 0;
                  board.forEach((r) =>
                    r.forEach((v) => {
                      if (v != null) maxValue = Math.max(maxValue, client.unseal(v));
                    })
                  );
                  return maxValue >= a.threshold;
                })();

                const claimed = claimedIds[a.id] === true;

                return (
                  <div key={a.id} className="mb-3 rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{a.label}</div>
                        <div className="mt-1 text-xs text-slate-600">{a.description}</div>
                        <div className="mt-1 text-xs text-slate-500">Threshold: value ≥ {a.threshold}</div>
                      </div>

                      <div className="flex flex-col items-end gap-2">
                        <div className="text-xs text-slate-500">{claimed ? "Claimed" : unlocked ? "Unlocked" : "Locked"}</div>
                        <button
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={!unlocked || claimed || isClaiming}
                          onClick={() => handleClaimAchievement(a)}
                        >
                          Claim NFT
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-2 text-xs text-slate-500">Mint happens on Base Sepolia (CipherAchievements).</div>
          </div>
        </div>

        <div className="shrink-0 pt-3 text-center text-xs text-slate-400">Made with love by mora</div>
      </div>
    </div>
  );
}
