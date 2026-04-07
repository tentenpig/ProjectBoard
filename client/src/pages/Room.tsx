import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import ChatPanel from '../components/ChatPanel';

interface RoomState {
  id: string;
  name: string;
  hostId: number;
  gameType: string;
  maxPlayers: number;
  players: { id: number; nickname: string }[];
  botIds: number[];
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
    <div className="page-layout">
      <div className="page-main">
        <div className="room-container">
          <header className="room-header">
            <button onClick={leaveRoom} className="btn-secondary">← 나가기</button>
            <h2>{roomState.name}</h2>
            <span className="game-badge">{{ 'six-nimmt': '젝스님트', 'davinci-code': '다빈치 코드' }[roomState.gameType] || roomState.gameType}</span>
          </header>

          <div className="room-content">
            {isHost && (
              <RoomSettings
                name={roomState.name}
                maxPlayers={roomState.maxPlayers}
                minPlayers={Math.max(roomState.players.length, 2)}
                maxLimit={roomState.gameType === 'davinci-code' ? 4 : 10}
                currentPlayers={roomState.players.length}
                socket={socket!}
              />
            )}

            <div className="player-list">
              <div className="player-list-header">
                <h3>참가자 ({roomState.players.length}/{roomState.maxPlayers})</h3>
                {isHost && roomState.gameType === 'six-nimmt' && roomState.players.length < roomState.maxPlayers && (
                  <button onClick={() => socket!.emit('room:add_bot')} className="btn-secondary btn-small">+ 봇 추가</button>
                )}
              </div>
              {roomState.players.map((p) => (
                <div key={p.id} className={`player-item ${p.id === roomState.hostId ? 'host' : ''} ${(roomState.botIds || []).includes(p.id) ? 'bot' : ''}`}>
                  <span className="player-name">
                    {(roomState.botIds || []).includes(p.id) && <span className="bot-badge">BOT</span>}
                    {p.nickname}
                  </span>
                  {p.id === roomState.hostId && <span className="host-badge">방장</span>}
                  {isHost && (roomState.botIds || []).includes(p.id) && (
                    <button onClick={() => socket!.emit('room:remove_bot', p.id)} className="btn-secondary btn-small">제거</button>
                  )}
                </div>
              ))}
            </div>

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
      </div>
      <ChatPanel channel={roomId!} />
    </div>
  );
}

function RoomSettings({ name, maxPlayers, minPlayers, maxLimit, currentPlayers, socket }: {
  name: string;
  maxPlayers: number;
  minPlayers: number;
  maxLimit: number;
  currentPlayers: number;
  socket: import('socket.io-client').Socket;
}) {
  const [editName, setEditName] = useState(name);
  const [editMax, setEditMax] = useState(maxPlayers);
  const [showSettings, setShowSettings] = useState(false);
  const prevNameRef = useRef(name);
  const prevMaxRef = useRef(maxPlayers);

  // Sync with server state
  if (name !== prevNameRef.current) { prevNameRef.current = name; setEditName(name); }
  if (maxPlayers !== prevMaxRef.current) { prevMaxRef.current = maxPlayers; setEditMax(maxPlayers); }

  const save = () => {
    socket.emit('room:update_settings', { name: editName, maxPlayers: editMax });
    setShowSettings(false);
  };

  if (!showSettings) {
    return (
      <button onClick={() => setShowSettings(true)} className="btn-secondary btn-small" style={{ marginBottom: 12 }}>
        방 설정
      </button>
    );
  }

  return (
    <div className="room-settings">
      <h3>방 설정</h3>
      <div className="form-group">
        <label>방 이름</label>
        <input
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          maxLength={30}
        />
      </div>
      <div className="form-group">
        <label>최대 인원 (현재 {currentPlayers}명 참가 중)</label>
        <select value={editMax} onChange={(e) => setEditMax(Number(e.target.value))}>
          {Array.from({ length: maxLimit - minPlayers + 1 }, (_, i) => minPlayers + i).map((n) => (
            <option key={n} value={n}>{n}명</option>
          ))}
        </select>
      </div>
      <div className="modal-actions">
        <button onClick={() => { setShowSettings(false); setEditName(name); setEditMax(maxPlayers); }} className="btn-secondary">취소</button>
        <button onClick={save} className="btn-primary">저장</button>
      </div>
    </div>
  );
}
