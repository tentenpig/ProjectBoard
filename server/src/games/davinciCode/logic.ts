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
  phase: 'drawing' | 'guessing' | 'continue_or_stop' | 'game_over';
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

  return {
    players,
    pool,
    currentPlayerId: turnOrder[0],
    phase: 'drawing',
    drawnTile: null,
    lastGuessCorrect: false,
    winnerId: null,
    turnOrder,
    turnIndex: 0,
  };
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
    // Reveal drawn tile and place it
    state.drawnTile.revealed = true;
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

export function stopGuessing(state: DaVinciState, playerId: number, jokerPosition?: number): boolean {
  if (state.phase !== 'continue_or_stop' || state.currentPlayerId !== playerId) return false;

  if (state.drawnTile) {
    const player = state.players.find((p) => p.id === playerId)!;
    if (state.drawnTile.joker && jokerPosition !== undefined) {
      (state.drawnTile as any).sortValue = jokerPosition;
    }
    player.tiles.push(state.drawnTile);
    player.tiles = sortTiles(player.tiles);
    state.drawnTile = null;
  }

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
  };
}

export function getSpectatorView(state: DaVinciState) {
  return {
    ...getPlayerView(state, -1),
    spectating: true,
  };
}
