import { useEffect, useState } from "react";
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

function getTileLevel(encryptedValue: EncryptedValue, client: any): TileLevelMeta {
  if (!encryptedValue || !client) return TILE_LEVELS[0];

  const plainValue = client.unseal(encryptedValue);
  if (plainValue < 16) return TILE_LEVELS[0];
  if (plainValue < 128) return TILE_LEVELS[1];
  if (plainValue < 512) return TILE_LEVELS[2];
  if (plainValue < 2048) return TILE_LEVELS[3];
  return TILE_LEVELS[4];
}

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
  const [board, setBoard] = useState<Board>(() =>
    Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null))
  );
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [achievements, setAchievements] = useState(INITIAL_ACHIEVEMENTS);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const [txMessage, setTxMessage] = useState<string | null>(null);

  const { client, initialized, error } = useFHE();

  // Prevent page scrolling with arrow keys, and keep the page fixed-height.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  const addRandomTile = (b: Board): Board => {
    if (!client) return b;

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
    const encrypted = client.encrypt32(plainValue);

    newBoard[r][c] = encrypted;
    return newBoard;
  };

  const initializeBoard = () => {
    let newBoard = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
    if (client) {
      newBoard = addRandomTile(addRandomTile(newBoard));
    }
    setBoard(newBoard);
    setScore(0);
    setGameOver(false);
    setAchievements(INITIAL_ACHIEVEMENTS);
  };

  useEffect(() => {
    if (initialized && client) {
      initializeBoard();
    }
  }, [initialized, client]);

  const slideRowLeft = (row: CellValue[]): [CellValue[], number] => {
    if (!client) return [row, 0];

    const filtered = row.filter((v) => v !== null);
    let scoreAdd = 0;

    for (let j = 0; j < filtered.length - 1; j++) {
      const v1 = client.unseal(filtered[j]);
      const v2 = client.unseal(filtered[j + 1]);
      if (v1 === v2) {
        const merged = client.encrypt32(v1 * 2);
        filtered[j] = merged;
        scoreAdd += v1 * 2;
        filtered.splice(j + 1, 1);
        j--;
      }
    }

    return [filtered.concat(Array(BOARD_SIZE - filtered.length).fill(null)), scoreAdd];
  };

  const transpose = (b: Board): Board => b[0].map((_, col) => b.map((row) => row[col]));
  const reverseRows = (b: Board): Board => b.map((row) => row.reverse());

  const isGameOver = (b: Board): boolean => {
    if (!client) return false;
    for (let i = 0; i < BOARD_SIZE; i++) {
      for (let j = 0; j < BOARD_SIZE; j++) {
        if (b[i][j] === null) return false;
        const val = client.unseal(b[i][j]);
        if (i < BOARD_SIZE - 1 && val === client.unseal(b[i + 1][j])) return false;
        if (j < BOARD_SIZE - 1 && val === client.unseal(b[i][j + 1])) return false;
      }
    }
    return true;
  };

  const move = (direction: Direction) => {
    if (gameOver || !client || !initialized) return;

    let newBoard = board.map((row) => [...row]);
    let totalScoreAdd = 0;
    let moved = false;

    if (direction === "up") {
      newBoard = transpose(newBoard);
    } else if (direction === "right") {
      newBoard = reverseRows(newBoard);
    } else if (direction === "down") {
      newBoard = transpose(newBoard);
      newBoard = reverseRows(newBoard);
    }

    for (let i = 0; i < BOARD_SIZE; i++) {
      const [newRow, scoreAdd] = slideRowLeft(newBoard[i]);
      totalScoreAdd += scoreAdd;
      if (JSON.stringify(newRow) !== JSON.stringify(newBoard[i])) moved = true;
      newBoard[i] = newRow;
    }

    if (direction === "up") {
      newBoard = transpose(newBoard);
    } else if (direction === "right") {
      newBoard = reverseRows(newBoard);
    } else if (direction === "down") {
      newBoard = reverseRows(newBoard);
      newBoard = transpose(newBoard);
    }

    if (moved) {
      newBoard = addRandomTile(newBoard);
      setBoard(newBoard);
      setScore((prev) => prev + totalScoreAdd);

      let maxValue = 0;
      newBoard.forEach((row) =>
        row.forEach((val) => {
          if (val) {
            const plain = client.unseal(val);
            if (plain > maxValue) maxValue = plain;
          }
        })
      );

      setAchievements((prev) =>
        prev.map((ach) => {
          if (!ach.unlocked && maxValue >= ach.threshold) {
            return { ...ach, unlocked: true };
          }
          return ach;
        })
      );

      if (isGameOver(newBoard)) {
        setGameOver(true);
      }
    }
  };

  const handleClaimAchievement = async (id: AchievementId) => {
    if (!walletAddress) {
      setTxMessage("Please connect wallet");
      return;
    }
    setIsClaiming(true);
    setTxMessage("Sending transaction...");

    try {
      const provider = new BrowserProvider((window as any).ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const contract = new Contract(
        ACHIEVEMENT_CONTRACT_ADDRESS,
        ACHIEVEMENT_CONTRACT_ABI,
        signer
      );

      const levelIndex = id === "medium_power" ? 0 : id === "big_power" ? 1 : 2;

      const tx = await contract.mintAchievement(levelIndex);
      setTxMessage("Transaction sent, waiting...");
      await tx.wait();
      setTxMessage("NFT minted successfully!");

      setAchievements((prev) =>
        prev.map((ach) => (ach.id === id ? { ...ach, claimed: true } : ach))
      );
    } catch (err: any) {
      setTxMessage(`Error: ${err.message || "Unknown"}`);
      console.error(err);
    } finally {
      setIsClaiming(false);
    }
  };

  const connectWallet = async () => {
    if ((window as any).ethereum) {
      try {
        const provider = new BrowserProvider((window as any).ethereum);
        await provider.send("eth_requestAccounts", []);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();
        setWalletAddress(address);
      } catch (err) {
        console.error(err);
      }
    } else {
      alert("Please install MetaMask or compatible wallet");
    }
  };

  const disconnectWallet = () => {
    setWalletAddress(null);
    setTxMessage(null);
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
      }
      if (e.key === "ArrowUp") move("up");
      if (e.key === "ArrowDown") move("down");
      if (e.key === "ArrowLeft") move("left");
      if (e.key === "ArrowRight") move("right");
    };

    // Must be passive: false so preventDefault works for arrow keys
    window.addEventListener("keydown", handleKey, { passive: false } as any);
    return () => window.removeEventListener("keydown", handleKey as any);
  }, [board, gameOver, client, initialized]);

  const canPlay = initialized && !!client && !gameOver;

  return (
    <div className="h-[100dvh] overflow-hidden bg-background flex flex-col items-center justify-center px-4 py-3">
      <div className="w-full max-w-md flex flex-col items-center gap-3 pb-10">
        <div className="w-full">
          <h1 className="text-4xl font-bold text-center">Encrypted 2048 - test</h1>
          <p className="text-center text-muted-foreground">Score: {score}</p>
          {gameOver && <p className="text-center text-red-500 text-xl mt-1">Game over</p>}
          {error && <p className="text-center text-red-500 mt-1">{error}</p>}
          {!initialized && <p className="text-center text-foreground/70 mt-1">Loading FHE...</p>}
        </div>

        {/* Board always renders to keep layout stable; it becomes playable when initialized */}
        <div className="w-full bg-card rounded-xl shadow-2xl p-4">
          <div className="grid grid-cols-4 gap-2">
            {board.map((row, i) =>
              row.map((value, j) => (
                <div
                  key={`${i}-${j}`}
                  className={`aspect-square rounded-lg flex items-center justify-center text-2xl font-bold transition-all ${
                    value && client
                      ? getTileLevel(value, client).bgClass + " " + getTileLevel(value, client).textClass
                      : "bg-muted"
                  }`}
                >
                  {""}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 w-full">
          <div />
          <button
            className="bg-primary text-primary-foreground rounded-lg py-3 font-semibold disabled:opacity-50"
            onClick={() => move("up")}
            disabled={!canPlay}
          >
            Up
          </button>
          <div />
          <button
            className="bg-primary text-primary-foreground rounded-lg py-3 font-semibold disabled:opacity-50"
            onClick={() => move("left")}
            disabled={!canPlay}
          >
            Left
          </button>
          <button
            className="bg-primary text-primary-foreground rounded-lg py-3 font-semibold disabled:opacity-50"
            onClick={() => move("down")}
            disabled={!canPlay}
          >
            Down
          </button>
          <button
            className="bg-primary text-primary-foreground rounded-lg py-3 font-semibold disabled:opacity-50"
            onClick={() => move("right")}
            disabled={!canPlay}
          >
            Right
          </button>
        </div>

        {/* Color Legend */}
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-slate-700" />
            <span className="text-xs text-foreground/80">Tiny</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-blue-600" />
            <span className="text-xs text-foreground/80">Small</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-emerald-500" />
            <span className="text-xs text-foreground/80">Medium</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-violet-500" />
            <span className="text-xs text-foreground/80">Big</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-amber-500" />
            <span className="text-xs text-foreground/80">Legendary</span>
          </div>
        </div>

        {/* Achievements area with internal scrolling to avoid page scrolling */}
        <div className="w-full px-1">
          <h2 className="text-xs font-semibold text-foreground mb-2">
            FHE Achievements (on-chain ready)
          </h2>

          {txMessage && <div className="mb-2 text-[11px] text-foreground/80">{txMessage}</div>}

          <div className="space-y-2 text-xs text-foreground/80 max-h-44 overflow-auto pr-1">
            {achievements.map((ach) => {
              const levelMeta = TILE_LEVELS.find((l) => l.name === ach.level)!;
              const disabled = !ach.unlocked || ach.claimed || isClaiming;

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
                    <span className="text-[10px] text-foreground/60">
                      Threshold: value ≥ {ach.threshold}
                    </span>
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
                      onClick={() => handleClaimAchievement(ach.id)}
                    >
                      {ach.claimed ? "Claimed" : isClaiming ? "Claiming..." : "Claim NFT"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-2 text-[10px] text-foreground/60">
            When connected to Base Sepolia, claiming an achievement will call the on-chain CipherAchievements contract and mint a real NFT.
          </p>

          <div className="mt-3 flex gap-2">
            <button
              className="flex-1 py-2 bg-primary text-primary-foreground rounded-md"
              onClick={connectWallet}
            >
              {walletAddress
                ? `Connected: ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
                : "Connect wallet"}
            </button>

            <button
              className="py-2 px-3 rounded-md border border-border bg-background text-foreground disabled:opacity-50"
              onClick={disconnectWallet}
              disabled={!walletAddress}
            >
              Disconnect
            </button>
          </div>
        </div>
      </div>

      {/* Fixed footer so it never causes page scroll */}
      <p className="fixed bottom-3 left-0 right-0 text-center text-foreground/60 text-sm">
        Made with love by mora
      </p>
    </div>
  );
}
