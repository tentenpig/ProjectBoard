import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import Chat from '../components/Chat';

interface RoomState {
  id: string;
  name: string;
  hostId: number;
  gameType: string;
  maxPlayers: number;
  players: { id: number; nickname: string }[];
  status: string;
}

export default function Room() {
  const { roomId } = useParams<{ roomId: string }>();
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const { user } = useAuth();
  const socket = useSocket();
  const navigate = useNavigate();

  const handleRoomState = useCallback((state: RoomState) => {
    console.log('[Room] room:state received', state);
    setRoomState(state);
  }, []);

  const handleGameStarted = useCallback(() => {
    console.log('[Room] game:started, navigating to game');
    navigate(`/game/${roomId}`);
  }, [navigate, roomId]);

  useEffect(() => {
    if (!socket) {
      console.log('[Room] socket is null, waiting...');
      return;
    }

    console.log('[Room] Registering listeners, roomId:', roomId, 'socket connected:', socket.connected);

    socket.on('room:state', handleRoomState);
    socket.on('game:started', handleGameStarted);

    // Request current room state
    if (roomId) {
      console.log('[Room] Emitting room:get_state', roomId);
      socket.emit('room:get_state', roomId);
    }

    return () => {
      socket.off('room:state', handleRoomState);
      socket.off('game:started', handleGameStarted);
    };
  }, [socket, roomId, handleRoomState, handleGameStarted]);

  const leaveRoom = () => {
    if (!socket) return;
    socket.emit('room:leave');
    navigate('/lobby');
  };

  const startGame = () => {
    if (!socket) return;
    socket.emit('game:start');
  };

  if (!roomState) {
    return <div className="loading">방 정보를 불러오는 중...</div>;
  }

  const isHost = user?.id === roomState.hostId;

  return (
    <div className="room-container">
      <header className="room-header">
        <button onClick={leaveRoom} className="btn-secondary">← 나가기</button>
        <h2>{roomState.name}</h2>
        <span className="game-badge">젝스님트</span>
      </header>

      <div className="room-content">
        <div className="player-list">
          <h3>참가자 ({roomState.players.length}/{roomState.maxPlayers})</h3>
          {roomState.players.map((p) => (
            <div key={p.id} className={`player-item ${p.id === roomState.hostId ? 'host' : ''}`}>
              <span className="player-name">{p.nickname}</span>
              {p.id === roomState.hostId && <span className="host-badge">방장</span>}
            </div>
          ))}
        </div>

        <Chat channel={roomId!} />

        <div className="room-footer">
          {isHost ? (
            <button
              onClick={startGame}
              className="btn-primary btn-large"
              disabled={roomState.players.length < 2}
            >
              {roomState.players.length < 2 ? '최소 2명이 필요합니다' : '게임 시작'}
            </button>
          ) : (
            <p className="waiting-message">방장이 게임을 시작할 때까지 대기 중...</p>
          )}
        </div>
      </div>
    </div>
  );
}
