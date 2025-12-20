import { useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract } from "ethers";
import { useFHE } from "../fhe/useFHE";

type EncryptedValue = any;
type CellValue = EncryptedValue | null;
type Board = CellValue[][];

type Direction = "left" | "right" | "up" | "down";

const BOARD_SIZE = 4;

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

const TILE_LEVELS: { name: TileLevelName; bg: string }[] = [
  { name: "Tiny", bg: "bg-slate-700" },
  { name: "Small", bg: "bg-blue-600" },
  { name: "Medium", bg: "bg-emerald-500" },
  { name: "Big", bg: "bg-violet-500" },
  { name: "Legendary", bg: "bg-amber-500" },
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

function getTileLevel(value: number): TileLevelName {
  if (value >= 2048) return "Legendary";
  if (value >= 512) return "Big";
  if (value >= 128) return "Medium";
  if (value >= 4) return "Small";
  return "Tiny";
}

export default function Home() {
  const { client, initialized, status, error, initWithEthers, createSelfPermit, resetPermit } = useFHE();

  const [board, setBoard] = useState<Board>(
    Array(BOARD_SIZE)
      .fill(null)
      .map(() => Array(BOARD_SIZE).fill(null))
  );
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);

  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [txMessage, setTxMessage] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);

  const [achievements, setAchievements] = useState<Achievement[]>(INITIAL_ACHIEVEMENTS);

  const canEnableFhe = useMemo(() => {
    return !!walletAddress && (status === "cdn-loaded" || status === "permit-required" || status === "error");
  }, [walletAddress, status]);

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
    const encrypted = client.encrypt32(plainValue);

    newBoard[r][c] = encrypted;
    return newBoard;
  };

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

  useEffect(() => {
    if (initialized && client) {
      initializeBoard();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized]);

  const slideRowLeft = (row: CellValue[]): [CellValue[], number] => {
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

    while (filtered.length < BOARD_SIZE) filtered.push(null);
    return [filtered as CellValue[], scoreAdd];
  };

  const rotateBoardRight = (b: Board): Board => {
    const rotated: Board = Array(BOARD_SIZE)
      .fill(null)
      .map(() => Array(BOARD_SIZE).fill(null));
    for (let i = 0; i < BOARD_SIZE; i++) {
      for (let j = 0; j < BOARD_SIZE; j++) {
        rotated[j][BOARD_SIZE - 1 - i] = b[i][j];
      }
    }
    return rotated;
  };

  const move = (dir: Direction) => {
    if (gameOver) return;

    let newBoard = board.map((row) => [...row]);

    const rotateTimes =
      dir === "left" ? 0 : dir === "up" ? 3 : dir === "right" ? 2 : 1;

    for (let k = 0; k < rotateTimes; k++) newBoard = rotateBoardRight(newBoard);

    let gained = 0;
    const movedBoard = newBoard.map((row) => {
      const [slid, scoreAdd] = slideRowLeft(row);
      gained += scoreAdd;
      return slid;
    });

    for (let k = 0; k < (4 - rotateTimes) % 4; k++) {
      // rotate back left (3 rights)
      movedBoard = rotateBoardRight(movedBoard);
      movedBoard = rotateBoardRight(movedBoard);
      movedBoard = rotateBoardRight(movedBoard);
    }

    const changed = JSON.stringify(movedBoard) !== JSON.stringify(board);
    if (!changed) return;

    const withNewTile = addRandomTile(movedBoard);

    setBoard(withNewTile);
    setScore((s) => s + gained);

    // Update achievements based on max value (hidden from UI, but used internally)
    let maxValue = 0;
    withNewTile.forEach((r) =>
      r.forEach((val) => {
        if (val !== null) {
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

    if (isGameOver(withNewTile)) setGameOver(true);
  };

  const isGameOver = (b: Board): boolean => {
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

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Prevent arrow keys from scrolling the page
      if (e.key.startsWith("Arrow")) e.preventDefault();

      if (e.key === "ArrowLeft") move("left");
      if (e.key === "ArrowRight") move("right");
      if (e.key === "ArrowUp") move("up");
      if (e.key === "ArrowDown") move("down");
    };

    window.addEventListener("keydown", handleKey, { passive: false });
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, gameOver]);

  const connectWallet = async () => {
    try {
      setTxMessage(null);
      const provider = new BrowserProvider((window as any).ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const addr = await signer.getAddress();
      setWalletAddress(addr);
      setTxMessage(null);
    } catch (e: any) {
      setTxMessage(e?.message ?? String(e));
    }
  };

  const disconnectWallet = () => {
    // We cannot force MetaMask to disconnect, but we can clear app state.
    setWalletAddress(null);
    setTxMessage(null);
    setIsClaiming(false);
    resetPermit();
  };

  const enableFHE = async () => {
    try {
      setTxMessage(null);
      if (!walletAddress) {
        await connectWallet();
      }
      const provider = new BrowserProvider((window as any).ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const addr = await signer.getAddress();

      const okInit = await initWithEthers({ provider, signer, environment: "TESTNET" });
      if (!okInit) {
        setTxMessage("FHE init failed. Check console for details.");
        return;
      }

      const okPermit = await createSelfPermit({ issuer: addr, daysValid: 30 });
      if (!okPermit) {
        setTxMessage("Permit generation failed. You can retry or Reset Permit.");
        return;
      }

      setTxMessage("FHE enabled successfully.");
    } catch (e: any) {
      setTxMessage(e?.message ?? String(e));
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
      const contract = new Contract(ACHIEVEMENT_CONTRACT_ADDRESS, ACHIEVEMENT_CONTRACT_ABI, signer);

      const levelIndex = id === "medium_power" ? 0 : id === "big_power" ? 1 : 2;

      const tx = await contract.mintAchievement(levelIndex);
      setTxMessage("Transaction sent. Waiting confirmation...");
      await tx.wait();

      setAchievements((prev) =>
        prev.map((a) => (a.id === id ? { ...a, claimed: true } : a))
      );
      setTxMessage("Mint successful!");
    } catch (e: any) {
      setTxMessage(e?.message ?? String(e));
    } finally {
      setIsClaiming(false);
    }
  };

  const renderCell = (val: CellValue) => {
    if (val === null) return "bg-slate-100";
    const plain = client.unseal(val);
    const level = getTileLevel(plain);
    return TILE_LEVELS.find((t) => t.name === level)!.bg;
  };

  return (
    <div className="h-[100svh] overflow-hidden bg-background p-4">
      <div className="mx-auto w-full max-w-md h-full flex flex-col">
        <header className="shrink-0">
          <h1 className="text-4xl font-bold text-center mb-1">Encrypted 2048 - test</h1>
          <p className="text-center text-muted-foreground">Score: {score}</p>
          {gameOver && <p className="text-center text-red-500 text-xl mt-2">Game over</p>}
        </header>

        {/* FHE Access */}
        <div className="shrink-0 mt-3 border border-border rounded-lg p-3 bg-card/40">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <div className="text-sm font-semibold text-foreground">FHE Access</div>
              <div className="text-[11px] text-foreground/70">
                Status: {status === "ready" ? "Ready" : status === "permit-required" ? "Permit required" : status}
              </div>
              {error && <div className="text-[11px] text-red-500 mt-1">{error}</div>}
              {txMessage && <div className="text-[11px] text-foreground/80 mt-1">{txMessage}</div>}
              {walletAddress && (
                <div className="text-[11px] text-foreground/70 mt-1">Wallet: {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}</div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <button
                className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-xs disabled:opacity-50"
                onClick={enableFHE}
                disabled={!canEnableFhe}
              >
                Enable FHE (Generate Permit)
              </button>

              <button
                className="px-3 py-2 rounded-md border border-border text-xs"
                onClick={resetPermit}
              >
                Reset Permit
              </button>
            </div>
          </div>
        </div>

        {/* Game board */}
        <div className="shrink-0 mt-3 bg-card rounded-xl shadow-2xl p-4">
          <div className="grid grid-cols-4 gap-2">
            {board.map((row, i) =>
              row.map((value, j) => (
                <div
                  key={`${i}-${j}`}
                  className={`w-full aspect-square rounded-lg ${renderCell(value)}`}
                />
              ))
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="shrink-0 mt-4 flex flex-col items-center gap-3">
          <button
            className="w-32 py-2 bg-primary text-primary-foreground rounded-md"
            onClick={() => move("up")}
          >
            Up
          </button>
          <div className="flex gap-3">
            <button
              className="w-32 py-2 bg-primary text-primary-foreground rounded-md"
              onClick={() => move("left")}
            >
              Left
            </button>
            <button
              className="w-32 py-2 bg-primary text-primary-foreground rounded-md"
              onClick={() => move("down")}
            >
              Down
            </button>
            <button
              className="w-32 py-2 bg-primary text-primary-foreground rounded-md"
              onClick={() => move("right")}
            >
              Right
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="shrink-0 mt-4 flex flex-wrap justify-center gap-4">
          {TILE_LEVELS.map((t) => (
            <div key={t.name} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded ${t.bg}`} />
              <span className="text-sm text-foreground/80">{t.name}</span>
            </div>
          ))}
        </div>

        {/* Achievements (internal scroll, page stays fixed) */}
        <div className="mt-4 flex-1 overflow-hidden">
          <h2 className="text-sm font-semibold text-foreground mb-2 px-1">
            FHE Achievements (on-chain ready)
          </h2>

          <div className="h-full max-h-[220px] overflow-y-auto space-y-2 text-xs text-foreground/80 pr-1">
            {achievements.map((ach) => {
              const disabled = !ach.unlocked || ach.claimed || isClaiming;
              const levelMeta = TILE_LEVELS.find((t) => t.name === ach.level)!;

              return (
                <div
                  key={ach.id}
                  className="border border-border rounded-lg px-3 py-2 flex items-center justify-between gap-3 bg-card/40"
                >
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border border-border">
                        {ach.level.toUpperCase()}
                      </span>
                      <span className="font-semibold text-foreground text-xs">{ach.title}</span>
                    </div>
                    <span className="text-[11px]">{ach.description}</span>
                    <span className="text-[10px] text-foreground/60">
                      Threshold: value ≥ {ach.threshold}
                    </span>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <span className="text-[10px] text-foreground/60">
                      {ach.claimed ? "Claimed" : ach.unlocked ? "Unlocked" : "Locked"}
                    </span>
                    <button
                      className="px-3 py-1.5 rounded-md border border-border text-[11px] disabled:opacity-50"
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

          <p className="mt-2 text-[10px] text-foreground/60 px-1">
            When connected to Base Sepolia, claiming an achievement will call the on-chain CipherAchievements contract and mint a real NFT.
          </p>

          <div className="mt-3 px-1 flex gap-2">
            <button
              className="flex-1 py-2 bg-primary text-primary-foreground rounded-md"
              onClick={connectWallet}
            >
              {walletAddress
                ? `Connected: ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
                : "Connect wallet"}
            </button>

            <button
              className="px-4 py-2 rounded-md border border-border"
              onClick={disconnectWallet}
              disabled={!walletAddress}
            >
              Disconnect
            </button>
          </div>
        </div>

        <footer className="shrink-0 pt-3 text-center text-foreground/60 text-xs">
          Made with love by mora
        </footer>
      </div>
    </div>
  );
}
