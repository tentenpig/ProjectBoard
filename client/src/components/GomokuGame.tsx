import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Socket } from 'socket.io-client';
import ChatPanel from './ChatPanel';

interface GomokuPlayerView {
  id: number;
  nickname: string;
  color: 'black' | 'white';
  totalTime: number;
  moveTime: number;
}

interface GomokuStateView {
  gameType: 'gomoku';
  board: (string | null)[][];
  players: GomokuPlayerView[];
  currentColor: 'black' | 'white';
  phase: string;
  winnerId: number | null;
  winReason: string | null;
  winLine: { row: number; col: number }[] | null;
  lastMove: { row: number; col: number } | null;
  moveCount: number;
  myColor: 'black' | 'white' | null;
  spectating?: boolean;
}

interface Props {
  socket: Socket;
  gameState: GomokuStateView;
}

function formatTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function GomokuGame({ socket, gameState }: Props) {
  const { roomId } = useParams<{ roomId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [, setTick] = useState(0);

  const isSpectating = gameState.spectating === true;
  const isMyTurn = !isSpectating && gameState.myColor === gameState.currentColor && gameState.phase === 'playing';
  const isHost = gameState.players[0]?.id === user?.id;

  // Tick every 100ms for timer display
  useEffect(() => {
    if (gameState.phase !== 'playing') return;
    const interval = setInterval(() => setTick((t) => t + 1), 100);
    return () => clearInterval(interval);
  }, [gameState.phase]);

  const handlePlace = (row: number, col: number) => {
    if (!isMyTurn || gameState.board[row][col] !== null) return;
    socket.emit('gomoku:place', { row, col });
  };

  const handleResign = () => {
    if (confirm('기권하시겠습니까?')) {
      socket.emit('gomoku:resign');
    }
  };

  const leaveGame = () => {
    socket.emit('room:leave');
    navigate('/lobby');
  };

  const returnToLobby = () => {
    socket.emit('game:return_lobby');
    navigate('/lobby');
  };

  const winSet = new Set(gameState.winLine?.map((p) => `${p.row},${p.col}`) || []);
  const myPlayer = gameState.players.find((p) => p.color === gameState.myColor);
  const opPlayer = gameState.players.find((p) => p.color !== gameState.myColor);
  const blackPlayer = gameState.players.find((p) => p.color === 'black')!;
  const whitePlayer = gameState.players.find((p) => p.color === 'white')!;
  const currentPlayer = gameState.players.find((p) => p.color === gameState.currentColor)!;

  const winReasonText: Record<string, string> = {
    five: '5목 완성!',
    timeout_total: '시간 초과 (총 시간)',
    timeout_move: '시간 초과 (착수 시간)',
    resign: '기권',
  };

  return (
    <div className="page-layout">
      <div className="page-main">
        <div className="game-container">
          <header className="game-header">
            <button onClick={leaveGame} className="btn-secondary btn-small">나가기</button>
            <div className="round-info">오목</div>
            <div className="phase-info">
              {gameState.phase === 'game_over'
                ? `${gameState.players.find((p) => p.id === gameState.winnerId)?.nickname || '무승부'} ${gameState.winReason ? winReasonText[gameState.winReason] || '' : ''}`
                : isSpectating ? `${currentPlayer.nickname}의 차례`
                : isMyTurn ? '당신의 차례입니다' : `${currentPlayer.nickname}의 차례...`
              }
            </div>
            <div className="my-penalty">{isSpectating ? '관전 중' : gameState.myColor === 'black' ? '● 흑' : '○ 백'}</div>
          </header>

          {/* Player timers */}
          <div className="gomoku-timers">
            {[blackPlayer, whitePlayer].map((p) => (
              <div key={p.id} className={`gomoku-timer ${p.color === gameState.currentColor && gameState.phase === 'playing' ? 'timer-active' : ''} ${p.color}`}>
                <span className="timer-stone">{p.color === 'black' ? '●' : '○'}</span>
                <span className="timer-name">{p.nickname}</span>
                <span className="timer-total">{formatTime(p.totalTime)}</span>
                {p.color === gameState.currentColor && gameState.phase === 'playing' && (
                  <span className={`timer-move ${p.moveTime < 10000 ? 'timer-urgent' : ''}`}>{formatTime(p.moveTime)}</span>
                )}
              </div>
            ))}
          </div>

          {/* Board */}
          <div className="gomoku-board-wrap">
            <div className="gomoku-board">
              {gameState.board.map((row, r) => (
                <div key={r} className="gomoku-row">
                  {row.map((cell, c) => (
                    <div
                      key={c}
                      className={`gomoku-cell ${isMyTurn && cell === null ? 'placeable' : ''} ${gameState.lastMove?.row === r && gameState.lastMove?.col === c ? 'last-move' : ''} ${winSet.has(`${r},${c}`) ? 'win-cell' : ''}`}
                      onClick={() => handlePlace(r, c)}
                    >
                      {cell && <div className={`gomoku-stone ${cell}`} />}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          {gameState.phase === 'playing' && !isSpectating && (
            <div className="gomoku-actions">
              <button onClick={handleResign} className="btn-secondary">기권</button>
            </div>
          )}

          {/* Game over */}
          {gameState.phase === 'game_over' && (
            <div className="modal-overlay">
              <div className="modal score-modal">
                <h2>{gameState.winnerId ? `${gameState.players.find((p) => p.id === gameState.winnerId)?.nickname} 승리!` : '무승부'}</h2>
                {gameState.winReason && <p className="gomoku-win-reason">{winReasonText[gameState.winReason]}</p>}
                <div className="dv-result-list">
                  {gameState.players.map((p) => (
                    <div key={p.id} className={`dv-result-item ${p.id === gameState.winnerId ? 'winner' : ''}`}>
                      <span>{p.color === 'black' ? '●' : '○'} {p.nickname}</span>
                      <span>{p.id === gameState.winnerId ? '승리' : '패배'}</span>
                    </div>
                  ))}
                </div>
                <div className="modal-actions">
                  <button onClick={leaveGame} className="btn-secondary">나가기</button>
                  {isHost && <button onClick={returnToLobby} className="btn-primary">로비로 돌아가기</button>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <ChatPanel channel={roomId!} />
    </div>
  );
}
