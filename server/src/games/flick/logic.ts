// ===== Flick Game (알까기) =====
// Turn-based team flicking game with server-side physics

export const BOARD_W = 600;
export const BOARD_H = 600;
export const STONE_RADIUS = 15;
export const FRICTION = 0.97;
export const MIN_SPEED = 0.3;
export const MAX_POWER = 18;
export const SIMULATION_DT = 1 / 60;
export const STONES_PER_TEAM = 5;

export interface Stone {
  id: number;
  team: 0 | 1;
  x: number;
  y: number;
  vx: number;
  vy: number;
  alive: boolean;
}

export interface FlickPlayer {
  id: number;
  nickname: string;
  team: 0 | 1;
  connected: boolean;
}

export interface FlickState {
  stones: Stone[];
  players: FlickPlayer[];
  currentTeam: 0 | 1;
  currentPlayerIndex: number; // index within team's player list
  phase: 'aiming' | 'simulating' | 'game_over';
  winnerId: number | null; // winning team (0 or 1), stored as team number
  winningTeam: 0 | 1 | null;
  winReason: 'eliminate' | 'abandon' | null;
  turnCount: number;
  simulationFrames: { stones: { id: number; x: number; y: number; alive: boolean }[] }[] | null;
}

export function initGame(playerInfos: { id: number; nickname: string }[], teamsMap?: Map<number, 0 | 1>): FlickState {
  const players: FlickPlayer[] = playerInfos.map((info, i) => ({
    id: info.id,
    nickname: info.nickname,
    team: teamsMap?.get(info.id) ?? (i % 2) as 0 | 1,
    connected: true,
  }));

  // Place stones
  const stones: Stone[] = [];
  let stoneId = 0;

  // Team 0: left side
  for (let i = 0; i < STONES_PER_TEAM; i++) {
    stones.push({
      id: stoneId++,
      team: 0,
      x: 120 + (i % 3) * 40,
      y: 200 + Math.floor(i / 3) * 80 + (i % 3) * 30,
      vx: 0, vy: 0,
      alive: true,
    });
  }

  // Team 1: right side
  for (let i = 0; i < STONES_PER_TEAM; i++) {
    stones.push({
      id: stoneId++,
      team: 1,
      x: 480 - (i % 3) * 40,
      y: 200 + Math.floor(i / 3) * 80 + (i % 3) * 30,
      vx: 0, vy: 0,
      alive: true,
    });
  }

  return {
    stones,
    players,
    currentTeam: 0,
    currentPlayerIndex: 0,
    phase: 'aiming',
    winnerId: null,
    winningTeam: null,
    winReason: null,
    turnCount: 0,
    simulationFrames: null,
  };
}

export function getCurrentPlayerId(state: FlickState): number | null {
  const teamPlayers = state.players.filter((p) => p.team === state.currentTeam && p.connected);
  if (teamPlayers.length === 0) return null;
  const idx = state.currentPlayerIndex % teamPlayers.length;
  return teamPlayers[idx].id;
}

export function flickStone(state: FlickState, playerId: number, stoneId: number, dx: number, dy: number): boolean {
  if (state.phase !== 'aiming') return false;
  if (getCurrentPlayerId(state) !== playerId) return false;

  const stone = state.stones.find((s) => s.id === stoneId);
  if (!stone || !stone.alive || stone.team !== state.currentTeam) return false;

  // Clamp power
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag === 0) return false;
  const power = Math.min(mag, MAX_POWER);
  const nx = (dx / mag) * power;
  const ny = (dy / mag) * power;

  stone.vx = nx;
  stone.vy = ny;

  // Run simulation
  state.phase = 'simulating';
  state.simulationFrames = runSimulation(state.stones);
  state.turnCount++;

  // Don't apply final positions yet — wait for applySimulation()
  return true;
}

export function applySimulation(state: FlickState): void {
  if (state.phase !== 'simulating' || !state.simulationFrames) return;

  const finalFrame = state.simulationFrames[state.simulationFrames.length - 1];
  for (const fs of finalFrame.stones) {
    const s = state.stones.find((x) => x.id === fs.id)!;
    s.x = fs.x;
    s.y = fs.y;
    s.alive = fs.alive;
    s.vx = 0;
    s.vy = 0;
  }

  state.simulationFrames = null;

  // Check win
  const team0Alive = state.stones.filter((s) => s.team === 0 && s.alive).length;
  const team1Alive = state.stones.filter((s) => s.team === 1 && s.alive).length;

  if (team0Alive === 0) {
    state.phase = 'game_over';
    state.winningTeam = 1;
    state.winReason = 'eliminate';
    return;
  }
  if (team1Alive === 0) {
    state.phase = 'game_over';
    state.winningTeam = 0;
    state.winReason = 'eliminate';
    return;
  }

  // Advance turn
  advanceTurn(state);
}

function advanceTurn(state: FlickState) {
  // Switch team
  state.currentTeam = state.currentTeam === 0 ? 1 : 0;

  // Check if the team has connected players
  const teamPlayers = state.players.filter((p) => p.team === state.currentTeam && p.connected);
  if (teamPlayers.length === 0) {
    // No connected players on this team — other team wins
    state.phase = 'game_over';
    state.winningTeam = state.currentTeam === 0 ? 1 : 0;
    state.winReason = 'abandon';
    return;
  }

  // Rotate player within team
  state.currentPlayerIndex = (state.currentPlayerIndex + 1) % teamPlayers.length;
  state.phase = 'aiming';
  state.simulationFrames = null;
}

export function confirmSimulation(state: FlickState): boolean {
  if (state.phase !== 'simulating') return false;
  // Client signals it finished playing animation
  // Already advanced in flickStone, just set phase
  // Actually phase is already set in flickStone after advanceTurn
  return true;
}

export function playerDisconnected(state: FlickState, playerId: number): void {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return;
  player.connected = false;

  // Check if entire team disconnected
  const teamPlayers = state.players.filter((p) => p.team === player.team && p.connected);
  if (teamPlayers.length === 0 && state.phase !== 'game_over') {
    state.phase = 'game_over';
    state.winningTeam = player.team === 0 ? 1 : 0;
    state.winReason = 'abandon';
  }

  // If current player left, advance
  if (state.phase === 'aiming' && getCurrentPlayerId(state) === null) {
    advanceTurn(state);
  }
}

// ===== Physics simulation =====
function runSimulation(stones: Stone[]): { stones: { id: number; x: number; y: number; alive: boolean }[] }[] {
  // Deep copy for simulation
  const sim = stones.filter((s) => s.alive).map((s) => ({
    id: s.id, team: s.team,
    x: s.x, y: s.y, vx: s.vx, vy: s.vy,
    alive: true, radius: STONE_RADIUS,
  }));

  const frames: { stones: { id: number; x: number; y: number; alive: boolean }[] }[] = [];
  const maxTicks = 300; // ~5 seconds at 60fps

  for (let tick = 0; tick < maxTicks; tick++) {
    // Move
    for (const s of sim) {
      if (!s.alive) continue;
      s.x += s.vx;
      s.y += s.vy;
      s.vx *= FRICTION;
      s.vy *= FRICTION;

      // Stop if too slow
      if (Math.abs(s.vx) < MIN_SPEED && Math.abs(s.vy) < MIN_SPEED) {
        s.vx = 0;
        s.vy = 0;
      }
    }

    // Collision between stones
    for (let i = 0; i < sim.length; i++) {
      for (let j = i + 1; j < sim.length; j++) {
        const a = sim[i], b = sim[j];
        if (!a.alive || !b.alive) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = a.radius + b.radius;

        if (dist < minDist && dist > 0) {
          // Elastic collision
          const nx = dx / dist;
          const ny = dy / dist;

          const dvx = a.vx - b.vx;
          const dvy = a.vy - b.vy;
          const dot = dvx * nx + dvy * ny;

          if (dot > 0) {
            a.vx -= dot * nx;
            a.vy -= dot * ny;
            b.vx += dot * nx;
            b.vy += dot * ny;
          }

          // Separate overlapping
          const overlap = minDist - dist;
          a.x -= (overlap / 2) * nx;
          a.y -= (overlap / 2) * ny;
          b.x += (overlap / 2) * nx;
          b.y += (overlap / 2) * ny;
        }
      }
    }

    // Out of bounds check
    for (const s of sim) {
      if (!s.alive) continue;
      if (s.x - s.radius < 0 || s.x + s.radius > BOARD_W ||
          s.y - s.radius < 0 || s.y + s.radius > BOARD_H) {
        s.alive = false;
        s.vx = 0;
        s.vy = 0;
      }
    }

    // Record frame (every 2 ticks to reduce data)
    if (tick % 2 === 0) {
      frames.push({
        stones: sim.map((s) => ({ id: s.id, team: s.team, x: Math.round(s.x * 10) / 10, y: Math.round(s.y * 10) / 10, alive: s.alive })),
      });
    }

    // Check if all stopped
    const allStopped = sim.every((s) => !s.alive || (s.vx === 0 && s.vy === 0));
    if (allStopped && tick > 5) break;
  }

  // Ensure final frame
  frames.push({
    stones: sim.map((s) => ({ id: s.id, team: s.team, x: Math.round(s.x * 10) / 10, y: Math.round(s.y * 10) / 10, alive: s.alive })),
  });

  return frames;
}

export function getPlayerView(state: FlickState, playerId: number) {
  const myTeam = state.players.find((p) => p.id === playerId)?.team ?? null;
  return {
    stones: state.stones.map((s) => ({ id: s.id, team: s.team, x: s.x, y: s.y, alive: s.alive })),
    players: state.players.map((p) => ({ id: p.id, nickname: p.nickname, team: p.team, connected: p.connected })),
    currentTeam: state.currentTeam,
    currentPlayerId: getCurrentPlayerId(state),
    phase: state.phase,
    winningTeam: state.winningTeam,
    winReason: state.winReason,
    turnCount: state.turnCount,
    myTeam,
  };
}

export function getSpectatorView(state: FlickState) {
  return { ...getPlayerView(state, -1), spectating: true };
}
