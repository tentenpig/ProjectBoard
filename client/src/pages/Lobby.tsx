import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import Chat from '../components/Chat';

interface RoomInfo {
  id: string;
  name: string;
  hostId: number;
  hostNickname: string;
  gameType: string;
  maxPlayers: number;
  playerCount: number;
  status: string;
}

export default function Lobby() {
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(4);
  const { user, logout } = useAuth();
  const socket = useSocket();
  const navigate = useNavigate();

  const handleRoomList = useCallback((list: RoomInfo[]) => {
    setRooms(list);
  }, []);

  const handleRoomCreated = useCallback((roomId: string) => {
    navigate(`/room/${roomId}`);
  }, [navigate]);

  const handleRoomJoined = useCallback((roomId: string) => {
    navigate(`/room/${roomId}`);
  }, [navigate]);

  useEffect(() => {
    if (!socket) return;

    socket.on('room:list', handleRoomList);
    socket.on('room:created', handleRoomCreated);
    socket.on('room:joined', handleRoomJoined);

    return () => {
      socket.off('room:list', handleRoomList);
      socket.off('room:created', handleRoomCreated);
      socket.off('room:joined', handleRoomJoined);
    };
  }, [socket, handleRoomList, handleRoomCreated, handleRoomJoined]);

  const createRoom = () => {
    if (!socket || !roomName.trim()) return;
    socket.emit('room:create', {
      name: roomName.trim(),
      gameType: 'six-nimmt',
      maxPlayers,
    });
    setShowCreate(false);
    setRoomName('');
  };

  const joinRoom = (roomId: string) => {
    if (!socket) return;
    socket.emit('room:join', roomId);
  };

  const gameTypeLabel: Record<string, string> = {
    'six-nimmt': '젝스님트',
  };

  return (
    <div className="lobby-container">
      <header className="lobby-header">
        <h1>네온 보드게임</h1>
        <div className="user-info">
          <span>{user?.nickname}</span>
          <button onClick={logout} className="btn-secondary">로그아웃</button>
        </div>
      </header>

      <div className="lobby-content">
        <div className="lobby-actions">
          <h2>대기실</h2>
          <button onClick={() => setShowCreate(true)} className="btn-primary">방 만들기</button>
        </div>

        {showCreate && (
          <div className="modal-overlay" onClick={() => setShowCreate(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>방 만들기</h3>
              <input
                type="text"
                placeholder="방 이름"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                autoFocus
              />
              <div className="form-group">
                <label>게임</label>
                <select disabled>
                  <option>젝스님트 (6 Nimmt!)</option>
                </select>
              </div>
              <div className="form-group">
                <label>최대 인원</label>
                <select value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))}>
                  {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                    <option key={n} value={n}>{n}명</option>
                  ))}
                </select>
              </div>
              <div className="modal-actions">
                <button onClick={() => setShowCreate(false)} className="btn-secondary">취소</button>
                <button onClick={createRoom} className="btn-primary">만들기</button>
              </div>
            </div>
          </div>
        )}

        <div className="room-list">
          {rooms.length === 0 ? (
            <p className="empty-message">생성된 방이 없습니다. 새로운 방을 만들어보세요!</p>
          ) : (
            rooms.map((room) => (
              <div key={room.id} className="room-card">
                <div className="room-info">
                  <h3>{room.name}</h3>
                  <span className="game-type">{gameTypeLabel[room.gameType] || room.gameType}</span>
                  <span className="player-count">{room.playerCount}/{room.maxPlayers}명</span>
                  <span className="host">방장: {room.hostNickname}</span>
                </div>
                <div className="room-actions">
                  {room.status === 'waiting' && room.playerCount < room.maxPlayers ? (
                    <button onClick={() => joinRoom(room.id)} className="btn-primary">참가</button>
                  ) : (
                    <button disabled className="btn-disabled">
                      {room.status === 'playing' ? '게임 중' : '만석'}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <Chat channel="lobby" />
      </div>
    </div>
  );
}
