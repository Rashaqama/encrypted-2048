import { useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract } from "ethers";
import { useFHE } from "../fhe/useFHE";

type EncryptedValue = any;
type CellValue = EncryptedValue | null;
type Board = CellValue[][];

type Direction = "left" | "right" | "up" | "down";

const BOARD_SIZE = 4;

const ACHIEVEMENT_CONTRACT_ADDRESS =
  "0xDE0c86c1c4607713Fd19e000661Ada864b6c493a";

const ACHIEVEMENT_CONTRACT_ABI = [
  {
    inputs: [{ internalType: "uint8", name: "levelIndex", type: "uint8" }],
    name: "mintAchievement",
    outputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

type TileLevelName = "tiny" | "small" | "medium" | "big" | "legendary";

type TileLevelMeta = {
  name: TileLevelName;
  label: string;
  bgClass: string;
  textClass: string;
};

const TILE_LEVELS: TileLevelMeta[] = [
  { name: "tiny", label: "Tiny", bgClass: "bg-slate-700", textClass: "text-slate-50" },
  { name: "small", label: "Small", bgClass: "bg-blue-600", textClass: "text-blue-50" },
  { name: "medium", label: "Medium", bgClass: "bg-emerald-500", textClass: "text-emerald-50" },
  { name: "big", label: "Big", bgClass: "bg-violet-500", textClass: "text-violet-50" },
  { name: "legendary", label: "Legendary", bgClass: "bg-amber-500", textClass: "text-amber-50" },
];

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
    level: "medium",
    title: "Medium Power Unlocked",
    description: "You reached a Medium-level encrypted tile for the first time.",
    threshold: 128,
    unlocked: false,
    claimed: false,
  },
  {
    id: "big_power",
    level: "big",
    title: "Big Power Unlocked",
    description: "You reached a Big-level encrypted tile for the first time.",
    threshold: 512,
    unlocked: false,
    claimed: false,
  },
  {
    id: "legendary_power",
    level: "legendary",
    title: "Legendary Power",
    description: "You reached a Legendary-level encrypted tile. Insane!",
    threshold: 2048,
    unlocked: false,
    claimed: false,
  },
];

export default function Home() {
  const fhe = useFHE();

  const [board, setBoard] = useState<Board>(() =>
    Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null))
  );
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [achievements, setAchievements] = useState(INITIAL_ACHIEVEMENTS);

  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [txMessage, setTxMessage] = useState<string | null>(null);

  // Prevent page scrolling (arrow keys + body overflow)
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  const canPlay = useMemo(() => {
    // Allow play even if FHE is not ready (mock mode)
    return !gameOver;
  }, [gameOver]);

  const getTileLevel = async (val: EncryptedValue): Promise<TileLevelMeta> => {
    try {
      const plainValue = await fhe.client.unseal(val);
      if (plainValue < 16) return TILE_LEVELS[0];
      if (plainValue < 128) return TILE_LEVELS[1];
      if (plainValue < 512) return TILE_LEVELS[2];
      if (plainValue < 2048) return TILE_LEVELS[3];
      return TILE_LEVELS[4];
    } catch {
      return TILE_LEVELS[0];
    }
  };

  const addRandomTile = async (b: Board): Promise<Board> => {
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

    // In FHE-ready mode this returns an encrypted handle, otherwise it returns a mock number.
    const encrypted = await fhe.client.encrypt32(plainValue);

    newBoard[r][c] = encrypted;
    return newBoard;
  };

  const initializeBoard = async () => {
    let newBoard: Board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
    newBoard = await addRandomTile(newBoard);
    newBoard = await addRandomTile(newBoard);

    setBoard(newBoard);
    setScore(0);
    setGameOver(false);
    setAchievements(INITIAL_ACHIEVEMENTS);
  };

  useEffect(() => {
    // Always initialize once on mount (even if FHE not ready)
    initializeBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const slideRowLeft = async (row: CellValue[]): Promise<[CellValue[], number]> => {
    const filtered = row.filter((v) => v !== null) as EncryptedValue[];
    let scoreAdd = 0;

    for (let j = 0; j < filtered.length - 1; j++) {
      const v1 = await fhe.client.unseal(filtered[j]);
      const v2 = await fhe.client.unseal(filtered[j + 1]);

      if (v1 === v2) {
        const merged = await fhe.client.encrypt32(v1 * 2);
        filtered[j] = merged;
        scoreAdd += v1 * 2;
        filtered.splice(j + 1, 1);
        j--;
      }
    }

    const padded = filtered.concat(Array(BOARD_SIZE - filtered.length).fill(null));
    return [padded, scoreAdd];
  };

  const transpose = (b: Board): Board => b[0].map((_, col) => b.map((row) => row[col]));
  const reverseRows = (b: Board): Board => b.map((row) => row.slice().reverse());

  const isGameOver = async (b: Board): Promise<boolean> => {
    for (let i = 0; i < BOARD_SIZE; i++) {
      for (let j = 0; j < BOARD_SIZE; j++) {
        if (b[i][j] === null) return false;

        const val = await fhe.client.unseal(b[i][j]);
        if (i < BOARD_SIZE - 1) {
          const down = await fhe.client.unseal(b[i + 1][j]);
          if (val === down) return false;
        }
        if (j < BOARD_SIZE - 1) {
          const right = await fhe.client.unseal(b[i][j + 1]);
          if (val === right) return false;
        }
      }
    }
    return true;
  };

  const move = async (direction: Direction) => {
    if (!canPlay) return;

    let newBoard = board.map((row) => [...row]);
    let totalScoreAdd = 0;
    let moved = false;

    if (direction === "up") newBoard = transpose(newBoard);
    if (direction === "right") newBoard = reverseRows(newBoard);
    if (direction === "down") {
      newBoard = transpose(newBoard);
      newBoard = reverseRows(newBoard);
    }

    for (let i = 0; i < BOARD_SIZE; i++) {
      const [newRow, scoreAdd] = await slideRowLeft(newBoard[i]);
      totalScoreAdd += scoreAdd;
      if (JSON.stringify(newRow) !== JSON.stringify(newBoard[i])) moved = true;
      newBoard[i] = newRow;
    }

    if (direction === "up") newBoard = transpose(newBoard);
    if (direction === "right") newBoard = reverseRows(newBoard);
    if (direction === "down") {
      newBoard = reverseRows(newBoard);
      newBoard = transpose(newBoard);
    }

    if (!moved) return;

    newBoard = await addRandomTile(newBoard);
    setBoard(newBoard);
    setScore((prev) => prev + totalScoreAdd);

    let maxValue = 0;
    for (const row of newBoard) {
      for (const v of row) {
        if (v) {
          const plain = await fhe.client.unseal(v);
          if (plain > maxValue) maxValue = plain;
        }
      }
    }

    setAchievements((prev) =>
      prev.map((ach) => (!ach.unlocked && maxValue >= ach.threshold ? { ...ach, unlocked: true } : ach))
    );

    if (await isGameOver(newBoard)) setGameOver(true);
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const isArrow =
        e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight";

      if (isArrow) e.preventDefault();

      if (e.key === "ArrowUp") void move("up");
      if (e.key === "ArrowDown") void move("down");
      if (e.key === "ArrowLeft") void move("left");
      if (e.key === "ArrowRight") void move("right");
    };

    window.addEventListener("keydown", handleKey, { passive: false } as any);
    return () => window.removeEventListener("keydown", handleKey as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, gameOver]);

  const connectWallet = async () => {
    if (!(window as any).ethereum) {
      alert("Please install MetaMask or a compatible wallet");
      return;
    }

    try {
      const provider = new BrowserProvider((window as any).ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      setWalletAddress(address);
      setTxMessage(null);
    } catch (e) {
      console.error(e);
    }
  };

  const disconnectWallet = () => {
    setWalletAddress(null);
    setTxMessage(null);
  };

  const enableFHE = async () => {
    if (!walletAddress) {
      await connectWallet();
      return;
    }

    if (!(window as any).ethereum) {
      alert("Wallet provider not found");
      return;
    }

    setIsBusy(true);
    setTxMessage("Initializing CoFHE...");

    try {
      const provider = new BrowserProvider((window as any).ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();

      const okInit = await fhe.initCoFHE({
        provider,
        signer,
        environment: "TESTNET",
      });

      if (!okInit) {
        setTxMessage(fhe.error || "Initialization failed");
        return;
      }

      setTxMessage("Generating permit (signature required)...");
      const okPermit = await fhe.generatePermit(walletAddress);

      if (!okPermit) {
        setTxMessage(fhe.error || "Permit generation failed");
        return;
      }

      setTxMessage("FHE is enabled ✅");
    } finally {
      setIsBusy(false);
    }
  };

  const handleClaimAchievement = async (id: AchievementId) => {
    if (!walletAddress) {
      setTxMessage("Please connect wallet");
      return;
    }

    setIsBusy(true);
    setTxMessage("Sending transaction...");

    try {
      const provider = new BrowserProvider((window as any).ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const contract = new Contract(ACHIEVEMENT_CONTRACT_ADDRESS, ACHIEVEMENT_CONTRACT_ABI, signer);

      const levelIndex = id === "medium_power" ? 0 : id === "big_power" ? 1 : 2;

      const tx = await contract.mintAchievement(levelIndex);
      setTxMessage("Transaction sent, waiting...");
      await tx.wait();

      setTxMessage("NFT minted successfully!");
      setAchievements((prev) => prev.map((ach) => (ach.id === id ? { ...ach, claimed: true } : ach)));
    } catch (err: any) {
      setTxMessage(`Error: ${err.message || "Unknown"}`);
      console.error(err);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="min-h-[100dvh] h-[100dvh] overflow-hidden bg-background flex flex-col items-center px-4 py-3">
      <div className="w-full max-w-md flex flex-col items-center gap-3">
        <div className="w-full">
          <h1 className="text-4xl font-bold text-center">Encrypted 2048 - test</h1>
          <p className="text-center text-muted-foreground">Score: {score}</p>
          {gameOver && <p className="text-center text-red-500 text-xl mt-1">Game over</p>}
          {fhe.error && <p className="text-center text-red-500 mt-1">{fhe.error}</p>}
        </div>

        {/* FHE Panel (replaces "Loading FHE...") */}
        <div className="w-full border border-border rounded-xl bg-card/40 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-sm">FHE Access</div>
            <div className="text-xs text-foreground/60">
              Status:{" "}
              {fhe.status === "ready"
                ? "Enabled"
                : fhe.status === "permit-needed"
                ? "Permit required"
                : fhe.status === "initializing"
                ? "Initializing"
                : fhe.status === "cdn-loaded"
                ? "Ready to enable"
                : fhe.status === "cdn-missing"
                ? "Unavailable"
                : "Idle"}
            </div>
          </div>

          <div className="mt-2 text-xs text-foreground/70">
            Permit:{" "}
            <span className={fhe.hasPermit ? "text-emerald-500 font-semibold" : "text-foreground/60"}>
              {fhe.hasPermit ? "Generated" : "Not generated"}
            </span>
          </div>

          {txMessage && <div className="mt-2 text-xs text-foreground/70">{txMessage}</div>}

          <div className="mt-3 flex gap-2">
            <button
              className="flex-1 py-2 bg-primary text-primary-foreground rounded-md disabled:opacity-50"
              onClick={enableFHE}
              disabled={isBusy || fhe.status === "ready" || fhe.status === "cdn-missing"}
            >
              {fhe.status === "ready" ? "FHE Enabled" : isBusy ? "Working..." : "Enable FHE (Generate Permit)"}
            </button>

            <button
              className="py-2 px-3 rounded-md border border-border bg-background text-foreground disabled:opacity-50"
              onClick={walletAddress ? disconnectWallet : connectWallet}
              disabled={isBusy}
            >
              {walletAddress ? "Disconnect" : "Connect"}
            </button>
          </div>

          {walletAddress && (
            <div className="mt-2 text-[11px] text-foreground/60">
              Wallet: {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
            </div>
          )}
        </div>

        {/* Board */}
        <div className="w-full bg-card rounded-xl shadow-2xl p-4">
          <div className="grid grid-cols-4 gap-2">
            {board.map((row, i) =>
              row.map((value, j) => (
                <div key={`${i}-${j}`} className="aspect-square rounded-lg bg-muted" />
              ))
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 w-full">
          <div />
          <button
            className="bg-primary text-primary-foreground rounded-lg py-3 font-semibold disabled:opacity-50"
            onClick={() => void move("up")}
            disabled={!canPlay}
          >
            Up
          </button>
          <div />
          <button
            className="bg-primary text-primary-foreground rounded-lg py-3 font-semibold disabled:opacity-50"
            onClick={() => void move("left")}
            disabled={!canPlay}
          >
            Left
          </button>
          <button
            className="bg-primary text-primary-foreground rounded-lg py-3 font-semibold disabled:opacity-50"
            onClick={() => void move("down")}
            disabled={!canPlay}
          >
            Down
          </button>
          <button
            className="bg-primary text-primary-foreground rounded-lg py-3 font-semibold disabled:opacity-50"
            onClick={() => void move("right")}
            disabled={!canPlay}
          >
            Right
          </button>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-4 flex-wrap">
          {TILE_LEVELS.map((lvl) => (
            <div key={lvl.name} className="flex items-center gap-2">
              <div className={`w-5 h-5 rounded ${lvl.bgClass}`} />
              <span className="text-xs text-foreground/80">{lvl.label}</span>
            </div>
          ))}
        </div>

        {/* Achievements (internal scroll) */}
        <div className="w-full px-1">
          <h2 className="text-xs font-semibold text-foreground mb-2">FHE Achievements (on-chain ready)</h2>

          <div className="space-y-2 text-xs text-foreground/80 max-h-36 overflow-auto pr-1">
            {achievements.map((ach) => {
              const levelMeta = TILE_LEVELS.find((l) => l.name === ach.level)!;
              const disabled = !ach.unlocked || ach.claimed || isBusy;

              return (
                <div
                  key={ach.id}
                  className="border border-border rounded-lg px-3 py-2 flex items-center justify-between gap-3 bg-card/40"
                >
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${levelMeta.bgClass} ${levelMeta.textClass}`}
                      >
                        {levelMeta.label.toUpperCase()}
                      </span>
                      <span className="font-semibold text-foreground text-xs">{ach.title}</span>
                    </div>
                    <span className="text-[11px]">{ach.description}</span>
                    <span className="text-[10px] text-foreground/60">Threshold: value ≥ {ach.threshold}</span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className={
                        ach.unlocked
                          ? "text-[10px] text-emerald-500 font-semibold"
                          : "text-[10px] text-foreground/40"
                      }
                    >
                      {ach.unlocked ? "Unlocked" : "Locked"}
                    </span>
                    <button
                      className="px-2 py-1 rounded-md text-[10px] bg-primary text-primary-foreground disabled:bg-muted disabled:text-foreground/40"
                      disabled={disabled}
                      onClick={() => void handleClaimAchievement(ach.id)}
                    >
                      {ach.claimed ? "Claimed" : isBusy ? "Working..." : "Claim NFT"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-2 text-[10px] text-foreground/60">
            When connected to Base Sepolia, claiming an achievement will call the on-chain CipherAchievements contract and mint a real NFT.
          </p>
        </div>

        {/* Footer inside layout (no scroll, not too low) */}
        <div className="w-full text-center text-foreground/60 text-sm pt-1 pb-2">
          Made with love by mora
        </div>
      </div>
    </div>
  );
}
