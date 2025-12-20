import { useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract } from "ethers";
import { useFHE } from "../fhe/useFHE";

declare global {
  interface Window {
    ethereum?: {
      request?: (args: any) => Promise<any>;
    };
  }
}

type CellValue = any | null;
type Board = CellValue[][];
type Direction = "left" | "right" | "up" | "down";

const BOARD_SIZE = 4;

const BASE_SEPOLIA_CHAIN_ID = 84532; // 0x14a34
const ARB_SEPOLIA_CHAIN_ID = 421614; // 0x66eee

const ACHIEVEMENT_CONTRACT_ADDRESS = "0xDE0c86c1c4607713Fd19e000661Ada864b6c493a";

const ACHIEVEMENT_CONTRACT_ABI = [
  {
    inputs: [{ internalType: "uint8", name: "level", type: "uint8" }],
    name: "mintAchievement",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

type TileLevelName = "Tiny" | "Small" | "Medium" | "Big" | "Legendary";

const TILE_LEVELS: Record<TileLevelName, { bg: string }> = {
  Tiny: { bg: "bg-slate-700" },
  Small: { bg: "bg-blue-600" },
  Medium: { bg: "bg-emerald-500" },
  Big: { bg: "bg-violet-500" },
  Legendary: { bg: "bg-amber-500" },
};

type AchievementId = "medium_power" | "big_power" | "legendary_power";

type Achievement = {
  id: AchievementId;
  level: TileLevelName;
  title: string;
  description: string;
  threshold: number;
  unlocked: boolean;
  claimed: boolean;
};

const INITIAL_ACHIEVEMENTS: Achievement[] = [
  {
    id: "medium_power",
    level: "Medium",
    title: "Medium Power Unlocked",
    description: "You reached a Medium-level encrypted tile for the first time.",
    threshold: 128,
    unlocked: false,
    claimed: false,
  },
  {
    id: "big_power",
    level: "Big",
    title: "Big Power Unlocked",
    description: "You reached a Big-level encrypted tile for the first time.",
    threshold: 512,
    unlocked: false,
    claimed: false,
  },
  {
    id: "legendary_power",
    level: "Legendary",
    title: "Legendary Power",
    description: "You reached a Legendary-level encrypted tile. Insane!",
    threshold: 2048,
    unlocked: false,
    claimed: false,
  },
];

function getTileLevelFromPlain(value: number): TileLevelName {
  if (value >= 2048) return "Legendary";
  if (value >= 512) return "Big";
  if (value >= 128) return "Medium";
  if (value >= 4) return "Small";
  return "Tiny";
}

async function switchChain(chainIdHex: string) {
  const eth = window.ethereum;
  if (!eth?.request) throw new Error("Wallet does not support chain switching.");

  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (e: any) {
    if (e?.code === 4902 && chainIdHex === "0x66eee") {
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

    if (e?.code === 4902 && chainIdHex === "0x14a34") {
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

    throw e;
  }
}

function emptyBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => null));
}

export default function Home() {
  const { client, initialized, status, error, initWithEthers, createSelfPermit, resetPermit } = useFHE();

  const [board, setBoard] = useState<Board>(emptyBoard());
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);

  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  const [txMessage, setTxMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const [achievements, setAchievements] = useState<Achievement[]>(INITIAL_ACHIEVEMENTS);

  const addRandomTile = (b: Board): Board => {
    const empty: [number, number][] = [];
    for (let i = 0; i < BOARD_SIZE; i++) {
      for (let j = 0; j < BOARD_SIZE; j++) {
        if (b[i][j] === null) empty.push([i, j]);
      }
    }
    if (empty.length === 0) return b;

    const [r, c] = empty[Math.floor(Math.random() * empty.length)];
    const newBoard = b.map((row) => [...row]);

    const plainValue = Math.random() < 0.9 ? 2 : 4;
    newBoard[r][c] = client.encrypt32(plainValue);

    return newBoard;
  };

  const initializeBoard = () => {
    let b = emptyBoard();
    b = addRandomTile(addRandomTile(b));
    setBoard(b);
    setScore(0);
    setGameOver(false);
    setAchievements(INITIAL_ACHIEVEMENTS);
  };

  useEffect(() => {
    initializeBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rotateRight = (b: Board) => {
    const res = emptyBoard();
    for (let i = 0; i < BOARD_SIZE; i++) {
      for (let j = 0; j < BOARD_SIZE; j++) {
        res[j][BOARD_SIZE - 1 - i] = b[i][j];
      }
    }
    return res;
  };

  const slideRowLeft = (row: CellValue[]) => {
    const values = row
      .filter((x) => x !== null)
      .map((x) => ({ raw: x as any, plain: client.unseal(x) }));

    const merged: { raw: any; plain: number }[] = [];
    let gained = 0;

    for (let i = 0; i < values.length; i++) {
      if (i < values.length - 1 && values[i].plain === values[i + 1].plain) {
        const newPlain = values[i].plain * 2;
        gained += newPlain;
        merged.push({ raw: client.encrypt32(newPlain), plain: newPlain });
        i++;
      } else {
        merged.push(values[i]);
      }
    }

    const out: CellValue[] = Array(BOARD_SIZE).fill(null);
    for (let k = 0; k < merged.length; k++) out[k] = merged[k].raw;

    return { out, gained };
  };

  const boardsEqual = (a: Board, b: Board) => JSON.stringify(a) === JSON.stringify(b);

  const isGameOver = (b: Board): boolean => {
    for (let i = 0; i < BOARD_SIZE; i++) {
      for (let j = 0; j < BOARD_SIZE; j++) {
        if (b[i][j] === null) return false;
        const v = client.unseal(b[i][j]);
        if (i < BOARD_SIZE - 1 && v === client.unseal(b[i + 1][j])) return false;
        if (j < BOARD_SIZE - 1 && v === client.unseal(b[i][j + 1])) return false;
      }
    }
    return true;
  };

  const move = (dir: Direction) => {
    if (gameOver) return;

    let b = board.map((r) => [...r]);

    const rotateTimes = dir === "left" ? 0 : dir === "up" ? 3 : dir === "right" ? 2 : 1;

    for (let i = 0; i < rotateTimes; i++) b = rotateRight(b);

    let gained = 0;
    const moved = b.map((row) => {
      const { out, gained: g } = slideRowLeft(row);
      gained += g;
      return out;
    });

    for (let i = 0; i < (4 - rotateTimes) % 4; i++) b = rotateRight(b);
    let next = moved;
    for (let i = 0; i < (4 - rotateTimes) % 4; i++) next = rotateRight(next);

    if (boardsEqual(board, next)) return;

    next = addRandomTile(next);

    setBoard(next);
    setScore((s) => s + gained);

    let maxValue = 0;
    next.forEach((r) =>
      r.forEach((cell) => {
        if (cell != null) maxValue = Math.max(maxValue, client.unseal(cell));
      })
    );

    setAchievements((prev) =>
      prev.map((ach) => {
        if (!ach.unlocked && maxValue >= ach.threshold) return { ...ach, unlocked: true };
        return ach;
      })
    );

    if (isGameOver(next)) setGameOver(true);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const keys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
      if (keys.includes(e.key)) e.preventDefault();

      if (e.key === "ArrowUp") move("up");
      if (e.key === "ArrowDown") move("down");
      if (e.key === "ArrowLeft") move("left");
      if (e.key === "ArrowRight") move("right");
    };

    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, gameOver]);

  const connectWallet = async () => {
    if (!window.ethereum) {
      alert("Please install MetaMask or a compatible wallet.");
      return;
    }

    try {
      const provider = new BrowserProvider(window.ethereum as any);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      setWalletAddress(address);
      setTxMessage(null);
    } catch (e: any) {
      setTxMessage(e?.message ?? "Wallet connection failed.");
    }
  };

  const disconnectWallet = () => {
    setWalletAddress(null);
    setTxMessage(null);
  };

  const enableFHE = async () => {
    if (!walletAddress) {
      setTxMessage("Please connect wallet first.");
      return;
    }
    if (!window.ethereum) {
      setTxMessage("No wallet found.");
      return;
    }

    setIsBusy(true);
    setTxMessage("Switching to Arbitrum Sepolia for FHE permit...");

    try {
      await switchChain("0x66eee");

      const provider = new BrowserProvider(window.ethereum as any);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();

      setTxMessage("Initializing CoFHE...");
      const okInit = await initWithEthers({ provider, signer, environment: "TESTNET" });
      if (!okInit) {
        setTxMessage("CoFHE init failed. Check console.");
        return;
      }

      setTxMessage("Generating permit...");
      const okPermit = await createSelfPermit(walletAddress);
      if (!okPermit) {
        setTxMessage("Permit generation failed. Check console.");
        return;
      }

      setTxMessage("Permit ready. Switching back to Base Sepolia...");
      await switchChain("0x14a34");

      setTxMessage("FHE enabled. You can mint NFTs on Base Sepolia.");
    } catch (e: any) {
      setTxMessage(e?.message ?? "Enable FHE failed.");
    } finally {
      setIsBusy(false);
    }
  };

  const handleClaimAchievement = async (id: AchievementId) => {
    if (!walletAddress) {
      setTxMessage("Please connect wallet first.");
      return;
    }
    if (!window.ethereum) {
      setTxMessage("No wallet found.");
      return;
    }

    setIsBusy(true);
    setTxMessage("Switching to Base Sepolia for mint...");

    try {
      await switchChain("0x14a34");

      const provider = new BrowserProvider(window.ethereum as any);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();

      const contract = new Contract(ACHIEVEMENT_CONTRACT_ADDRESS, ACHIEVEMENT_CONTRACT_ABI, signer);

      const levelIndex = id === "medium_power" ? 0 : id === "big_power" ? 1 : 2;

      setTxMessage("Sending transaction...");
      const tx = await contract.mintAchievement(levelIndex);

      setTxMessage("Transaction sent. Waiting for confirmation...");
      await tx.wait();

      setTxMessage("NFT minted successfully!");
      setAchievements((prev) => prev.map((a) => (a.id === id ? { ...a, claimed: true } : a)));
    } catch (e: any) {
      setTxMessage(e?.message ?? "Mint failed.");
    } finally {
      setIsBusy(false);
    }
  };

  const tileBgClass = (cell: CellValue) => {
    if (cell == null) return "bg-muted";
    const plain = client.unseal(cell);
    const lvl = getTileLevelFromPlain(plain);
    return TILE_LEVELS[lvl].bg;
  };

  const canEnableFhe = useMemo(() => {
    return !!walletAddress && (status === "cdn-loaded" || status === "permit-required" || status === "error");
  }, [walletAddress, status]);

  return (
    <div className="h-screen w-full bg-background overflow-hidden flex items-center justify-center p-3">
      <div className="w-full max-w-md h-full flex flex-col gap-3">
        <div className="text-center">
          <h1 className="text-4xl font-bold">Encrypted 2048 - test</h1>
          <div className="text-muted-foreground mt-1">Score: {score}</div>
          {gameOver && <div className="text-red-500 mt-2 font-semibold">Game over</div>}
        </div>

        <div className="border border-border rounded-xl p-3 bg-card/40">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold">FHE Access</div>
            <div className="text-[11px] text-foreground/60">Status: {status}</div>
          </div>

          {error && <div className="text-[11px] text-red-500 mt-1">{error}</div>}
          {txMessage && <div className="text-[11px] text-foreground/70 mt-1">{txMessage}</div>}

          <div className="mt-2 flex gap-2">
            <button
              className="flex-1 py-2 rounded-md bg-primary text-primary-foreground disabled:bg-muted disabled:text-foreground/40"
              onClick={enableFHE}
              disabled={!canEnableFhe || isBusy}
            >
              Enable FHE (Generate Permit)
            </button>
            <button
              className="py-2 px-3 rounded-md border border-border bg-background disabled:opacity-50"
              onClick={resetPermit}
              disabled={isBusy}
            >
              Reset Permit
            </button>
          </div>

          <div className="mt-2 flex gap-2">
            <button
              className="flex-1 py-2 rounded-md bg-primary text-primary-foreground disabled:bg-muted disabled:text-foreground/40"
              onClick={connectWallet}
              disabled={isBusy}
            >
              {walletAddress ? `Connected: ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : "Connect wallet"}
            </button>
            <button
              className="py-2 px-3 rounded-md border border-border bg-background disabled:opacity-50"
              onClick={disconnectWallet}
              disabled={isBusy}
            >
              Disconnect
            </button>
          </div>
        </div>

        <div className="bg-card rounded-xl shadow-2xl p-3">
          <div className="grid grid-cols-4 gap-2">
            {board.map((row, i) =>
              row.map((cell, j) => (
                <div
                  key={`${i}-${j}`}
                  className={`aspect-square rounded-lg transition-all ${tileBgClass(cell)}`}
                />
              ))
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div />
          <button className="bg-primary text-primary-foreground rounded-lg py-3 font-semibold" onClick={() => move("up")}>
            Up
          </button>
          <div />
          <button className="bg-primary text-primary-foreground rounded-lg py-3 font-semibold" onClick={() => move("left")}>
            Left
          </button>
          <button className="bg-primary text-primary-foreground rounded-lg py-3 font-semibold" onClick={() => move("down")}>
            Down
          </button>
          <button className="bg-primary text-primary-foreground rounded-lg py-3 font-semibold" onClick={() => move("right")}>
            Right
          </button>
        </div>

        <div className="flex items-center justify-center gap-4 flex-wrap text-sm">
          {(["Tiny", "Small", "Medium", "Big", "Legendary"] as TileLevelName[]).map((k) => (
            <div key={k} className="flex items-center gap-2">
              <div className={`w-5 h-5 rounded ${TILE_LEVELS[k].bg}`} />
              <span className="text-foreground/80">{k}</span>
            </div>
          ))}
        </div>

        <div className="border border-border rounded-xl p-3 bg-card/30 flex-1 overflow-hidden flex flex-col">
          <div className="text-sm font-semibold mb-2">FHE Achievements (on-chain ready)</div>

          <div className="flex-1 overflow-y-auto pr-1 space-y-2">
            {achievements.map((ach) => {
              const disabled = !ach.unlocked || ach.claimed || isBusy;

              return (
                <div
                  key={ach.id}
                  className="border border-border rounded-lg px-3 py-2 flex items-center justify-between gap-3 bg-card/40"
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold">{ach.title}</span>
                      <span className={ach.unlocked ? "text-[10px] text-emerald-500" : "text-[10px] text-foreground/40"}>
                        {ach.unlocked ? "Unlocked" : "Locked"}
                      </span>
                    </div>
                    <div className="text-[11px] text-foreground/70">{ach.description}</div>
                    <div className="text-[10px] text-foreground/50">Threshold: value ≥ {ach.threshold}</div>
                  </div>

                  <button
                    className="px-2 py-1 rounded-md text-[10px] bg-primary text-primary-foreground disabled:bg-muted disabled:text-foreground/40"
                    disabled={disabled}
                    onClick={() => handleClaimAchievement(ach.id)}
                  >
                    {ach.claimed ? "Claimed" : isBusy ? "..." : "Claim NFT"}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="text-[10px] text-foreground/60 mt-2">
            Mint happens on Base Sepolia (CipherAchievements).
          </div>
        </div>

        <div className="text-center text-foreground/60 text-sm">
          Made with love by mora
        </div>
      </div>
    </div>
  );
}
