export const BOARD_SIZE = 15;

export type Stone = 'black' | 'white' | null;

export interface GomokuPlayer {
  id: number;
  nickname: string;
  color: 'black' | 'white';
  totalTime: number;   // remaining total time in ms
  moveTime: number;    // remaining time for current move in ms
}

export interface GomokuState {
  board: Stone[][];
  players: GomokuPlayer[];
  currentColor: 'black' | 'white';
  phase: 'playing' | 'game_over';
  winnerId: number | null;
  winReason: 'five' | 'timeout_total' | 'timeout_move' | 'resign' | null;
  winLine: { row: number; col: number }[] | null;
  lastMove: { row: number; col: number } | null;
  moveCount: number;
  totalTimeLimit: number;  // initial total time in ms
  moveTimeLimit: number;   // initial per-move time in ms
  turnStartedAt: number;   // timestamp when current turn started
}

export function initGame(
  playerInfos: { id: number; nickname: string }[],
  colorChoice: 'host-black' | 'host-white' | 'random',
  totalTimeMs: number,
  moveTimeMs: number,
): GomokuState {
  const board: Stone[][] = Array.from({ length: BOARD_SIZE }, () =>
    Array(BOARD_SIZE).fill(null)
  );

  let blackIdx = 0;
  if (colorChoice === 'host-white') blackIdx = 1;
  else if (colorChoice === 'random') blackIdx = Math.random() < 0.5 ? 0 : 1;

  const players: GomokuPlayer[] = playerInfos.map((info, i) => ({
    id: info.id,
    nickname: info.nickname,
    color: i === blackIdx ? 'black' : 'white',
    totalTime: totalTimeMs,
    moveTime: moveTimeMs,
  }));

  return {
    board,
    players,
    currentColor: 'black',
    phase: 'playing',
    winnerId: null,
    winReason: null,
    winLine: null,
    lastMove: null,
    moveCount: 0,
    totalTimeLimit: totalTimeMs,
    moveTimeLimit: moveTimeMs,
    turnStartedAt: Date.now(),
  };
}

export function placeStone(state: GomokuState, playerId: number, row: number, col: number): boolean {
  if (state.phase !== 'playing') return false;

  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.color !== state.currentColor) return false;

  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return false;
  if (state.board[row][col] !== null) return false;

  // Deduct time
  const elapsed = Date.now() - state.turnStartedAt;
  player.totalTime = Math.max(0, player.totalTime - elapsed);
  player.moveTime = state.moveTimeLimit; // reset for next turn

  state.board[row][col] = state.currentColor;
  state.lastMove = { row, col };
  state.moveCount++;

  // Check win
  const winLine = checkWin(state.board, row, col, state.currentColor);
  if (winLine) {
    state.phase = 'game_over';
    state.winnerId = player.id;
    state.winReason = 'five';
    state.winLine = winLine;
    return true;
  }

  // Check draw (board full)
  if (state.moveCount >= BOARD_SIZE * BOARD_SIZE) {
    state.phase = 'game_over';
    state.winnerId = null;
    state.winReason = null;
    return true;
  }

  // Switch turn
  state.currentColor = state.currentColor === 'black' ? 'white' : 'black';
  const nextPlayer = state.players.find((p) => p.color === state.currentColor)!;
  nextPlayer.moveTime = state.moveTimeLimit;
  state.turnStartedAt = Date.now();

  return true;
}

export function timeoutLoss(state: GomokuState, reason: 'timeout_total' | 'timeout_move'): void {
  if (state.phase !== 'playing') return;
  const loser = state.players.find((p) => p.color === state.currentColor)!;
  const winner = state.players.find((p) => p.color !== state.currentColor)!;
  state.phase = 'game_over';
  state.winnerId = winner.id;
  state.winReason = reason;
}

export function resign(state: GomokuState, playerId: number): boolean {
  if (state.phase !== 'playing') return false;
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return false;

  const winner = state.players.find((p) => p.id !== playerId)!;
  state.phase = 'game_over';
  state.winnerId = winner.id;
  state.winReason = 'resign';
  return true;
}

function checkWin(board: Stone[][], row: number, col: number, color: Stone): { row: number; col: number }[] | null {
  const directions = [
    [0, 1],  // horizontal
    [1, 0],  // vertical
    [1, 1],  // diagonal
    [1, -1], // anti-diagonal
  ];

  for (const [dr, dc] of directions) {
    const line: { row: number; col: number }[] = [{ row, col }];

    // Forward
    for (let i = 1; i < 5; i++) {
      const r = row + dr * i;
      const c = col + dc * i;
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break;
      if (board[r][c] !== color) break;
      line.push({ row: r, col: c });
    }

    // Backward
    for (let i = 1; i < 5; i++) {
      const r = row - dr * i;
      const c = col - dc * i;
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break;
      if (board[r][c] !== color) break;
      line.push({ row: r, col: c });
    }

    if (line.length >= 5) return line;
  }

  return null;
}

export function getPlayerView(state: GomokuState, playerId: number) {
  const now = Date.now();
  const elapsed = state.phase === 'playing' ? now - state.turnStartedAt : 0;
  const currentPlayer = state.players.find((p) => p.color === state.currentColor)!;

  return {
    board: state.board,
    players: state.players.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      color: p.color,
      totalTime: p.id === currentPlayer.id && state.phase === 'playing'
        ? Math.max(0, p.totalTime - elapsed) : p.totalTime,
      moveTime: p.id === currentPlayer.id && state.phase === 'playing'
        ? Math.max(0, p.moveTime - elapsed) : p.moveTime,
    })),
    currentColor: state.currentColor,
    phase: state.phase,
    winnerId: state.winnerId,
    winReason: state.winReason,
    winLine: state.winLine,
    lastMove: state.lastMove,
    moveCount: state.moveCount,
    totalTimeLimit: state.totalTimeLimit,
    moveTimeLimit: state.moveTimeLimit,
    myColor: state.players.find((p) => p.id === playerId)?.color || null,
  };
}

export function getSpectatorView(state: GomokuState) {
  return { ...getPlayerView(state, -1), spectating: true };
}
