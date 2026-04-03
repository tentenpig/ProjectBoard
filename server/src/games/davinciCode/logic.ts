export interface Tile {
  id: number;       // unique id
  number: number;   // 0-11, or -1 for joker
  color: 'black' | 'white';
  revealed: boolean;
  joker: boolean;
}

export interface DaVinciPlayer {
  id: number;
  nickname: string;
  tiles: Tile[];
  eliminated: boolean;
}

export interface DaVinciState {
  players: DaVinciPlayer[];
  pool: Tile[];
  currentPlayerId: number;
  phase: 'setup_jokers' | 'drawing' | 'guessing' | 'continue_or_stop' | 'place_drawn_joker' | 'game_over';
  pendingJokerPlayerIds: number[];
  drawnJokerRevealed: boolean;
  drawnTile: Tile | null;
  lastGuessCorrect: boolean;
  winnerId: number | null;
  turnOrder: number[];
  turnIndex: number;
}

function createTilePool(): Tile[] {
  const tiles: Tile[] = [];
  let id = 0;
  for (const color of ['black', 'white'] as const) {
    for (let n = 0; n <= 11; n++) {
      tiles.push({ id: id++, number: n, color, revealed: false, joker: false });
    }
    tiles.push({ id: id++, number: -1, color, revealed: false, joker: true });
  }
  return tiles;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Sort tiles by the Da Vinci Code rule: ascending number, black before white at same number
// Jokers keep their assigned position (we store a sortValue when placed)
export function sortTiles(tiles: Tile[]): Tile[] {
  return [...tiles].sort((a, b) => {
    const aVal = a.joker ? (a as any).sortValue ?? 99 : a.number;
    const bVal = b.joker ? (b as any).sortValue ?? 99 : b.number;
    if (aVal !== bVal) return aVal - bVal;
    // Same value: black before white
    if (a.color !== b.color) return a.color === 'black' ? -1 : 1;
    return 0;
  });
}

// Find the correct insert position for a tile in a sorted row
function findInsertPosition(tiles: Tile[], newTile: Tile, jokerPosition?: number): number {
  const val = newTile.joker ? (jokerPosition ?? 0) : newTile.number;
  for (let i = 0; i < tiles.length; i++) {
    const tVal = tiles[i].joker ? (tiles[i] as any).sortValue ?? 99 : tiles[i].number;
    if (val < tVal) return i;
    if (val === tVal) {
      // Same number: black goes left
      if (newTile.color === 'black' && tiles[i].color === 'white') return i;
    }
  }
  return tiles.length;
}

export function initGame(playerInfos: { id: number; nickname: string }[]): DaVinciState {
  const pool = shuffle(createTilePool());
  const startingTiles = playerInfos.length <= 2 ? 4 : 3;

  const players: DaVinciPlayer[] = playerInfos.map((info) => {
    const tiles: Tile[] = [];
    for (let i = 0; i < startingTiles; i++) {
      tiles.push(pool.pop()!);
    }
    return {
      id: info.id,
      nickname: info.nickname,
      tiles: sortTiles(tiles),
      eliminated: false,
    };
  });

  const turnOrder = players.map((p) => p.id);

  // Check which players have jokers that need positioning
  const pendingJokerPlayerIds = players
    .filter((p) => p.tiles.some((t) => t.joker))
    .map((p) => p.id);

  return {
    players,
    pool,
    currentPlayerId: turnOrder[0],
    phase: 'setup_jokers' as const,
    pendingJokerPlayerIds,
    drawnTile: null,
    drawnJokerRevealed: false,
    lastGuessCorrect: false,
    winnerId: null,
    turnOrder,
    turnIndex: 0,
  };
}

export function placeJoker(state: DaVinciState, playerId: number, jokerId: number, sortValue: number): boolean {
  if (state.phase !== 'setup_jokers') return false;
  if (!state.pendingJokerPlayerIds.includes(playerId)) return false;

  const player = state.players.find((p) => p.id === playerId);
  if (!player) return false;

  const joker = player.tiles.find((t) => t.id === jokerId && t.joker);
  if (!joker) return false;

  // Clamp sortValue to valid range (can be placed as if it were 0-12, with .5 increments for between)
  (joker as any).sortValue = Math.max(-0.5, Math.min(sortValue, 12));
  player.tiles = sortTiles(player.tiles);

  // Check if this player still has unpositioned jokers
  const hasUnpositioned = player.tiles.some((t) => t.joker && (t as any).sortValue === undefined);
  if (!hasUnpositioned) {
    state.pendingJokerPlayerIds = state.pendingJokerPlayerIds.filter((id) => id !== playerId);
  }

  // Note: phase transition to 'drawing' is handled by the socket layer with a random delay

  return true;
}

export function drawTile(state: DaVinciState, playerId: number): boolean {
  if (state.phase !== 'drawing' || state.currentPlayerId !== playerId) return false;

  if (state.pool.length > 0) {
    state.drawnTile = state.pool.pop()!;
    state.phase = 'guessing';
    return true;
  }

  // No tiles left, go straight to guessing without drawn tile
  state.drawnTile = null;
  state.phase = 'guessing';
  return true;
}

export interface GuessResult {
  correct: boolean;
  targetTile?: Tile;
}

export function guess(
  state: DaVinciState,
  playerId: number,
  targetPlayerId: number,
  tileIndex: number,
  guessedNumber: number // -1 for joker
): GuessResult | null {
  if (state.phase !== 'guessing' || state.currentPlayerId !== playerId) return null;

  const targetPlayer = state.players.find((p) => p.id === targetPlayerId);
  if (!targetPlayer || targetPlayer.eliminated || targetPlayer.id === playerId) return null;

  const tile = targetPlayer.tiles[tileIndex];
  if (!tile || tile.revealed) return null;

  const isCorrect = tile.joker ? guessedNumber === -1 : tile.number === guessedNumber;

  if (isCorrect) {
    tile.revealed = true;
    state.lastGuessCorrect = true;
    state.phase = 'continue_or_stop';

    // Check if target player is eliminated
    if (targetPlayer.tiles.every((t) => t.revealed)) {
      targetPlayer.eliminated = true;
    }

    // Check win condition
    const alive = state.players.filter((p) => !p.eliminated);
    if (alive.length === 1) {
      state.winnerId = alive[0].id;
      state.phase = 'game_over';
    }

    return { correct: true, targetTile: tile };
  }

  // Wrong guess
  state.lastGuessCorrect = false;

  if (state.drawnTile) {
    state.drawnTile.revealed = true;
    if (state.drawnTile.joker) {
      // Joker needs position selection before placement
      state.drawnJokerRevealed = true;
      state.phase = 'place_drawn_joker';
      return { correct: false, targetTile: tile };
    }
    const player = state.players.find((p) => p.id === playerId)!;
    player.tiles.push(state.drawnTile);
    player.tiles = sortTiles(player.tiles);
    state.drawnTile = null;
  } else {
    // No drawn tile (pool empty): reveal one of own hidden tiles
    // Reveal the first hidden tile (leftmost)
    const player = state.players.find((p) => p.id === playerId)!;
    const hiddenTile = player.tiles.find((t) => !t.revealed);
    if (hiddenTile) {
      hiddenTile.revealed = true;
    }
    // Check if this player is now eliminated
    if (player.tiles.every((t) => t.revealed)) {
      player.eliminated = true;
      const alive = state.players.filter((p) => !p.eliminated);
      if (alive.length === 1) {
        state.winnerId = alive[0].id;
        state.phase = 'game_over';
      }
    }
  }

  advanceTurn(state);
  return { correct: false, targetTile: tile };
}

export function continueGuessing(state: DaVinciState, playerId: number): boolean {
  if (state.phase !== 'continue_or_stop' || state.currentPlayerId !== playerId) return false;
  state.phase = 'guessing';
  return true;
}

export function stopGuessing(state: DaVinciState, playerId: number): boolean {
  if (state.phase !== 'continue_or_stop' || state.currentPlayerId !== playerId) return false;

  if (state.drawnTile) {
    if (state.drawnTile.joker) {
      // Need to select joker position before placing
      state.drawnJokerRevealed = false;
      state.phase = 'place_drawn_joker';
      return true;
    }
    const player = state.players.find((p) => p.id === playerId)!;
    player.tiles.push(state.drawnTile);
    player.tiles = sortTiles(player.tiles);
    state.drawnTile = null;
  }

  advanceTurn(state);
  return true;
}

export function placeDrawnJoker(state: DaVinciState, playerId: number, sortValue: number): boolean {
  if (state.phase !== 'place_drawn_joker' || state.currentPlayerId !== playerId) return false;
  if (!state.drawnTile || !state.drawnTile.joker) return false;

  (state.drawnTile as any).sortValue = Math.max(-0.5, Math.min(sortValue, 12));
  const player = state.players.find((p) => p.id === playerId)!;
  player.tiles.push(state.drawnTile);
  player.tiles = sortTiles(player.tiles);
  state.drawnTile = null;
  state.drawnJokerRevealed = false;

  advanceTurn(state);
  return true;
}

function advanceTurn(state: DaVinciState) {
  if (state.phase === 'game_over') return;

  const alive = state.players.filter((p) => !p.eliminated);
  if (alive.length <= 1) {
    state.winnerId = alive[0]?.id ?? null;
    state.phase = 'game_over';
    return;
  }

  // Move to next alive player
  do {
    state.turnIndex = (state.turnIndex + 1) % state.turnOrder.length;
    state.currentPlayerId = state.turnOrder[state.turnIndex];
  } while (state.players.find((p) => p.id === state.currentPlayerId)?.eliminated);

  state.phase = state.pool.length > 0 ? 'drawing' : 'guessing';
  state.drawnTile = null;
  state.lastGuessCorrect = false;
}

export function getPlayerView(state: DaVinciState, playerId: number) {
  return {
    players: state.players.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      eliminated: p.eliminated,
      tiles: p.tiles.map((t) => {
        if (t.revealed || p.id === playerId) {
          return { id: t.id, number: t.number, color: t.color, revealed: t.revealed, joker: t.joker };
        }
        return { id: t.id, number: null, color: t.color, revealed: false, joker: null };
      }),
      tileCount: p.tiles.length,
      hiddenCount: p.tiles.filter((t) => !t.revealed).length,
    })),
    poolCount: state.pool.length,
    currentPlayerId: state.currentPlayerId,
    phase: state.phase,
    drawnTile: state.currentPlayerId === playerId && state.drawnTile
      ? { id: state.drawnTile.id, number: state.drawnTile.number, color: state.drawnTile.color, joker: state.drawnTile.joker }
      : state.drawnTile ? { id: state.drawnTile.id, color: state.drawnTile.color } : null,
    lastGuessCorrect: state.lastGuessCorrect,
    winnerId: state.winnerId,
    needsJokerPlacement: state.phase === 'setup_jokers' && state.pendingJokerPlayerIds.includes(playerId),
    drawnJokerRevealed: state.drawnJokerRevealed,
  };
}

export function getSpectatorView(state: DaVinciState) {
  return {
    ...getPlayerView(state, -1),
    spectating: true,
  };
}
