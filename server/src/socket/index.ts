import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
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
  gameState: GameState | null;
  davinciState: DaVinciState | null;
  status: 'waiting' | 'playing';
  readyForNext: Set<number>;
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
    status: room.status,
  });
}

function broadcastGameState(io: Server, room: Room) {
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
      return; // Wait for player to choose
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
        return;
      }

      // Start next turn
      room.gameState.phase = 'selecting';
      room.gameState.sortedPlays = [];
      room.gameState.currentResolveIndex = 0;
      autoSelectIfLastCard(io, room);
      broadcastGameState(io, room);
      return;
    }
  }
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

    if (room.players.length === 0) {
      // Also kick spectators
      for (const spec of room.spectators) {
        const s = userSockets.get(spec.id);
        if (s) { s.leave(roomId); s.join('lobby'); }
      }
      rooms.delete(roomId);
      broadcastRoomList(io);
      return;
    }

    // Transfer host
    if (room.hostId === user.id) {
      room.hostId = room.players[0].id;
    }

    // If game is in progress, abort it
    if (room.gameState || room.davinciState) {
      room.gameState = null;
      room.davinciState = null;
      room.status = 'waiting';
      io.to(roomId).emit('game:aborted', `${user.nickname} has left the game.`);
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
        maxPlayers: Math.min(Math.max(maxPlayers, 2), gameType === 'davinci-code' ? 4 : 10),
        players: [user],
        spectators: [],
        gameState: null,
        davinciState: null,
        status: 'waiting',
        readyForNext: new Set(),
      };

      rooms.set(roomId, room);
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

          if (room.gameType === 'davinci-code') {
            room.davinciState = initDaVinci(playerInfos);

            // Schedule auto-start after random 2-4s if no jokers need placement
            const delay = 2000 + Math.random() * 2000;
            setTimeout(() => {
              if (room.davinciState && room.davinciState.phase === 'setup_jokers' && room.davinciState.pendingJokerPlayerIds.length === 0) {
                room.davinciState.phase = 'drawing';
                broadcastGameState(io, room);
              }
            }, delay);
          } else {
            room.gameState = initRound(playerInfos);
          }

          broadcastRoomList(io);
          broadcastGameState(io, room);
          io.to(room.id).emit('game:started');
          break;
        }
      }
    });

    // Select card
    socket.on('game:select_card', (cardNumber: number) => {
      for (const [, room] of rooms) {
        if (room.gameState && room.players.find((p) => p.id === user.id)) {
          if (selectCard(room.gameState, user.id, cardNumber)) {
            broadcastGameState(io, room);

            if (allPlayersSelected(room.gameState)) {
              beginResolve(room.gameState);
              // Show all selected cards before resolving
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
          }
          break;
        }
      }
    });

    // Return to lobby
    socket.on('game:return_lobby', () => {
      for (const [roomId, room] of rooms) {
        if (room.hostId !== user.id) continue;
        const sixNimmtDone = room.gameState && (room.gameState.phase === 'game_over' || room.gameState.phase === 'round_end');
        const davinciDone = room.davinciState && room.davinciState.phase === 'game_over';
        if (sixNimmtDone || davinciDone) {
          room.gameState = null;
          room.davinciState = null;
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
      console.log(`Disconnected: ${user.nickname} (${user.id})`);
      removeUserFromRoom(io, socket, user);
    });
  });
}
