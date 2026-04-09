import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import pool from '../config/database';
import { calculateLevel, calcReward } from '../config/level';
import { updateLeaderboard } from '../config/redis';
import {
  GameState,
  initRound,
  selectCard,
  unselectCard,
  allPlayersSelected,
  beginResolve,
  resolveNextCard,
  chooseRow,
  isTurnDone,
  isRoundOver,
  endRound,
  startNewRound,
  getPlayerView,
  PlaceResult,
} from '../games/sixNimmt/logic';
import {
  DaVinciState,
  initGame as initDaVinci,
  placeJoker,
  drawTile,
  guess as daVinciGuess,
  continueGuessing,
  stopGuessing,
  placeDrawnJoker,
  getPlayerView as getDaVinciPlayerView,
  getSpectatorView as getDaVinciSpectatorView,
} from '../games/davinciCode/logic';
import {
  GomokuState,
  initGame as initGomoku,
  placeStone,
  timeoutLoss,
  resign as gomokuResign,
  getPlayerView as getGomokuPlayerView,
  getSpectatorView as getGomokuSpectatorView,
  isForbidden,
} from '../games/gomoku/logic';
import {
  DalmutiState,
  initGame as initDalmuti,
  playCards as dalmutiPlayCards,
  pass as dalmutiPass,
  startNextRound as dalmutiNextRound,
  getPlayerView as getDalmutiPlayerView,
  getSpectatorView as getDalmutiSpectatorView,
} from '../games/dalmuti/logic';

import {
  FlickState,
  initGame as initFlick,
  flickStone,
  applySimulation as flickApplySimulation,
  playerDisconnected as flickPlayerDisconnected,
  getCurrentPlayerId as flickCurrentPlayer,
  getPlayerView as getFlickPlayerView,
  getSpectatorView as getFlickSpectatorView,
} from '../games/flick/logic';
import { pickFish } from '../routes/fishing';

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';

interface UserInfo {
  id: number;
  nickname: string;
}

interface Room {
  id: string;
  name: string;
  hostId: number;
  gameType: string;
  maxPlayers: number;
  players: UserInfo[];
  spectators: UserInfo[];
  botIds: Set<number>;
  replacementBotIds: Set<number>;  // bots that replaced real players (count as human for EXP)
  gameState: GameState | null;
  davinciState: DaVinciState | null;
  gomokuState: GomokuState | null;
  gomokuTimer: ReturnType<typeof setInterval> | null;
  gomokuSettings: { totalTime: number; moveTime: number; colorChoice: string };
  teams: Map<number, 0 | 1>; // playerId -> team (0 or 1)
  dalmutiState: DalmutiState | null;
  flickState: FlickState | null;
  status: 'waiting' | 'playing';
  readyForNext: Set<number>;
}

let nextBotId = -1;
function createBot(): UserInfo {
  const id = nextBotId--;
  const names = ['알파', '베타', '감마', '델타', '엡실론', '제타', '에타', '세타', '이오타', '카파'];
  const name = names[Math.abs(id + 1) % names.length];
  return { id, nickname: `BOT ${name}` };
}

const rooms = new Map<string, Room>();
const userSockets = new Map<number, Socket>();
export const onlineNicknames = new Set<string>();
const chatHistory = new Map<string, { nickname: string; text: string; timestamp: number }[]>();

const CHAT_HISTORY_LIMIT = 20;

function addChatMessage(channel: string, msg: { nickname: string; text: string; timestamp: number }) {
  if (!chatHistory.has(channel)) chatHistory.set(channel, []);
  const history = chatHistory.get(channel)!;
  history.push(msg);
  if (history.length > CHAT_HISTORY_LIMIT) history.shift();
}

async function grantExp(io: Server, room: Room, rewards: { playerId: number; exp: number; reason: string }[]) {
  for (const r of rewards) {
    if (r.exp <= 0) continue;
    try {
      await pool.query('UPDATE users SET exp = exp + ? WHERE id = ?', [r.exp, r.playerId]);
      const [rows] = await pool.query<any[]>('SELECT id, nickname, exp FROM users WHERE id = ?', [r.playerId]);
      if (rows.length > 0) {
        const { id, nickname, exp } = rows[0];
        const levelInfo = calculateLevel(exp);

        // Update Redis leaderboard
        updateLeaderboard(id, nickname, exp).catch((err) => console.error('Redis update error:', err));

        const s = userSockets.get(r.playerId);
        if (s) {
          s.emit('exp:gained', { exp: r.exp, totalExp: exp, reason: r.reason, ...levelInfo });
        }
      }
    } catch (err) {
      console.error('Grant EXP error:', err);
    }
  }
}

function gomokuBotMove(io: Server, room: Room) {
  if (!room.gomokuState || room.gomokuState.phase !== 'playing') return;
  const currentPlayer = room.gomokuState.players.find((p) => p.color === room.gomokuState!.currentColor);
  if (!currentPlayer || !room.botIds.has(currentPlayer.id)) return;

  const state = room.gomokuState;
  const board = state.board;
  const myColor = state.currentColor;
  const oppColor = myColor === 'black' ? 'white' : 'black';

  // Score each empty cell
  let bestScore = -1;
  let bestMove = { row: 7, col: 7 };

  const countDir = (r: number, c: number, dr: number, dc: number, color: string): number => {
    let count = 0;
    for (let i = 1; i < 5; i++) {
      const nr = r + dr * i, nc = c + dc * i;
      if (nr < 0 || nr >= 15 || nc < 0 || nc >= 15 || board[nr][nc] !== color) break;
      count++;
    }
    return count;
  };

  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      if (board[r][c] !== null) continue;
      // Skip forbidden positions for black
      if (myColor === 'black' && isForbidden(board, r, c)) continue;
      let score = 0;
      const dirs = [[0,1],[1,0],[1,1],[1,-1]];
      for (const [dr, dc] of dirs) {
        const myFwd = countDir(r, c, dr, dc, myColor);
        const myBwd = countDir(r, c, -dr, -dc, myColor);
        const myLine = myFwd + myBwd;
        const oppFwd = countDir(r, c, dr, dc, oppColor);
        const oppBwd = countDir(r, c, -dr, -dc, oppColor);
        const oppLine = oppFwd + oppBwd;

        if (myLine >= 4) score += 100000;      // Win
        else if (oppLine >= 4) score += 50000;  // Block win
        else if (myLine >= 3) score += 5000;
        else if (oppLine >= 3) score += 3000;
        else if (myLine >= 2) score += 500;
        else if (oppLine >= 2) score += 300;
        else score += myLine * 10 + oppLine * 8;
      }
      // Prefer center
      score += Math.max(0, 7 - Math.abs(r - 7) - Math.abs(c - 7));

      if (score > bestScore) {
        bestScore = score;
        bestMove = { row: r, col: c };
      }
    }
  }

  setTimeout(() => {
    if (!room.gomokuState || room.gomokuState.phase !== 'playing') return;
    placeStone(room.gomokuState, currentPlayer.id, bestMove.row, bestMove.col);
    broadcastGameState(io, room);
    if (room.gomokuState.phase === 'game_over') {
      if (room.gomokuTimer) clearInterval(room.gomokuTimer);
      grantGomokuExp(io, room);
    } else {
      gomokuBotMove(io, room);
    }
  }, 500 + Math.random() * 1000);
}

function dalmutiBotTurn(io: Server, room: Room) {
  if (!room.dalmutiState || room.dalmutiState.phase !== 'playing') return;
  const currentId = room.dalmutiState.currentPlayerId;
  if (!room.botIds.has(currentId)) return;

  const state = room.dalmutiState;
  const player = state.players.find((p) => p.id === currentId);
  if (!player || player.finished || player.passed) return;

  setTimeout(() => {
    if (!room.dalmutiState || room.dalmutiState.currentPlayerId !== currentId) return;

    const hand = player.hand;
    const trick = state.currentTrick;

    if (!trick) {
      // Leading: play the highest rank (weakest) set to save strong cards
      // Group hand by rank
      const groups = new Map<number, number>();
      for (const c of hand) groups.set(c.rank, (groups.get(c.rank) || 0) + 1);

      // Play the highest rank group (weakest cards first)
      let bestRank = -1;
      let bestCount = 0;
      for (const [rank, count] of groups) {
        if (rank === 13) continue; // don't lead with jesters alone
        if (rank > bestRank) { bestRank = rank; bestCount = count; }
      }

      if (bestRank > 0) {
        const cardRanks = Array(bestCount).fill(bestRank);
        dalmutiPlayCards(state, currentId, cardRanks);
      } else {
        // Only jesters left
        dalmutiPlayCards(state, currentId, [13]);
      }
    } else {
      // Must match count and beat rank
      const needed = trick.count;
      const maxRank = trick.effectiveRank - 1;

      // Group hand by rank
      const groups = new Map<number, number>();
      for (const c of hand) groups.set(c.rank, (groups.get(c.rank) || 0) + 1);
      const jesterCount = groups.get(13) || 0;

      // Find a playable combination: prefer weakest valid play
      let played = false;
      for (let rank = maxRank; rank >= 1; rank--) {
        const have = groups.get(rank) || 0;
        if (have >= needed) {
          dalmutiPlayCards(state, currentId, Array(needed).fill(rank));
          played = true;
          break;
        }
        // Try with jesters
        if (have > 0 && have + jesterCount >= needed) {
          const cardRanks = Array(have).fill(rank).concat(Array(needed - have).fill(13));
          dalmutiPlayCards(state, currentId, cardRanks);
          played = true;
          break;
        }
      }

      if (!played) {
        dalmutiPass(state, currentId);
      }
    }

    broadcastGameState(io, room);

    if (state.phase === 'game_over') {
      grantDalmutiExp(io, room);
      return;
    }

    if (state.phase === 'round_end') {
      // Bots auto-ready
      for (const botId of room.botIds) room.readyForNext.add(botId);
      return;
    }

    // Next turn might be a bot
    dalmutiBotTurn(io, room);
  }, 600 + Math.random() * 800);
}

function grantFlickExp(io: Server, room: Room) {
  if (!room.flickState || room.flickState.phase !== 'game_over') return;
  const humanCount = countEffectiveHumans(room);
  const participate = calcReward('gomoku', 'participate', humanCount);
  const winBonus = calcReward('gomoku', 'win', humanCount);
  if (participate <= 0 && winBonus <= 0) return;
  const wt = room.flickState.winningTeam;
  const rewards = room.flickState.players
    .filter((p) => !room.botIds.has(p.id))
    .map((p) => ({
      playerId: p.id,
      exp: participate + (wt !== null && p.team === wt ? winBonus : 0),
      reason: wt !== null && p.team === wt ? '알까기 승리' : '알까기 참가',
    }));
  grantExp(io, room, rewards);
}

function grantDalmutiExp(io: Server, room: Room) {
  if (!room.dalmutiState || room.dalmutiState.phase !== 'game_over') return;
  const humanCount = countEffectiveHumans(room);
  const participate = calcReward('dalmuti', 'participate', humanCount);
  const winBonus = calcReward('dalmuti', 'win', humanCount);
  if (participate <= 0 && winBonus <= 0) return;
  // Winner = player with most 1st place finishes across rounds
  const scoreboard: Record<number, number> = {};
  for (const round of room.dalmutiState.roundResults) {
    for (const r of round) {
      scoreboard[r.playerId] = (scoreboard[r.playerId] || 0) + (room.dalmutiState.players.length - r.position + 1);
    }
  }
  const maxScore = Math.max(...Object.values(scoreboard));
  const winnerId = Object.entries(scoreboard).find(([, v]) => v === maxScore)?.[0];

  const rewards = room.dalmutiState.players
    .filter((p) => !room.botIds.has(p.id))
    .map((p) => ({
      playerId: p.id,
      exp: participate + (String(p.id) === winnerId ? winBonus : 0),
      reason: String(p.id) === winnerId ? '달무티 승리' : '달무티 참가',
    }));
  grantExp(io, room, rewards);
}

function grantGomokuExp(io: Server, room: Room) {
  if (!room.gomokuState || room.gomokuState.phase !== 'game_over') return;
  const humanCount = countEffectiveHumans(room);
  const participate = calcReward('gomoku', 'participate', humanCount);
  const winBonus = calcReward('gomoku', 'win', humanCount);
  if (participate <= 0 && winBonus <= 0) return;
  const rewards = room.gomokuState.players
    .filter((p) => !room.botIds.has(p.id))
    .map((p) => ({
      playerId: p.id,
      exp: participate + (p.id === room.gomokuState!.winnerId ? winBonus : 0),
      reason: p.id === room.gomokuState!.winnerId ? '오목 승리' : '오목 참가',
    }));
  grantExp(io, room, rewards);
}

function autoAssignTeam(room: Room, playerId: number) {
  if (room.gameType !== 'flick') return;
  const team0 = Array.from(room.teams.values()).filter((t) => t === 0).length;
  const team1 = Array.from(room.teams.values()).filter((t) => t === 1).length;
  room.teams.set(playerId, team0 <= team1 ? 0 : 1);
}

function broadcastFishingCounts(io: Server) {
  const counts: Record<string, number> = { river: 0, lake: 0, sea: 0 };
  for (const loc of ['river', 'lake', 'sea']) {
    const room = io.sockets.adapter.rooms.get(`fishing:${loc}`);
    counts[loc] = room?.size || 0;
  }
  io.emit('fishing:counts', counts);
}

function broadcastRoomList(io: Server) {
  const roomList = Array.from(rooms.values()).map((r) => ({
    id: r.id,
    name: r.name,
    hostId: r.hostId,
    hostNickname: r.players.find((p) => p.id === r.hostId)?.nickname,
    gameType: r.gameType,
    maxPlayers: r.maxPlayers,
    playerCount: r.players.length,
    status: r.status,
  }));
  io.to('lobby').emit('room:list', roomList);
  io.to('lobby').emit('online:users', Array.from(onlineNicknames));
}

function broadcastRoomState(io: Server, room: Room) {
  io.to(room.id).emit('room:state', {
    id: room.id,
    name: room.name,
    hostId: room.hostId,
    gameType: room.gameType,
    maxPlayers: room.maxPlayers,
    players: room.players.map((p) => ({ id: p.id, nickname: p.nickname })),
    spectators: room.spectators.map((s) => ({ id: s.id, nickname: s.nickname })),
    botIds: Array.from(room.botIds),
    status: room.status,
    gomokuSettings: room.gomokuSettings,
    teams: Object.fromEntries(room.teams),
  });
}

function broadcastGameState(io: Server, room: Room) {
  if (room.flickState) {
    for (const player of room.players) {
      const s = userSockets.get(player.id);
      if (s) s.emit('game:state', { gameType: 'flick', ...getFlickPlayerView(room.flickState, player.id) });
    }
    for (const spec of room.spectators) {
      const s = userSockets.get(spec.id);
      if (s) s.emit('game:state', { gameType: 'flick', ...getFlickSpectatorView(room.flickState) });
    }
    return;
  }

  if (room.dalmutiState) {
    for (const player of room.players) {
      const s = userSockets.get(player.id);
      if (s) s.emit('game:state', { gameType: 'dalmuti', ...getDalmutiPlayerView(room.dalmutiState, player.id) });
    }
    for (const spec of room.spectators) {
      const s = userSockets.get(spec.id);
      if (s) s.emit('game:state', { gameType: 'dalmuti', ...getDalmutiSpectatorView(room.dalmutiState) });
    }
    return;
  }

  if (room.gomokuState) {
    for (const player of room.players) {
      const socket = userSockets.get(player.id);
      if (socket) {
        socket.emit('game:state', { gameType: 'gomoku', ...getGomokuPlayerView(room.gomokuState, player.id) });
      }
    }
    for (const spec of room.spectators) {
      const socket = userSockets.get(spec.id);
      if (socket) {
        socket.emit('game:state', { gameType: 'gomoku', ...getGomokuSpectatorView(room.gomokuState) });
      }
    }
    return;
  }

  if (room.davinciState) {
    for (const player of room.players) {
      const socket = userSockets.get(player.id);
      if (socket) {
        socket.emit('game:state', { gameType: 'davinci-code', ...getDaVinciPlayerView(room.davinciState, player.id) });
      }
    }
    for (const spec of room.spectators) {
      const socket = userSockets.get(spec.id);
      if (socket) {
        socket.emit('game:state', { gameType: 'davinci-code', ...getDaVinciSpectatorView(room.davinciState) });
      }
    }
    return;
  }

  if (!room.gameState) return;
  for (const player of room.players) {
    const socket = userSockets.get(player.id);
    if (socket) {
      socket.emit('game:state', { gameType: 'six-nimmt', ...getPlayerView(room.gameState, player.id) });
    }
  }
  const spectatorView = { ...getPlayerView(room.gameState, -1), spectating: true, gameType: 'six-nimmt' };
  for (const spec of room.spectators) {
    const socket = userSockets.get(spec.id);
    if (socket) {
      socket.emit('game:state', spectatorView);
    }
  }
}

async function resolveCards(io: Server, room: Room) {
  if (!room.gameState) return;

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  while (room.gameState.phase === 'resolving') {
    const result = resolveNextCard(room.gameState);
    if (!result) break;

    if (result.type === 'must_choose') {
      // Broadcast that this player needs to choose
      broadcastGameState(io, room);
      io.to(room.id).emit('game:event', {
        type: 'must_choose_row',
        playerId: result.playerId,
        card: result.card,
      });

      // If it's a bot, auto-choose after short delay
      if (room.botIds.has(result.playerId)) {
        setTimeout(() => {
          botChooseRow(io, room);
          if (room.gameState) {
            const chooseResult = room.gameState.sortedPlays[room.gameState.currentResolveIndex - 1];
            if (chooseResult) {
              io.to(room.id).emit('game:event', {
                type: 'took_row',
                playerId: result.playerId,
                card: result.card,
                rowIndex: room.gameState.rows.findIndex((r) => r[0]?.number === result.card.number),
              });
            }
            broadcastGameState(io, room);
            setTimeout(() => resolveCards(io, room), 800);
          }
        }, 1000);
        return;
      }

      return; // Wait for human player to choose
    }

    // Broadcast the placement event
    io.to(room.id).emit('game:event', {
      type: result.type,
      playerId: result.playerId,
      card: result.card,
      rowIndex: result.rowIndex,
      takenCards: result.takenCards,
    });

    broadcastGameState(io, room);
    await delay(800);

    if (isTurnDone(room.gameState)) {
      if (isRoundOver(room.gameState)) {
        const roundResult = endRound(room.gameState);
        io.to(room.id).emit('game:round_end', roundResult);
        broadcastGameState(io, room);

        // Grant EXP for six-nimmt
        const humanCount = countEffectiveHumans(room);
        const roundExp = calcReward('six-nimmt', 'perRound', humanCount);
        const winExp = calcReward('six-nimmt', 'win', humanCount);
        if (roundExp > 0 || winExp > 0) {
          const minScore = Math.min(...roundResult.scores.map((x: any) => x.totalScore));
          const expRewards = roundResult.scores
            .filter((s: any) => !room.botIds.has(s.playerId))
            .map((s: any) => ({
              playerId: s.playerId,
              exp: roundExp + (roundResult.gameOver && s.totalScore === minScore ? winExp : 0),
              reason: roundResult.gameOver && s.totalScore === minScore ? '젝스님트 승리' : '라운드 완료',
            }));
          grantExp(io, room, expRewards);
        }

        // Bots auto-ready for next round
        if (!roundResult.gameOver) {
          for (const botId of room.botIds) {
            room.readyForNext.add(botId);
          }
        }
        return;
      }

      // Start next turn
      room.gameState.phase = 'selecting';
      room.gameState.sortedPlays = [];
      room.gameState.currentResolveIndex = 0;
      autoSelectIfLastCard(io, room);
      if (room.gameState.phase === 'selecting') {
        botSelectCards(io, room);
      }
      broadcastGameState(io, room);
      return;
    }
  }
}

function botSelectCards(io: Server, room: Room) {
  if (!room.gameState || room.gameState.phase !== 'selecting') return;

  for (const botId of room.botIds) {
    const player = room.gameState.players.find((p) => p.id === botId);
    if (!player || player.selectedCard || player.hand.length === 0) continue;

    // Simple AI: pick a card that fits well
    // Prefer cards slightly above a row's last card, avoid very low/high
    const rows = room.gameState.rows;
    const rowEnds = rows.map((r) => r[r.length - 1].number);
    const hand = player.hand;

    let bestCard = hand[Math.floor(Math.random() * hand.length)];
    let bestScore = -Infinity;

    for (const card of hand) {
      let score = 0;
      // Find which row this card would go to
      let targetRowEnd = -1;
      for (const end of rowEnds) {
        if (end < card.number && end > targetRowEnd) targetRowEnd = end;
      }
      if (targetRowEnd >= 0) {
        // Card fits a row - prefer small gap
        const gap = card.number - targetRowEnd;
        score = 100 - gap;
        // Avoid being the 5th card in a row
        const rowIdx = rowEnds.indexOf(targetRowEnd);
        if (rows[rowIdx].length >= 4) score -= 50;
      } else {
        // Card lower than all rows - bad
        score = -card.number;
      }

      if (score > bestScore) {
        bestScore = score;
        bestCard = card;
      }
    }

    selectCard(room.gameState, botId, bestCard.number);
  }
}

function botChooseRow(io: Server, room: Room) {
  if (!room.gameState || room.gameState.phase !== 'choosing_row') return;
  if (!room.gameState.choosingPlayerId || !room.botIds.has(room.gameState.choosingPlayerId)) return;

  // Choose row with fewest bull heads
  const rows = room.gameState.rows;
  let bestRow = 0;
  let bestPenalty = Infinity;
  for (let i = 0; i < rows.length; i++) {
    const penalty = rows[i].reduce((s, c) => s + c.bullHeads, 0);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestRow = i;
    }
  }

  chooseRow(room.gameState, room.gameState.choosingPlayerId, bestRow);
}

// ===== Da Vinci Code Bot AI =====
function daVinciBotTurn(io: Server, room: Room) {
  if (!room.davinciState) return;
  const state = room.davinciState;
  if (!room.botIds.has(state.currentPlayerId)) return;

  const botId = state.currentPlayerId;

  const runPhase = () => {
    if (!room.davinciState || room.davinciState.currentPlayerId !== botId) return;

    if (state.phase === 'setup_jokers') {
      // Place jokers at random positions
      const bot = state.players.find((p) => p.id === botId);
      if (bot) {
        for (const tile of bot.tiles) {
          if (tile.joker && (tile as any).sortValue === undefined) {
            const pos = Math.floor(Math.random() * 12) + 0.5;
            placeJoker(state, botId, tile.id, pos);
          }
        }
      }
      broadcastGameState(io, room);
      return;
    }

    if (state.phase === 'drawing') {
      drawTile(state, botId);
      broadcastGameState(io, room);
      setTimeout(runPhase, 800);
      return;
    }

    if (state.phase === 'guessing') {
      // Find a target: pick an opponent with hidden tiles
      const opponents = state.players.filter((p) => p.id !== botId && !p.eliminated);
      const target = opponents.find((p) => p.tiles.some((t) => !t.revealed));
      if (!target) return;

      const hiddenTiles = target.tiles.map((t, i) => ({ tile: t, index: i })).filter((x) => !x.tile.revealed);
      if (hiddenTiles.length === 0) return;

      // Pick a random hidden tile and make an educated guess
      const pick = hiddenTiles[Math.floor(Math.random() * hiddenTiles.length)];

      // Gather known info to make a smarter guess
      const knownNumbers = new Set<string>();
      for (const p of state.players) {
        for (const t of p.tiles) {
          if (t.revealed) knownNumbers.add(`${t.color}_${t.number}`);
        }
      }
      // Bot's own tiles
      const botPlayer = state.players.find((p) => p.id === botId)!;
      for (const t of botPlayer.tiles) {
        knownNumbers.add(`${t.color}_${t.number}`);
      }

      // Find possible numbers for this tile based on position and color
      const possibleNums: number[] = [];
      for (let n = 0; n <= 11; n++) {
        if (!knownNumbers.has(`${pick.tile.color}_${n}`)) possibleNums.push(n);
      }
      if (!knownNumbers.has(`${pick.tile.color}_-1`)) possibleNums.push(-1); // joker

      const guessNum = possibleNums.length > 0
        ? possibleNums[Math.floor(Math.random() * possibleNums.length)]
        : Math.floor(Math.random() * 12);

      const result = daVinciGuess(state, botId, target.id, pick.index, guessNum);
      if (result) {
        io.to(room.id).emit('davinci:guess_result', {
          playerId: botId,
          targetPlayerId: target.id,
          tileIndex: pick.index,
          guessedNumber: guessNum,
          correct: result.correct,
          revealedTile: result.correct ? result.targetTile : null,
        });
        broadcastGameState(io, room);

        if (state.phase === 'game_over') {
          // Grant EXP
          const botDvHumanCount = countEffectiveHumans(room);
          const botDvParticipate = calcReward('davinci-code', 'participate', botDvHumanCount);
          const botDvWin = calcReward('davinci-code', 'win', botDvHumanCount);
          if (botDvParticipate > 0 || botDvWin > 0) {
            const expRewards = state.players.filter((p) => !room.botIds.has(p.id)).map((p) => ({
              playerId: p.id,
              exp: botDvParticipate + (p.id === state.winnerId ? botDvWin : 0),
              reason: p.id === state.winnerId ? '다빈치 코드 승리' : '게임 참가',
            }));
            grantExp(io, room, expRewards);
          }
          return;
        }

        if (state.phase === 'continue_or_stop') {
          // Bot decides: continue if correct, but stop sometimes to not be too aggressive
          setTimeout(() => {
            if (!room.davinciState || room.davinciState.currentPlayerId !== botId) return;
            if (Math.random() < 0.4) {
              continueGuessing(state, botId);
              broadcastGameState(io, room);
              setTimeout(runPhase, 800);
            } else {
              stopGuessing(state, botId);
              if (state.phase === 'place_drawn_joker') {
                const pos = Math.floor(Math.random() * 12) + 0.5;
                placeDrawnJoker(state, botId, pos);
              }
              broadcastGameState(io, room);
              // Next player might be a bot
              setTimeout(() => daVinciBotTurn(io, room), 1000);
            }
          }, 1000);
          return;
        }

        if (state.phase === 'place_drawn_joker') {
          setTimeout(() => {
            const pos = Math.floor(Math.random() * 12) + 0.5;
            placeDrawnJoker(state, botId, pos);
            broadcastGameState(io, room);
            setTimeout(() => daVinciBotTurn(io, room), 1000);
          }, 500);
          return;
        }

        // Wrong guess - turn passed, check next player
        setTimeout(() => daVinciBotTurn(io, room), 1000);
      }
      return;
    }
  };

  setTimeout(runPhase, 1200);
}

// Count players that should be treated as "real" for EXP calculation
// Real humans + bots that replaced humans
function countEffectiveHumans(room: Room): number {
  return room.players.filter((p) => !room.botIds.has(p.id) || room.replacementBotIds.has(p.id)).length;
}

function autoSelectIfLastCard(io: Server, room: Room) {
  if (!room.gameState || room.gameState.phase !== 'selecting') return;
  const allOneCard = room.gameState.players.every((p) => p.hand.length === 1);
  if (!allOneCard) return;

  // Auto-select the last card for every player
  for (const player of room.gameState.players) {
    player.selectedCard = player.hand[0];
  }

  beginResolve(room.gameState);
  io.to(room.id).emit('game:all_selected', room.gameState.sortedPlays.map((sp) => ({
    playerId: sp.playerId,
    card: sp.card,
    nickname: room.players.find((p) => p.id === sp.playerId)?.nickname,
  })));
  setTimeout(() => resolveCards(io, room), 1500);
}

function removeUserFromRoom(io: Server, socket: Socket, user: UserInfo) {
  for (const [roomId, room] of rooms) {
    // Check if spectator
    const specIdx = room.spectators.findIndex((s) => s.id === user.id);
    if (specIdx !== -1) {
      room.spectators.splice(specIdx, 1);
      socket.leave(roomId);
      socket.join('lobby');
      broadcastRoomState(io, room);
      broadcastRoomList(io);
      return;
    }

    // Check if player
    const idx = room.players.findIndex((p) => p.id === user.id);
    if (idx === -1) continue;

    room.players.splice(idx, 1);
    socket.leave(roomId);
    socket.join('lobby');

    // Check if only bots remain (no real players)
    const humanPlayers = room.players.filter((p) => !room.botIds.has(p.id));
    if (humanPlayers.length === 0) {
      // Kick spectators
      for (const spec of room.spectators) {
        const s = userSockets.get(spec.id);
        if (s) { s.leave(roomId); s.join('lobby'); }
      }
      rooms.delete(roomId);
      broadcastRoomList(io);
      return;
    }

    // Transfer host to a human player
    if (room.hostId === user.id) {
      room.hostId = humanPlayers[0].id;
    }

    // Flick: just disconnect, no bot replacement
    if (room.flickState) {
      flickPlayerDisconnected(room.flickState, user.id);
      io.to(roomId).emit('game:player_replaced', { nickname: user.nickname, botNickname: '' });
      broadcastGameState(io, room);
      if (room.flickState.phase === 'game_over') {
        grantFlickExp(io, room);
      }
      broadcastRoomState(io, room);
      broadcastRoomList(io);
      return;
    }

    // If game is in progress, replace with bot
    if (room.gameState || room.davinciState || room.gomokuState || room.dalmutiState || room.flickState) {
      const bot = createBot();
      bot.nickname = `BOT (${user.nickname})`;
      room.players.push(bot);
      room.botIds.add(bot.id);
      room.replacementBotIds.add(bot.id);

      // Swap player ID in game state
      if (room.gameState) {
        const gp = room.gameState.players.find((p) => p.id === user.id);
        if (gp) {
          gp.id = bot.id;
          gp.nickname = bot.nickname;
        }
        // If this player was choosing a row, bot auto-chooses
        if (room.gameState.choosingPlayerId === user.id) {
          room.gameState.choosingPlayerId = bot.id;
          setTimeout(() => {
            botChooseRow(io, room);
            if (room.gameState) {
              broadcastGameState(io, room);
              setTimeout(() => resolveCards(io, room), 800);
            }
          }, 500);
        }
        // If selecting phase, bot auto-selects
        if (room.gameState.phase === 'selecting') {
          botSelectCards(io, room);
          if (allPlayersSelected(room.gameState)) {
            beginResolve(room.gameState);
            io.to(room.id).emit('game:all_selected', room.gameState.sortedPlays.map((sp) => ({
              playerId: sp.playerId,
              card: sp.card,
              nickname: room.players.find((p) => p.id === sp.playerId)?.nickname,
            })));
            setTimeout(() => resolveCards(io, room), 1500);
          }
        }
        // Bot auto-ready for round end
        if (room.gameState.phase === 'round_end') {
          room.readyForNext.delete(user.id);
          room.readyForNext.add(bot.id);
        }
      }

      if (room.davinciState) {
        const dp = room.davinciState.players.find((p) => p.id === user.id);
        if (dp) {
          dp.id = bot.id;
          dp.nickname = bot.nickname;
        }
        // Update turn order
        const turnIdx = room.davinciState.turnOrder.indexOf(user.id);
        if (turnIdx !== -1) room.davinciState.turnOrder[turnIdx] = bot.id;
        if (room.davinciState.currentPlayerId === user.id) {
          room.davinciState.currentPlayerId = bot.id;
          daVinciBotTurn(io, room);
        }
        // Update pending joker list
        const jokerIdx = room.davinciState.pendingJokerPlayerIds.indexOf(user.id);
        if (jokerIdx !== -1) {
          room.davinciState.pendingJokerPlayerIds[jokerIdx] = bot.id;
          // Bot places jokers immediately
          if (dp) {
            for (const tile of dp.tiles) {
              if (tile.joker && (tile as any).sortValue === undefined) {
                placeJoker(room.davinciState, bot.id, tile.id, Math.floor(Math.random() * 12) + 0.5);
              }
            }
          }
        }
      }

      if (room.gomokuState) {
        const gp = room.gomokuState.players.find((p) => p.id === user.id);
        if (gp) {
          gp.id = bot.id;
          gp.nickname = bot.nickname;
        }
        // If it's their turn, bot resigns
        if (room.gomokuState.phase === 'playing') {
          const currentPlayer = room.gomokuState.players.find((p) => p.color === room.gomokuState!.currentColor);
          if (currentPlayer && currentPlayer.id === bot.id) {
            gomokuResign(room.gomokuState, bot.id);
            if (room.gomokuTimer) clearInterval(room.gomokuTimer);
            grantGomokuExp(io, room);
          }
        }
      }

      io.to(roomId).emit('game:player_replaced', { nickname: user.nickname, botNickname: bot.nickname });
      broadcastGameState(io, room);
    }

    broadcastRoomState(io, room);
    broadcastRoomList(io);
    return;
  }
}

export function setupSocket(io: Server) {
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('인증이 필요합니다.'));

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as UserInfo;
      (socket as any).user = decoded;
      next();
    } catch {
      next(new Error('유효하지 않은 토큰입니다.'));
    }
  });

  io.on('connection', (socket) => {
    const user: UserInfo = (socket as any).user;
    userSockets.set(user.id, socket);
    onlineNicknames.add(user.nickname);
    console.log(`Connected: ${user.nickname} (${user.id})`);

    // Check if user is already in a room (reconnect scenario)
    let existingRoom: Room | null = null;
    let isSpectator = false;
    for (const [, room] of rooms) {
      if (room.players.find((p) => p.id === user.id)) {
        existingRoom = room;
        break;
      }
      if (room.spectators.find((s) => s.id === user.id)) {
        existingRoom = room;
        isSpectator = true;
        break;
      }
    }

    if (existingRoom) {
      socket.join(existingRoom.id);
      broadcastRoomState(io, existingRoom);
      if (existingRoom.gameState) {
        if (isSpectator) {
          socket.emit('game:state', { ...getPlayerView(existingRoom.gameState, -1), spectating: true });
        } else {
          socket.emit('game:state', getPlayerView(existingRoom.gameState, user.id));
        }
      }
    } else {
      socket.join('lobby');
      broadcastRoomList(io);
    }

    // Create room
    socket.on('room:create', ({ name, gameType, maxPlayers }: { name: string; gameType: string; maxPlayers: number }) => {
      const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const room: Room = {
        id: roomId,
        name,
        hostId: user.id,
        gameType,
        maxPlayers: Math.min(Math.max(maxPlayers, gameType === 'dalmuti' ? 4 : 2), gameType === 'gomoku' ? 2 : gameType === 'davinci-code' ? 4 : (gameType === 'dalmuti' || gameType === 'flick') ? 8 : 10),
        players: [user],
        spectators: [],
        botIds: new Set(),
        replacementBotIds: new Set(),
        gameState: null,
        gomokuState: null,
        gomokuTimer: null,
        gomokuSettings: { totalTime: 300000, moveTime: 30000, colorChoice: 'random' },
        teams: new Map(),
        dalmutiState: null,
        flickState: null,
        davinciState: null,
        status: 'waiting',
        readyForNext: new Set(),
      };

      rooms.set(roomId, room);
      autoAssignTeam(room, user.id);
      socket.leave('lobby');
      socket.join(roomId);
      socket.emit('room:created', roomId);
      broadcastRoomState(io, room);
      broadcastRoomList(io);
    });

    // Join room
    socket.on('room:join', (roomId: string) => {
      const room = rooms.get(roomId);
      if (!room) return socket.emit('error', '방을 찾을 수 없습니다.');
      if (room.status !== 'waiting') return socket.emit('error', '이미 게임이 시작된 방입니다.');
      if (room.players.length >= room.maxPlayers) return socket.emit('error', '방이 가득 찼습니다.');
      if (room.players.find((p) => p.id === user.id)) return socket.emit('error', '이미 참가한 방입니다.');

      room.players.push(user);
      autoAssignTeam(room, user.id);
      socket.leave('lobby');
      socket.join(roomId);
      socket.emit('room:joined', roomId);
      broadcastRoomState(io, room);
      broadcastRoomList(io);
    });

    // Spectate room
    socket.on('room:spectate', (roomId: string) => {
      const room = rooms.get(roomId);
      if (!room) return socket.emit('error', '방을 찾을 수 없습니다.');
      if (room.players.find((p) => p.id === user.id)) return socket.emit('error', '이미 참가한 방입니다.');
      if (room.spectators.find((s) => s.id === user.id)) return socket.emit('error', '이미 관전 중입니다.');

      room.spectators.push(user);
      socket.leave('lobby');
      socket.join(roomId);
      socket.emit('room:spectating', roomId);
      broadcastRoomState(io, room);
      broadcastRoomList(io);
      if (room.gameState) {
        const spectatorView = { ...getPlayerView(room.gameState, -1), spectating: true };
        socket.emit('game:state', spectatorView);
      }
    });

    // Request room state (for page mount / reconnect)
    socket.on('room:get_state', (roomId: string) => {
      const room = rooms.get(roomId);
      if (!room) return socket.emit('error', '방을 찾을 수 없습니다.');

      // Make sure socket is in the room's socket.io channel
      socket.join(roomId);

      socket.emit('room:state', {
        id: room.id,
        name: room.name,
        hostId: room.hostId,
        gameType: room.gameType,
        maxPlayers: room.maxPlayers,
        players: room.players.map((p) => ({ id: p.id, nickname: p.nickname })),
        spectators: room.spectators.map((s) => ({ id: s.id, nickname: s.nickname })),
        status: room.status,
      });

      if (room.gameState) {
        const isSpectator = room.spectators.find((s) => s.id === user.id);
        if (isSpectator) {
          socket.emit('game:state', { ...getPlayerView(room.gameState, -1), spectating: true, gameType: 'six-nimmt' });
        } else {
          socket.emit('game:state', { gameType: 'six-nimmt', ...getPlayerView(room.gameState, user.id) });
        }
      }

      if (room.davinciState) {
        const isSpectator = room.spectators.find((s) => s.id === user.id);
        if (isSpectator) {
          socket.emit('game:state', { gameType: 'davinci-code', ...getDaVinciSpectatorView(room.davinciState) });
        } else {
          socket.emit('game:state', { gameType: 'davinci-code', ...getDaVinciPlayerView(room.davinciState, user.id) });
        }
      }

      if (room.gomokuState) {
        const isSpectator = room.spectators.find((s) => s.id === user.id);
        if (isSpectator) {
          socket.emit('game:state', { gameType: 'gomoku', ...getGomokuSpectatorView(room.gomokuState) });
        } else {
          socket.emit('game:state', { gameType: 'gomoku', ...getGomokuPlayerView(room.gomokuState, user.id) });
        }
      }

      if (room.dalmutiState) {
        const isSpectator = room.spectators.find((s) => s.id === user.id);
        if (isSpectator) {
          socket.emit('game:state', { gameType: 'dalmuti', ...getDalmutiSpectatorView(room.dalmutiState) });
        } else {
          socket.emit('game:state', { gameType: 'dalmuti', ...getDalmutiPlayerView(room.dalmutiState, user.id) });
        }
      }

      if (room.flickState) {
        const isSpectator = room.spectators.find((s) => s.id === user.id);
        if (isSpectator) {
          socket.emit('game:state', { gameType: 'flick', ...getFlickSpectatorView(room.flickState) });
        } else {
          socket.emit('game:state', { gameType: 'flick', ...getFlickPlayerView(room.flickState, user.id) });
        }
      }
    });

    // Add bot (host only)
    socket.on('room:add_bot', () => {
      for (const [, room] of rooms) {
        if (room.hostId !== user.id || room.status !== 'waiting') continue;
        if (room.players.length >= room.maxPlayers) return socket.emit('error', '방이 가득 찼습니다.');

        const bot = createBot();
        room.players.push(bot);
        room.botIds.add(bot.id);
        autoAssignTeam(room, bot.id);
        broadcastRoomState(io, room);
        broadcastRoomList(io);
        break;
      }
    });

    // Remove bot (host only)
    socket.on('room:remove_bot', (botId: number) => {
      for (const [, room] of rooms) {
        if (room.hostId !== user.id || room.status !== 'waiting') continue;
        if (!room.botIds.has(botId)) continue;

        room.players = room.players.filter((p) => p.id !== botId);
        room.botIds.delete(botId);
        room.teams.delete(botId);
        broadcastRoomState(io, room);
        broadcastRoomList(io);
        break;
      }
    });

    // Switch team (host only, flick only)
    socket.on('room:switch_team', (targetPlayerId: number) => {
      for (const [, room] of rooms) {
        if (room.hostId !== user.id || room.status !== 'waiting' || room.gameType !== 'flick') continue;
        if (!room.teams.has(targetPlayerId)) continue;

        const current = room.teams.get(targetPlayerId)!;
        room.teams.set(targetPlayerId, current === 0 ? 1 : 0);
        broadcastRoomState(io, room);
        break;
      }
    });

    // Update room settings (host only)
    socket.on('room:update_settings', ({ name, maxPlayers }: { name?: string; maxPlayers?: number }) => {
      for (const [, room] of rooms) {
        if (room.hostId !== user.id || room.status !== 'waiting') continue;
        if (!room.players.find((p) => p.id === user.id)) continue;

        if (name !== undefined && name.trim().length > 0) {
          room.name = name.trim();
        }

        if (maxPlayers !== undefined) {
          const clamped = Math.min(Math.max(maxPlayers, room.players.length, 2), 10);
          room.maxPlayers = clamped;
        }

        broadcastRoomState(io, room);
        broadcastRoomList(io);
        break;
      }
    });

    // Leave room
    socket.on('room:leave', () => {
      removeUserFromRoom(io, socket, user);
    });

    // Start game
    socket.on('game:start', () => {
      for (const [, room] of rooms) {
        if (room.hostId === user.id && room.status === 'waiting') {
          if (room.players.length < 2) {
            return socket.emit('error', '최소 2명이 필요합니다.');
          }

          room.status = 'playing';
          const playerInfos = room.players.map((p) => ({ id: p.id, nickname: p.nickname }));

          if (room.gameType === 'flick') {
            room.flickState = initFlick(playerInfos, room.teams);
          } else if (room.gameType === 'dalmuti') {
            room.dalmutiState = initDalmuti(playerInfos);
            // Bot might start first
            setTimeout(() => dalmutiBotTurn(io, room), 500);
          } else if (room.gameType === 'gomoku') {
            const gs = room.gomokuSettings;
            room.gomokuState = initGomoku(playerInfos, gs.colorChoice as any, gs.totalTime, gs.moveTime);

            // Start timer
            room.gomokuTimer = setInterval(() => {
              if (!room.gomokuState || room.gomokuState.phase !== 'playing') {
                if (room.gomokuTimer) clearInterval(room.gomokuTimer);
                return;
              }
              const elapsed = Date.now() - room.gomokuState.turnStartedAt;
              const cp = room.gomokuState.players.find((p) => p.color === room.gomokuState!.currentColor)!;
              if (cp.moveTime - elapsed <= 0) {
                timeoutLoss(room.gomokuState, 'timeout_move');
                if (room.gomokuTimer) clearInterval(room.gomokuTimer);
                broadcastGameState(io, room);
                grantGomokuExp(io, room);
              } else if (cp.totalTime - elapsed <= 0) {
                timeoutLoss(room.gomokuState, 'timeout_total');
                if (room.gomokuTimer) clearInterval(room.gomokuTimer);
                broadcastGameState(io, room);
                grantGomokuExp(io, room);
              }
            }, 500);
          } else if (room.gameType === 'davinci-code') {
            room.davinciState = initDaVinci(playerInfos);

            // Bots auto-place jokers
            for (const botId of room.botIds) {
              const bot = room.davinciState.players.find((p) => p.id === botId);
              if (bot) {
                for (const tile of bot.tiles) {
                  if (tile.joker) {
                    const pos = Math.floor(Math.random() * 12) + 0.5;
                    placeJoker(room.davinciState, botId, tile.id, pos);
                  }
                }
              }
            }

            // Schedule auto-start after random 2-4s if no human jokers pending
            const delay = 2000 + Math.random() * 2000;
            setTimeout(() => {
              if (room.davinciState && room.davinciState.phase === 'setup_jokers' && room.davinciState.pendingJokerPlayerIds.length === 0) {
                room.davinciState.phase = 'drawing';
                broadcastGameState(io, room);
                // First turn might be a bot
                daVinciBotTurn(io, room);
              }
            }, delay);
          } else {
            room.gameState = initRound(playerInfos);
          }

          broadcastRoomList(io);
          broadcastGameState(io, room);
          io.to(room.id).emit('game:started');

          // Gomoku bot first move
          if (room.gomokuState) {
            gomokuBotMove(io, room);
          }

          // Bots auto-select after short delay
          if (room.gameState && room.botIds.size > 0) {
            setTimeout(() => {
              botSelectCards(io, room);
              if (room.gameState && allPlayersSelected(room.gameState)) {
                beginResolve(room.gameState);
                io.to(room.id).emit('game:all_selected', room.gameState.sortedPlays.map((sp) => ({
                  playerId: sp.playerId,
                  card: sp.card,
                  nickname: room.players.find((p) => p.id === sp.playerId)?.nickname,
                })));
                setTimeout(() => resolveCards(io, room), 1500);
              }
              broadcastGameState(io, room);
            }, 1000);
          }
          break;
        }
      }
    });

    // Select card
    socket.on('game:select_card', (cardNumber: number) => {
      for (const [, room] of rooms) {
        if (room.gameState && room.players.find((p) => p.id === user.id)) {
          if (selectCard(room.gameState, user.id, cardNumber)) {
            // Bots auto-select when a human selects
            botSelectCards(io, room);
            broadcastGameState(io, room);

            if (allPlayersSelected(room.gameState)) {
              beginResolve(room.gameState);
              io.to(room.id).emit('game:all_selected', room.gameState.sortedPlays.map((sp) => ({
                playerId: sp.playerId,
                card: sp.card,
                nickname: room.players.find((p) => p.id === sp.playerId)?.nickname,
              })));
              setTimeout(() => resolveCards(io, room), 1500);
            }
          }
          break;
        }
      }
    });

    // Unselect card
    socket.on('game:unselect_card', () => {
      for (const [, room] of rooms) {
        if (room.gameState && room.players.find((p) => p.id === user.id)) {
          if (unselectCard(room.gameState, user.id)) {
            broadcastGameState(io, room);
          }
          break;
        }
      }
    });

    // Choose row (when card is lower than all rows)
    socket.on('game:choose_row', (rowIndex: number) => {
      for (const [, room] of rooms) {
        if (room.gameState && room.gameState.choosingPlayerId === user.id) {
          const result = chooseRow(room.gameState, user.id, rowIndex);
          if (result) {
            io.to(room.id).emit('game:event', {
              type: 'took_row',
              playerId: result.playerId,
              card: result.card,
              rowIndex: result.rowIndex,
              takenCards: result.takenCards,
            });
            broadcastGameState(io, room);

            setTimeout(() => resolveCards(io, room), 800);
          }
          break;
        }
      }
    });

    // Ready for next round
    socket.on('game:next_round', () => {
      for (const [, room] of rooms) {
        if (!room.gameState || room.gameState.phase !== 'round_end') continue;
        if (!room.players.find((p) => p.id === user.id)) continue;

        room.readyForNext.add(user.id);

        // Broadcast who is ready
        io.to(room.id).emit('game:ready_status', {
          ready: Array.from(room.readyForNext),
          total: room.players.length,
        });

        // All players ready -> start next round
        if (room.readyForNext.size >= room.players.length) {
          room.readyForNext.clear();
          startNewRound(room.gameState);
          autoSelectIfLastCard(io, room);
          if (room.gameState.phase === 'selecting') {
            botSelectCards(io, room);
          }
          broadcastGameState(io, room);
          io.to(room.id).emit('game:new_round', room.gameState.round);
        }
        break;
      }
    });

    // ===== Da Vinci Code events =====
    socket.on('davinci:place_joker', ({ jokerId, sortValue }: { jokerId: number; sortValue: number }) => {
      for (const [, room] of rooms) {
        if (room.davinciState && room.players.find((p) => p.id === user.id)) {
          if (placeJoker(room.davinciState, user.id, jokerId, sortValue)) {
            broadcastGameState(io, room);

            // All jokers placed? Start immediately
            if (room.davinciState.phase === 'setup_jokers' && room.davinciState.pendingJokerPlayerIds.length === 0) {
              room.davinciState.phase = 'drawing';
              broadcastGameState(io, room);
              daVinciBotTurn(io, room);
            }
          }
          break;
        }
      }
    });

    socket.on('davinci:draw', () => {
      for (const [, room] of rooms) {
        if (room.davinciState && room.players.find((p) => p.id === user.id)) {
          if (drawTile(room.davinciState, user.id)) {
            broadcastGameState(io, room);
          }
          break;
        }
      }
    });

    socket.on('davinci:guess', ({ targetPlayerId, tileIndex, guessedNumber }: { targetPlayerId: number; tileIndex: number; guessedNumber: number }) => {
      for (const [, room] of rooms) {
        if (room.davinciState && room.players.find((p) => p.id === user.id)) {
          const result = daVinciGuess(room.davinciState, user.id, targetPlayerId, tileIndex, guessedNumber);
          if (result) {
            io.to(room.id).emit('davinci:guess_result', {
              playerId: user.id,
              targetPlayerId,
              tileIndex,
              guessedNumber,
              correct: result.correct,
              revealedTile: result.correct ? result.targetTile : null,
            });
            broadcastGameState(io, room);

            // Grant EXP on game over
            if (room.davinciState && room.davinciState.phase === 'game_over') {
              const dvHumanCount = countEffectiveHumans(room);
              const dvParticipate = calcReward('davinci-code', 'participate', dvHumanCount);
              const dvWin = calcReward('davinci-code', 'win', dvHumanCount);
              if (dvParticipate > 0 || dvWin > 0) {
                const expRewards = room.davinciState.players.filter((p) => !room.botIds.has(p.id)).map((p) => ({
                  playerId: p.id,
                  exp: dvParticipate + (p.id === room.davinciState!.winnerId ? dvWin : 0),
                  reason: p.id === room.davinciState!.winnerId ? '다빈치 코드 승리' : '게임 참가',
                }));
                grantExp(io, room, expRewards);
              }
            }

            // Next turn might be a bot
            if (room.davinciState && room.davinciState.phase !== 'game_over' && room.davinciState.phase !== 'continue_or_stop') {
              daVinciBotTurn(io, room);
            }
          }
          break;
        }
      }
    });

    socket.on('davinci:continue', () => {
      for (const [, room] of rooms) {
        if (room.davinciState && room.players.find((p) => p.id === user.id)) {
          if (continueGuessing(room.davinciState, user.id)) {
            broadcastGameState(io, room);
          }
          break;
        }
      }
    });

    socket.on('davinci:stop', () => {
      for (const [, room] of rooms) {
        if (room.davinciState && room.players.find((p) => p.id === user.id)) {
          if (stopGuessing(room.davinciState, user.id)) {
            broadcastGameState(io, room);
            daVinciBotTurn(io, room);
          }
          break;
        }
      }
    });

    socket.on('davinci:place_drawn_joker', ({ sortValue }: { sortValue: number }) => {
      for (const [, room] of rooms) {
        if (room.davinciState && room.players.find((p) => p.id === user.id)) {
          if (placeDrawnJoker(room.davinciState, user.id, sortValue)) {
            broadcastGameState(io, room);
            daVinciBotTurn(io, room);
          }
          break;
        }
      }
    });

    // ===== Flick (알까기) events =====
    socket.on('flick:shoot', ({ stoneId, dx, dy }: { stoneId: number; dx: number; dy: number }) => {
      for (const [, room] of rooms) {
        if (room.flickState && room.players.find((p) => p.id === user.id)) {
          if (flickStone(room.flickState, user.id, stoneId, dx, dy)) {
            // Send simulation frames as separate event
            const frames = room.flickState.simulationFrames;
            io.to(room.id).emit('flick:animation', frames);

            // After animation delay, apply final positions and send updated state
            const frameCount = frames?.length || 0;
            const animDurationMs = frameCount * 33 + 300;

            setTimeout(() => {
              if (!room.flickState || room.flickState.phase !== 'simulating') return;
              flickApplySimulation(room.flickState);
              broadcastGameState(io, room);
              if (room.flickState.phase === 'game_over') {
                grantFlickExp(io, room);
              }
            }, animDurationMs);
          }
          break;
        }
      }
    });

    // ===== Dalmuti events =====
    socket.on('dalmuti:play', ({ cardRanks }: { cardRanks: number[] }) => {
      for (const [, room] of rooms) {
        if (room.dalmutiState && room.players.find((p) => p.id === user.id)) {
          if (dalmutiPlayCards(room.dalmutiState, user.id, cardRanks)) {
            broadcastGameState(io, room);
            if (room.dalmutiState.phase === 'game_over') {
              grantDalmutiExp(io, room);
            } else if (room.dalmutiState.phase === 'playing') {
              dalmutiBotTurn(io, room);
            }
          }
          break;
        }
      }
    });

    socket.on('dalmuti:pass', () => {
      for (const [, room] of rooms) {
        if (room.dalmutiState && room.players.find((p) => p.id === user.id)) {
          if (dalmutiPass(room.dalmutiState, user.id)) {
            broadcastGameState(io, room);
            if (room.dalmutiState.phase === 'playing') {
              dalmutiBotTurn(io, room);
            }
          }
          break;
        }
      }
    });

    socket.on('dalmuti:next_round', () => {
      for (const [, room] of rooms) {
        if (room.dalmutiState && room.players.find((p) => p.id === user.id)) {
          room.readyForNext.add(user.id);
          // Bots auto-ready
          for (const botId of room.botIds) room.readyForNext.add(botId);

          io.to(room.id).emit('game:ready_status', {
            ready: Array.from(room.readyForNext),
            total: room.players.length,
          });

          if (room.readyForNext.size >= room.players.length) {
            room.readyForNext.clear();
            if (dalmutiNextRound(room.dalmutiState)) {
              broadcastGameState(io, room);
              io.to(room.id).emit('game:new_round', room.dalmutiState.round);
              dalmutiBotTurn(io, room);
            }
          }
          break;
        }
      }
    });

    // ===== Gomoku events =====
    socket.on('gomoku:place', ({ row, col }: { row: number; col: number }) => {
      for (const [, room] of rooms) {
        if (room.gomokuState && room.players.find((p) => p.id === user.id)) {
          if (placeStone(room.gomokuState, user.id, row, col)) {
            broadcastGameState(io, room);
            if (room.gomokuState.phase === 'game_over') {
              if (room.gomokuTimer) clearInterval(room.gomokuTimer);
              grantGomokuExp(io, room);
            } else {
              gomokuBotMove(io, room);
            }
          }
          break;
        }
      }
    });

    socket.on('gomoku:resign', () => {
      for (const [, room] of rooms) {
        if (room.gomokuState && room.players.find((p) => p.id === user.id)) {
          if (gomokuResign(room.gomokuState, user.id)) {
            if (room.gomokuTimer) clearInterval(room.gomokuTimer);
            broadcastGameState(io, room);
            grantGomokuExp(io, room);
          }
          break;
        }
      }
    });

    socket.on('gomoku:update_settings', (settings: { totalTime?: number; moveTime?: number; colorChoice?: string }) => {
      for (const [, room] of rooms) {
        if (room.hostId !== user.id || room.status !== 'waiting' || room.gameType !== 'gomoku') continue;
        if (settings.totalTime !== undefined) room.gomokuSettings.totalTime = settings.totalTime;
        if (settings.moveTime !== undefined) room.gomokuSettings.moveTime = settings.moveTime;
        if (settings.colorChoice !== undefined) room.gomokuSettings.colorChoice = settings.colorChoice;
        broadcastRoomState(io, room);
        break;
      }
    });

    // Return to lobby
    socket.on('game:return_lobby', () => {
      for (const [roomId, room] of rooms) {
        if (room.hostId !== user.id) continue;
        const sixNimmtDone = room.gameState && (room.gameState.phase === 'game_over' || room.gameState.phase === 'round_end');
        const davinciDone = room.davinciState && room.davinciState.phase === 'game_over';
        const gomokuDone = room.gomokuState && room.gomokuState.phase === 'game_over';
        const dalmutiDone = room.dalmutiState && (room.dalmutiState.phase === 'game_over' || room.dalmutiState.phase === 'round_end');
        const flickDone = room.flickState && room.flickState.phase === 'game_over';
        if (sixNimmtDone || davinciDone || gomokuDone || dalmutiDone || flickDone) {
          room.gameState = null;
          room.davinciState = null;
          room.gomokuState = null;
          room.dalmutiState = null;
          room.flickState = null;
          if (room.gomokuTimer) { clearInterval(room.gomokuTimer); room.gomokuTimer = null; }
          room.status = 'waiting';

          for (const player of room.players) {
            const s = userSockets.get(player.id);
            if (s) {
              s.leave(roomId);
              s.join('lobby');
            }
          }

          rooms.delete(roomId);
          broadcastRoomList(io);
          break;
        }
      }
    });

    // Fishing auto-loop
    const fishingTimers = new Map<number, ReturnType<typeof setTimeout>>();

    function startFishingLoop(userId: number, nickname: string, location: string) {
      stopFishingLoop(userId);
      const fish = pickFish(location);
      const catchTime = (fish.minTime + Math.random() * (fish.maxTime - fish.minTime)) * 1000;

      socket.emit('fishing:cast', { fishKey: fish.key, catchTime, location });

      const timer = setTimeout(async () => {
        try {
          // Check user is still in the fishing room
          if (!socket.rooms.has(`fishing:${location}`)) return;

          // Add to inventory
          await pool.query('INSERT INTO fish_inventory (user_id, fish_key) VALUES (?, ?)', [userId, fish.key]);

          // Notify user
          socket.emit('fishing:caught', { fish });

          // Broadcast to location chat
          const catchMsg = { nickname: `🎣 ${nickname}`, text: `${fish.emoji} ${fish.name}을(를) 낚았습니다!`, timestamp: Date.now(), system: true };
          addChatMessage(`fishing:${location}`, catchMsg);
          io.to(`fishing:${location}`).emit('chat:message', catchMsg);

          // Auto re-cast
          startFishingLoop(userId, nickname, location);
        } catch (err) {
          console.error('Fishing loop error:', err);
        }
      }, catchTime);

      fishingTimers.set(userId, timer);
    }

    function stopFishingLoop(userId: number) {
      const timer = fishingTimers.get(userId);
      if (timer) { clearTimeout(timer); fishingTimers.delete(userId); }
    }

    socket.on('fishing:join', (location: string) => {
      if (!['river', 'lake', 'sea'].includes(location)) return;
      socket.rooms.forEach((r) => { if (r.startsWith('fishing:')) socket.leave(r); });
      stopFishingLoop(user.id);
      socket.join(`fishing:${location}`);
      broadcastFishingCounts(io);
      // Start auto-fishing
      startFishingLoop(user.id, user.nickname, location);
    });

    socket.on('fishing:leave', () => {
      socket.rooms.forEach((r) => { if (r.startsWith('fishing:')) socket.leave(r); });
      stopFishingLoop(user.id);
      broadcastFishingCounts(io);
    });

    // Chat
    socket.on('chat:history', (channel: string) => {
      const history = chatHistory.get(channel) || [];
      socket.emit('chat:history', history);
    });

    socket.on('chat:send', ({ channel, text }: { channel: string; text: string }) => {
      if (!text || text.length > 200) return;
      const room = channel !== 'lobby' ? rooms.get(channel) : null;
      const isSpec = room?.spectators.find((s) => s.id === user.id);
      const displayNickname = isSpec ? `${user.nickname} (관전)` : user.nickname;
      const msg = { nickname: displayNickname, text, timestamp: Date.now() };
      if (channel === 'lobby') {
        addChatMessage('lobby', msg);
        io.to('lobby').emit('chat:message', msg);
      } else if (channel.startsWith('fishing:')) {
        addChatMessage(channel, msg);
        io.to(channel).emit('chat:message', msg);
      } else {
        if (room && (room.players.find((p) => p.id === user.id) || isSpec)) {
          addChatMessage(channel, msg);
          io.to(channel).emit('chat:message', msg);
        }
      }
    });

    // Disconnect
    socket.on('disconnect', () => {
      userSockets.delete(user.id);
      onlineNicknames.delete(user.nickname);
      stopFishingLoop(user.id);
      console.log(`Disconnected: ${user.nickname} (${user.id})`);
      removeUserFromRoom(io, socket, user);
    });
  });
}
