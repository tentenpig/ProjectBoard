export const BOARD_SIZE = 15;

export type Stone = 'black' | 'white' | null;

export interface GomokuPlayer {
  id: number;
  nickname: string;
  color: 'black' | 'white';
  totalTime: number;
  moveTime: number;
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
  totalTimeLimit: number;
  moveTimeLimit: number;
  turnStartedAt: number;
}

// ===== Helpers =====
const DIRS: [number, number][] = [[0, 1], [1, 0], [1, 1], [1, -1]];

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

// Count consecutive stones in one direction
function countConsecutive(board: Stone[][], r: number, c: number, dr: number, dc: number, color: Stone): number {
  let count = 0;
  for (let i = 1; i < BOARD_SIZE; i++) {
    const nr = r + dr * i, nc = c + dc * i;
    if (!inBounds(nr, nc) || board[nr][nc] !== color) break;
    count++;
  }
  return count;
}

// Get the full line length through (r,c) in a direction
function lineLength(board: Stone[][], r: number, c: number, dr: number, dc: number, color: Stone): number {
  return 1 + countConsecutive(board, r, c, dr, dc, color) + countConsecutive(board, r, c, -dr, -dc, color);
}

// Check if there's an exact 5-in-a-row through (r,c) for the color
function hasExactFive(board: Stone[][], r: number, c: number, color: Stone): boolean {
  for (const [dr, dc] of DIRS) {
    const len = lineLength(board, r, c, dr, dc, color);
    if (len === 5) return true;
    // For white, 5+ is still a win (no overline restriction)
    if (color === 'white' && len >= 5) return true;
  }
  return false;
}

// ===== Overline (長目) check for black =====
function hasOverline(board: Stone[][], r: number, c: number): boolean {
  for (const [dr, dc] of DIRS) {
    if (lineLength(board, r, c, dr, dc, 'black') >= 6) return true;
  }
  return false;
}

// ===== Open-line analysis for renju =====
// An "open three" is a line of exactly 3 that can become an open four (eventually 5).
// An "open four" is a line of exactly 4 with at least one open end that can reach 5.

interface LineInfo {
  length: number;
  openEnds: number; // 0, 1, or 2
}

function analyzeLine(board: Stone[][], r: number, c: number, dr: number, dc: number, color: Stone): LineInfo {
  // Count forward
  let fwd = 0;
  for (let i = 1; i < BOARD_SIZE; i++) {
    const nr = r + dr * i, nc = c + dc * i;
    if (!inBounds(nr, nc) || board[nr][nc] !== color) break;
    fwd++;
  }
  // Check forward open end
  const fwdEnd = { r: r + dr * (fwd + 1), c: c + dc * (fwd + 1) };
  const fwdOpen = inBounds(fwdEnd.r, fwdEnd.c) && board[fwdEnd.r][fwdEnd.c] === null;

  // Count backward
  let bwd = 0;
  for (let i = 1; i < BOARD_SIZE; i++) {
    const nr = r - dr * i, nc = c - dc * i;
    if (!inBounds(nr, nc) || board[nr][nc] !== color) break;
    bwd++;
  }
  // Check backward open end
  const bwdEnd = { r: r - dr * (bwd + 1), c: c - dc * (bwd + 1) };
  const bwdOpen = inBounds(bwdEnd.r, bwdEnd.c) && board[bwdEnd.r][bwdEnd.c] === null;

  return {
    length: 1 + fwd + bwd,
    openEnds: (fwdOpen ? 1 : 0) + (bwdOpen ? 1 : 0),
  };
}

// Count "open threes" created by placing black at (r,c)
// Open three: exactly 3 in a row with 2 open ends
function countOpenThrees(board: Stone[][], r: number, c: number): number {
  let count = 0;
  for (const [dr, dc] of DIRS) {
    const info = analyzeLine(board, r, c, dr, dc, 'black');
    if (info.length === 3 && info.openEnds === 2) {
      // Verify this three can actually form a non-forbidden four
      // by checking if extending would not create overline
      count++;
    }
  }
  return count;
}

// Count "fours" created by placing black at (r,c)
// Four: exactly 4 in a row with at least 1 open end
function countFours(board: Stone[][], r: number, c: number): number {
  let count = 0;
  for (const [dr, dc] of DIRS) {
    const info = analyzeLine(board, r, c, dr, dc, 'black');
    if (info.length === 4 && info.openEnds >= 1) {
      count++;
    }
  }
  return count;
}

// ===== Renju forbidden move check for BLACK =====
export function isForbidden(board: Stone[][], r: number, c: number): boolean {
  if (board[r][c] !== null) return false;

  // Temporarily place
  board[r][c] = 'black';

  // If it makes exactly 5, it's NOT forbidden (winning move)
  let isExactFive = false;
  for (const [dr, dc] of DIRS) {
    if (lineLength(board, r, c, dr, dc, 'black') === 5) {
      isExactFive = true;
      break;
    }
  }

  if (isExactFive) {
    board[r][c] = null;
    return false;
  }

  // Check overline (6+)
  const overline = hasOverline(board, r, c);

  // Check double-three (3-3)
  const openThrees = countOpenThrees(board, r, c);
  const doubleThree = openThrees >= 2;

  // Check double-four (4-4)
  const fours = countFours(board, r, c);
  const doubleFour = fours >= 2;

  board[r][c] = null;

  return overline || doubleThree || doubleFour;
}

// Get all forbidden positions for black
export function getForbiddenPositions(board: Stone[][]): { row: number; col: number }[] {
  const forbidden: { row: number; col: number }[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === null && isForbidden(board, r, c)) {
        forbidden.push({ row: r, col: c });
      }
    }
  }
  return forbidden;
}

// ===== Win check =====
function checkWin(board: Stone[][], row: number, col: number, color: Stone): { row: number; col: number }[] | null {
  for (const [dr, dc] of DIRS) {
    const line: { row: number; col: number }[] = [{ row, col }];

    for (let i = 1; i < BOARD_SIZE; i++) {
      const r = row + dr * i, c = col + dc * i;
      if (!inBounds(r, c) || board[r][c] !== color) break;
      line.push({ row: r, col: c });
    }
    for (let i = 1; i < BOARD_SIZE; i++) {
      const r = row - dr * i, c = col - dc * i;
      if (!inBounds(r, c) || board[r][c] !== color) break;
      line.push({ row: r, col: c });
    }

    if (color === 'black') {
      // Black must have EXACTLY 5
      if (line.length === 5) return line;
    } else {
      // White wins with 5 or more
      if (line.length >= 5) return line.slice(0, 5);
    }
  }
  return null;
}

// ===== Game functions =====
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

  if (!inBounds(row, col) || state.board[row][col] !== null) return false;

  // Renju: check forbidden for black
  if (state.currentColor === 'black' && isForbidden(state.board, row, col)) {
    return false;
  }

  // Deduct time
  const elapsed = Date.now() - state.turnStartedAt;
  player.totalTime = Math.max(0, player.totalTime - elapsed);
  player.moveTime = state.moveTimeLimit;

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

  // Check draw
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

export function getPlayerView(state: GomokuState, playerId: number) {
  const now = Date.now();
  const elapsed = state.phase === 'playing' ? now - state.turnStartedAt : 0;
  const currentPlayer = state.players.find((p) => p.color === state.currentColor)!;

  // Calculate forbidden positions if it's black's turn
  const forbidden = state.phase === 'playing' && state.currentColor === 'black'
    ? getForbiddenPositions(state.board) : [];

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
    forbidden,
  };
}

export function getSpectatorView(state: GomokuState) {
  return { ...getPlayerView(state, -1), spectating: true };
}
