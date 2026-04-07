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

const DIRS: [number, number][] = [[0, 1], [1, 0], [1, 1], [1, -1]];

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

function get(board: Stone[][], r: number, c: number): Stone {
  return inBounds(r, c) ? board[r][c] : 'wall' as any;
}

// ===== Pattern-based line extraction =====
// Extract a "window" of cells along a direction centered on (r,c)
// Returns the pattern string and positions
function extractLine(board: Stone[][], r: number, c: number, dr: number, dc: number, color: Stone): { pattern: string; positions: { r: number; c: number }[] } {
  const positions: { r: number; c: number }[] = [];
  let pattern = '';

  // Go backward to find start
  let startR = r, startC = c;
  for (let i = 1; i <= 5; i++) {
    const nr = r - dr * i, nc = c - dc * i;
    if (!inBounds(nr, nc)) break;
    startR = nr;
    startC = nc;
  }

  // Read forward from start
  let cr = startR, cc = startC;
  for (let i = 0; i < 11; i++) { // max window
    if (!inBounds(cr, cc)) {
      pattern += 'W';
      positions.push({ r: cr, c: cc });
    } else if (board[cr][cc] === color) {
      pattern += 'X';
      positions.push({ r: cr, c: cc });
    } else if (board[cr][cc] === null) {
      pattern += '.';
      positions.push({ r: cr, c: cc });
    } else {
      pattern += 'W';
      positions.push({ r: cr, c: cc });
    }
    cr += dr;
    cc += dc;
  }

  return { pattern, positions };
}

// ===== Exact line length through (r,c) =====
function lineLength(board: Stone[][], r: number, c: number, dr: number, dc: number, color: Stone): number {
  let len = 1;
  for (let i = 1; i < BOARD_SIZE; i++) {
    if (get(board, r + dr * i, c + dc * i) !== color) break;
    len++;
  }
  for (let i = 1; i < BOARD_SIZE; i++) {
    if (get(board, r - dr * i, c - dc * i) !== color) break;
    len++;
  }
  return len;
}

// ===== Count "open fours" in a direction =====
// Open four: exactly 4 stones where placing one more makes 5, with the missing spot being empty
// Patterns: .XXXX. (both ends open) or XXXX. / .XXXX (one end open)
function isOpenFourDir(board: Stone[][], r: number, c: number, dr: number, dc: number): boolean {
  const { pattern } = extractLine(board, r, c, dr, dc, 'black');
  // Find the position of (r,c) in the pattern - it should be 'X'
  // Check for open four patterns containing position of (r,c)
  // Open four with both ends: .XXXX.
  // Four with one end: .XXXX or XXXX.
  const fourPatterns = ['.XXXX.', '.XXXXW', 'WXXXX.'];
  for (const fp of fourPatterns) {
    let idx = pattern.indexOf(fp);
    while (idx !== -1) {
      // Count X's
      const xCount = (fp.match(/X/g) || []).length;
      if (xCount === 4) return true;
      idx = pattern.indexOf(fp, idx + 1);
    }
  }
  return false;
}

// ===== Renju: count "live threes" (活三) =====
// A live three is a pattern where one move creates an open four (.XXXX.)
// Live three patterns:
//   .XX.X.  .X.XX.  ..XXX.  .XXX..  .X.XX.  .XX.X.
// Simplified: check if placing stone creates a line of 3 that has potential to become open four

function countLiveThrees(board: Stone[][], r: number, c: number): number {
  // Stone already placed at (r,c)
  let count = 0;

  for (const [dr, dc] of DIRS) {
    // Extract the line pattern
    const { pattern, positions } = extractLine(board, r, c, dr, dc, 'black');

    // Find index of (r,c) in positions
    const myIdx = positions.findIndex((p) => p.r === r && p.c === c);
    if (myIdx === -1) continue;

    // Check if placing at (r,c) created a live three by trying each empty spot
    // A live three means: there exists an empty cell in this direction where placing
    // would create an open four (exactly 4 with both ends open)

    // Try each empty spot in the pattern near our position
    let isLiveThree = false;

    for (let i = Math.max(0, myIdx - 4); i < Math.min(positions.length, myIdx + 5); i++) {
      const pos = positions[i];
      if (!inBounds(pos.r, pos.c) || board[pos.r][pos.c] !== null) continue;

      // Temporarily place
      board[pos.r][pos.c] = 'black';

      // Check if this creates an open four (exactly 4 in a row with both ends open)
      let fwd = 0, bwd = 0;
      for (let j = 1; j < 6; j++) {
        if (get(board, pos.r + dr * j, pos.c + dc * j) !== 'black') break;
        fwd++;
      }
      for (let j = 1; j < 6; j++) {
        if (get(board, pos.r - dr * j, pos.c - dc * j) !== 'black') break;
        bwd++;
      }
      const totalLine = 1 + fwd + bwd;

      if (totalLine === 4) {
        // Check both ends are open
        const endFwd = { r: pos.r + dr * (fwd + 1), c: pos.c + dc * (fwd + 1) };
        const endBwd = { r: pos.r - dr * (bwd + 1), c: pos.c - dc * (bwd + 1) };
        const fwdOpen = inBounds(endFwd.r, endFwd.c) && board[endFwd.r][endFwd.c] === null;
        const bwdOpen = inBounds(endBwd.r, endBwd.c) && board[endBwd.r][endBwd.c] === null;

        if (fwdOpen && bwdOpen) {
          // Also check that this empty spot is not itself a forbidden move
          // (to avoid recursive issues, we skip this deep check for performance)
          isLiveThree = true;
          board[pos.r][pos.c] = null;
          break;
        }
      }

      board[pos.r][pos.c] = null;
    }

    if (isLiveThree) count++;
  }

  return count;
}

// ===== Renju: count "fours" (사) =====
function countFours(board: Stone[][], r: number, c: number): number {
  let count = 0;

  for (const [dr, dc] of DIRS) {
    const len = lineLength(board, r, c, dr, dc, 'black');
    if (len === 4) {
      // Check at least one end is open
      let fwd = 0, bwd = 0;
      for (let i = 1; i < 6; i++) {
        if (get(board, r + dr * i, c + dc * i) !== 'black') break;
        fwd++;
      }
      for (let i = 1; i < 6; i++) {
        if (get(board, r - dr * i, c - dc * i) !== 'black') break;
        bwd++;
      }
      const endFwd = { r: r + dr * (fwd + 1), c: c + dc * (fwd + 1) };
      const endBwd = { r: r - dr * (bwd + 1), c: c - dc * (bwd + 1) };
      const fwdOpen = inBounds(endFwd.r, endFwd.c) && board[endFwd.r][endFwd.c] === null;
      const bwdOpen = inBounds(endBwd.r, endBwd.c) && board[endBwd.r][endBwd.c] === null;
      if (fwdOpen || bwdOpen) count++;
    }

    // Also check for "broken four": X.XXX, XX.XX, XXX.X patterns
    // These are fours with a gap that still threaten to make 5
    const { pattern, positions } = extractLine(board, r, c, dr, dc, 'black');
    const myIdx = positions.findIndex((p) => p.r === r && p.c === c);
    if (myIdx === -1) continue;

    // Look for patterns where filling one empty makes exactly 5
    for (let i = Math.max(0, myIdx - 4); i < Math.min(positions.length, myIdx + 5); i++) {
      const pos = positions[i];
      if (!inBounds(pos.r, pos.c) || board[pos.r][pos.c] !== null) continue;

      board[pos.r][pos.c] = 'black';
      const newLen = lineLength(board, pos.r, pos.c, dr, dc, 'black');
      board[pos.r][pos.c] = null;

      if (newLen === 5) {
        // This empty spot completes a five - so current position contributes to a "four"
        // But only count if the line through (r,c) is part of this
        const lenThroughMe = lineLength(board, r, c, dr, dc, 'black');
        if (lenThroughMe >= 3) { // (r,c) is part of the four
          count++;
          break; // Only count once per direction
        }
      }
    }
  }

  // Deduplicate: each direction counted at most once
  // The above may double-count. Use a simpler approach:
  return Math.min(count, 4); // cap at 4 directions
}

// Simpler four counting: for each direction, check if there's a way to make exactly 5 by filling one gap
function countFoursSimple(board: Stone[][], r: number, c: number): number {
  let count = 0;
  for (const [dr, dc] of DIRS) {
    let hasFour = false;
    // Check all empty positions in this direction that would make a 5-line through (r,c)
    for (let offset = -4; offset <= 4; offset++) {
      const testR = r + dr * offset;
      const testC = c + dc * offset;
      if (!inBounds(testR, testC) || board[testR][testC] !== null) continue;
      if (testR === r && testC === c) continue;

      board[testR][testC] = 'black';
      const len = lineLength(board, r, c, dr, dc, 'black');
      board[testR][testC] = null;

      if (len === 5) {
        hasFour = true;
        break;
      }
    }
    if (hasFour) count++;
  }
  return count;
}

// ===== Main forbidden check =====
export function isForbidden(board: Stone[][], r: number, c: number): boolean {
  if (board[r][c] !== null) return false;

  board[r][c] = 'black';

  // If it makes exactly 5 in any direction, NOT forbidden
  for (const [dr, dc] of DIRS) {
    if (lineLength(board, r, c, dr, dc, 'black') === 5) {
      board[r][c] = null;
      return false;
    }
  }

  // Overline (6+)
  let overline = false;
  for (const [dr, dc] of DIRS) {
    if (lineLength(board, r, c, dr, dc, 'black') >= 6) {
      overline = true;
      break;
    }
  }

  // Double-three (3-3)
  const liveThrees = countLiveThrees(board, r, c);
  const doubleThree = liveThrees >= 2;

  // Double-four (4-4)
  const fours = countFoursSimple(board, r, c);
  const doubleFour = fours >= 2;

  board[r][c] = null;

  return overline || doubleThree || doubleFour;
}

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
      if (line.length === 5) return line;
    } else {
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

  if (state.currentColor === 'black' && isForbidden(state.board, row, col)) {
    return false;
  }

  const elapsed = Date.now() - state.turnStartedAt;
  player.totalTime = Math.max(0, player.totalTime - elapsed);
  player.moveTime = state.moveTimeLimit;

  state.board[row][col] = state.currentColor;
  state.lastMove = { row, col };
  state.moveCount++;

  const winLine = checkWin(state.board, row, col, state.currentColor);
  if (winLine) {
    state.phase = 'game_over';
    state.winnerId = player.id;
    state.winReason = 'five';
    state.winLine = winLine;
    return true;
  }

  if (state.moveCount >= BOARD_SIZE * BOARD_SIZE) {
    state.phase = 'game_over';
    state.winnerId = null;
    state.winReason = null;
    return true;
  }

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
