import { useEffect, useState } from "react";
import { BrowserProvider, Contract } from "ethers";
import { useFHE } from "../fhe/useFHE";

type CellValue = number | null;
type Board = CellValue[][];

type Direction = "left" | "right" | "up" | "down";

const BOARD_SIZE = 4;

const ACHIEVEMENT_CONTRACT_ADDRESS =
  "0xDE0c86c1c4607713Fd19e000661Ada864b6c493a";

const BASE_SEPOLIA_CHAIN_ID_DECIMAL = 84532;
const BASE_SEPOLIA_CHAIN_ID_HEX = "0x14a34";

const ACHIEVEMENT_CONTRACT_ABI = [
  {
    inputs: [
      {
        internalType: "uint8",
        name: "levelIndex",
        type: "uint8",
      },
    ],
    name: "mintAchievement",
    outputs: [
      {
        internalType: "uint256",
        name: "tokenId",
        type: "uint256",
      },
    ],
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

function getTileLevel(value: number): TileLevelMeta {
  if (value < 16) return TILE_LEVELS[0];
  else if (value < 128) return TILE_LEVELS[1];
  else if (value < 512) return TILE_LEVELS[2];
  else if (value < 2048) return TILE_LEVELS[3];
  else return TILE_LEVELS[4];
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
  const [board, setBoard] = useState<Board>([
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null],
  ]);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [achievements, setAchievements] = useState(INITIAL_ACHIEVEMENTS);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const [txMessage, setTxMessage] = useState<string | null>(null);

  const { initialized } = useFHE();

  const initializeBoard = () => {
    let newBoard = Array(BOARD_SIZE)
      .fill(null)
      .map(() => Array(BOARD_SIZE).fill(null));
    newBoard = addRandomTile(addRandomTile(newBoard));
    setBoard(newBoard);
    setScore(0);
    setGameOver(false);
    setAchievements(INITIAL_ACHIEVEMENTS);
  };

  const addRandomTile = (board: Board): Board => {
    const emptyCells: [number, number][] = [];
    for (let i = 0; i < BOARD_SIZE; i++) {
      for (let j = 0; j < BOARD_SIZE; j++) {
        if (board[i][j] === null) emptyCells.push([i, j]);
      }
    }
    if (emptyCells.length === 0) return board;
    const [row, col] = emptyCells[Math.floor(Math.random() * emptyCells.length)];
    const newBoard = board.map(row => [...row]);
    newBoard[row][col] = Math.random() < 0.9 ? 2 : 4;
    return newBoard;
  };

  const move = (direction: Direction) => {
    if (gameOver) return;

    let newBoard = board.map(row => [...row]);
    let moved = false;
    let addedScore = 0;

    if (direction === "right") {
      newBoard = newBoard.map(row => row.reverse());
    } else if (direction === "down") {
      newBoard = newBoard[0].map((_, i) => newBoard.map(row => row[i])).reverse();
    } else if (direction === "left") {
      newBoard = newBoard[0].map((_, i) => newBoard.map(row => row[i]).reverse()).map(row => row.reverse());
    }

    for (let i = 0; i < BOARD_SIZE; i++) {
      let row = newBoard[i].filter(val => val !== null);
      for (let j = 0; j < row.length - 1; j++) {
        if (row[j] === row[j + 1]) {
          row[j] *= 2;
          addedScore += row[j];
          row.splice(j + 1, 1);
          j--;
          moved = true;
        }
      }
      row = row.concat(Array(BOARD_SIZE - row.length).fill(null));
      newBoard[i] = row;
      if (JSON.stringify(row) !== JSON.stringify(board[i])) moved = true;
    }

    if (moved) {
      newBoard = addRandomTile(newBoard);
      setBoard(newBoard);
      setScore(prev => prev + addedScore);

      let maxValue = 0;
      newBoard.forEach(row => row.forEach(val => {
        if (val && val > maxValue) maxValue = val;
      }));

      setAchievements(prev => prev.map(ach => {
        if (!ach.unlocked && maxValue >= ach.threshold) {
          return { ...ach, unlocked: true };
        }
        return ach;
      }));

      if (isGameOver(newBoard)) {
        setGameOver(true);
      }
    }
  };

  const isGameOver = (board: Board) => {
    for (let i = 0; i < BOARD_SIZE; i++) {
      for (let j = 0; j < BOARD_SIZE; j++) {
        if (board[i][j] === null) return false;
        if (i < BOARD_SIZE - 1 && board[i][j] === board[i + 1][j]) return false;
        if (j < BOARD_SIZE - 1 && board[i][j] === board[i][j + 1]) return false;
      }
    }
    return true;
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

      const contract = new Contract(ACHIEVEMENT_CONTRACT_ADDRESS, ACHIEVEMENT_CONTRACT_ABI, signer);

      let levelIndex: number;
      if (id === "medium_power") levelIndex = 0;
      else if (id === "big_power") levelIndex = 1;
      else levelIndex = 2;

      const tx = await contract.mintAchievement(levelIndex);
      setTxMessage("Transaction sent, waiting for confirmation...");
      await tx.wait();
      setTxMessage("NFT minted successfully!");

      setAchievements(prev => prev.map(ach => ach.id === id ? { ...ach, claimed: true } : ach));
    } catch (err: any) {
      console.error(err);
      setTxMessage(`Error: ${err.message || "Unknown"}`);
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

  useEffect(() => {
    initializeBoard();
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp") move("up");
      else if (e.key === "ArrowRight") move("right");
      else if (e.key === "ArrowDown") move("down");
      else if (e.key === "ArrowLeft") move("left");
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [board, gameOver]);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full">
        <h1 className="text-4xl font-bold text-center mb-2">Encrypted 2048 - test</h1>
        <p className="text-center text-muted-foreground mb-8">Score: {score}</p>
        {gameOver && <p className="text-center text-red-500 text-xl mb-4">Game over</p>}
        {initialized ? (
          <div className="bg-card rounded-xl shadow-2xl p-4 mb-8">
            <div className="grid grid-cols-4 gap-2">
              {board.map((row, i) =>
                row.map((value, j) => (
                  <div
                    key={`${i}-${j}`}
                    className={`aspect-square rounded-lg flex items-center justify-center text-2xl font-bold transition-all ${
                      value ? getTileLevel(value).bgClass + " " + getTileLevel(value).textClass : "bg-muted"
                    }`}
                  >
                    {""}
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <p className="text-center">Loading FHE...</p>
        )}

        <div className="grid grid-cols-3 gap-4 mb-8">
          <div />
          <button className="bg-primary text-primary-foreground rounded-lg py-4 font-semibold" onClick={() => move("up")}>
            Up
          </button>
          <div />
          <button className="bg-primary text-primary-foreground rounded-lg py-4 font-semibold" onClick={() => move("left")}>
            Left
          </button>
          <button className="bg-primary text-primary-foreground rounded-lg py-4 font-semibold" onClick={() => move("down")}>
            Down
          </button>
          <button className="bg-primary text-primary-foreground rounded-lg py-4 font-semibold" onClick={() => move("right")}>
            Right
          </button>
        </div>

        <div className="mt-4 w-full max-w-md px-4">
          <h2 className="text-sm font-semibold text-foreground mb-2">
            FHE Achievements (on-chain ready)
          </h2>

          {txMessage && (
            <div className="mb-2 text-[11px] text-foreground/80">{txMessage}</div>
          )}

          <div className="space-y-2 text-xs text-foreground/80">
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
                      <span className="font-semibold text-foreground text-xs">
                        {ach.title}
                      </span>
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
                      {ach.claimed
                        ? "Claimed"
                        : isClaiming
                          ? "Claiming..."
                          : "Claim NFT"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] text-foreground/60">
            When connected to Base Sepolia, claiming an achievement will call the
            on-chain CipherAchievements contract and mint a real NFT. This
            frontend uses ethers.js to send the transaction from your wallet.
          </p>
          <button
            className="mt-4 w-full py-2 bg-primary text-primary-foreground rounded-md"
            onClick={connectWallet}
          >
            {walletAddress ? `Connected: ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : "Connect wallet"}
          </button>
        </div>
      </div>
              {/* Color Legend */}
        <div className="flex items-center justify-center gap-6 my-8 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-slate-700" />
            <span className="text-sm text-foreground/80">Tiny</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-blue-600" />
            <span className="text-sm text-foreground/80">Small</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-emerald-500" />
            <span className="text-sm text-foreground/80">Medium</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-violet-500" />
            <span className="text-sm text-foreground/80">Big</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-amber-500" />
            <span className="text-sm text-foreground/80">Legendary</span>
          </div>
        </div>

        {/* Footer Credit */}
        <p className="text-center text-foreground/60 text-sm mt-12">
          Made with love by mora
        </p>
    </div>
  );
}