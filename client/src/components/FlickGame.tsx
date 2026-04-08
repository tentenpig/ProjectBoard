import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Socket } from 'socket.io-client';
import ChatPanel from './ChatPanel';
import ExpGainedBadge from './ExpGainedBadge';
import { useExpGained } from '../hooks/useExpGained';

const BOARD_W = 600;
const BOARD_H = 600;
const STONE_R = 15;
const TEAM_COLORS = ['#c0392b', '#2980b9'];
const TEAM_NAMES = ['RED', 'BLUE'];

interface StoneView { id: number; team: number; x: number; y: number; alive: boolean; }
interface PlayerView { id: number; nickname: string; team: number; connected: boolean; }
interface SimFrame { stones: { id: number; x: number; y: number; alive: boolean }[]; }

interface WallView { x: number; y: number; w: number; h: number; }

interface FlickStateView {
  gameType: 'flick';
  stones: StoneView[];
  walls: WallView[];
  players: PlayerView[];
  currentTeam: number;
  currentPlayerId: number | null;
  phase: string;
  winningTeam: number | null;
  winReason: string | null;
  turnCount: number;
  simulationFrames: SimFrame[] | null;
  myTeam: number | null;
  spectating?: boolean;
}

interface Props { socket: Socket; gameState: FlickStateView; }

export default function FlickGame({ socket, gameState }: Props) {
  const { roomId } = useParams<{ roomId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedStone, setSelectedStone] = useState<number | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ x: number; y: number } | null>(null);
  const [animating, setAnimating] = useState(false);
  const animStonesRef = useRef<StoneView[] | null>(null);
  const animFrameRef = useRef<number>(0);
  const [replaceToast, setReplaceToast] = useState<string | null>(null);

  const expGained = useExpGained(socket);
  const isSpectating = gameState.spectating === true;
  const isMyTurn = !isSpectating && gameState.currentPlayerId === user?.id && gameState.phase === 'aiming';
  const isHost = gameState.players[0]?.id === user?.id;

  useEffect(() => {
    const handleReplaced = (data: { nickname: string }) => {
      setReplaceToast(`${data.nickname}님이 나갔습니다.`);
      setTimeout(() => setReplaceToast(null), 3000);
    };

    const handleAnimation = (frames: SimFrame[]) => {
      if (!frames || frames.length === 0) return;
      setAnimating(true);
      let frameIdx = 0;
      let tick = 0;

      const play = () => {
        tick++;
        if (tick % 2 === 0) {
          if (frameIdx >= frames.length) {
            // Keep last frame in ref, stop animating
            animStonesRef.current = frames[frames.length - 1].stones as StoneView[];
            setAnimating(false);
            return;
          }
          animStonesRef.current = frames[frameIdx].stones as StoneView[];
          frameIdx++;
        }
        animFrameRef.current = requestAnimationFrame(play);
      };
      play();
    };

    socket.on('game:player_replaced', handleReplaced);
    socket.on('flick:animation', handleAnimation);
    return () => {
      socket.off('game:player_replaced', handleReplaced);
      socket.off('flick:animation', handleAnimation);
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [socket]);

  // When server sends new game:state (after simulation applied), clear animation ref
  useEffect(() => {
    if (gameState.phase === 'aiming' || gameState.phase === 'game_over') {
      animStonesRef.current = null;
    }
  }, [gameState.phase]);

  // Use animation stones if available, otherwise server state
  const displayStones = animStonesRef.current || gameState.stones;

  // Force re-render during animation so canvas redraws with ref data
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    if (!animating) return;
    const interval = setInterval(() => forceUpdate((n) => n + 1), 33);
    return () => clearInterval(interval);
  }, [animating]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const scale = canvas.width / BOARD_W;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Board background
    ctx.fillStyle = '#5d8a3c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Border
    ctx.strokeStyle = '#3a5a25';
    ctx.lineWidth = 3 * scale;
    ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);

    // Center line
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.stroke();

    // Walls
    for (const wall of gameState.walls || []) {
      const wx = wall.x * scale;
      const wy = wall.y * scale;
      const ww = wall.w * scale;
      const wh = wall.h * scale;

      ctx.fillStyle = '#4a3520';
      ctx.fillRect(wx, wy, ww, wh);
      ctx.strokeStyle = '#2a1a0a';
      ctx.lineWidth = 2 * scale;
      ctx.strokeRect(wx, wy, ww, wh);
      // Top highlight
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(wx, wy, ww, 2 * scale);
    }

    // Stones
    for (const stone of displayStones) {
      if (!stone.alive) continue;
      const x = stone.x * scale;
      const y = stone.y * scale;
      const r = STONE_R * scale;

      // Shadow
      ctx.beginPath();
      ctx.arc(x + 2 * scale, y + 2 * scale, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fill();

      // Stone
      const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      grad.addColorStop(0, stone.team === 0 ? '#e74c3c' : '#3498db');
      grad.addColorStop(1, stone.team === 0 ? '#922b21' : '#1a5276');
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      // Highlight if selected
      if (selectedStone === stone.id && isMyTurn) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2 * scale;
        ctx.stroke();
      }

      // Shine
      ctx.beginPath();
      ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fill();
    }

    // Drag arrow
    if (dragStart && dragEnd && selectedStone !== null && isMyTurn) {
      const stone = displayStones.find((s) => s.id === selectedStone);
      if (stone) {
        const sx = stone.x * scale;
        const sy = stone.y * scale;
        const dx = (dragEnd.x - dragStart.x);
        const dy = (dragEnd.y - dragStart.y);
        const mag = Math.sqrt(dx * dx + dy * dy);
        if (mag > 5) {
          const maxLen = 80 * scale;
          const len = Math.min(mag, maxLen);
          const nx = (-dx / mag) * len;
          const ny = (-dy / mag) * len;
          ctx.strokeStyle = 'rgba(255,255,0,0.8)';
          ctx.lineWidth = 3 * scale;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + nx, sy + ny);
          ctx.stroke();
          // Arrowhead
          const angle = Math.atan2(ny, nx);
          ctx.beginPath();
          ctx.moveTo(sx + nx, sy + ny);
          ctx.lineTo(sx + nx - 8 * scale * Math.cos(angle - 0.4), sy + ny - 8 * scale * Math.sin(angle - 0.4));
          ctx.moveTo(sx + nx, sy + ny);
          ctx.lineTo(sx + nx - 8 * scale * Math.cos(angle + 0.4), sy + ny - 8 * scale * Math.sin(angle + 0.4));
          ctx.stroke();
          // Power indicator
          const power = Math.min(mag / 80, 1);
          ctx.fillStyle = `rgba(255, ${Math.floor(255 * (1 - power))}, 0, 0.9)`;
          ctx.font = `${12 * scale}px sans-serif`;
          ctx.fillText(`${Math.floor(power * 100)}%`, sx + nx + 10 * scale, sy + ny);
        }
      }
    }
  }, [displayStones, selectedStone, dragStart, dragEnd, isMyTurn, animating]);

  const getCanvasPos = (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const scale = BOARD_W / rect.width;
    return { x: (clientX - rect.left) * scale, y: (clientY - rect.top) * scale };
  };

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isMyTurn || animating) return;
    const pos = getCanvasPos(e);

    // Check if clicked on own stone
    const myStones = gameState.stones.filter((s) => s.team === gameState.myTeam && s.alive);
    for (const stone of myStones) {
      const dx = pos.x - stone.x;
      const dy = pos.y - stone.y;
      if (dx * dx + dy * dy <= (STONE_R + 5) * (STONE_R + 5)) {
        setSelectedStone(stone.id);
        setDragStart(pos);
        setDragEnd(pos);
        return;
      }
    }
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!dragStart || selectedStone === null) return;
    e.preventDefault();
    const pos = getCanvasPos(e);
    setDragEnd(pos);
  };

  const handlePointerUp = () => {
    if (!dragStart || !dragEnd || selectedStone === null) {
      setDragStart(null);
      setDragEnd(null);
      return;
    }

    const dx = dragEnd.x - dragStart.x;
    const dy = dragEnd.y - dragStart.y;
    const mag = Math.sqrt(dx * dx + dy * dy);

    if (mag > 10) {
      // Flick in opposite direction of drag
      const power = Math.min(mag / 80, 1) * 18;
      socket.emit('flick:shoot', {
        stoneId: selectedStone,
        dx: (-dx / mag) * power,
        dy: (-dy / mag) * power,
      });
    }

    setSelectedStone(null);
    setDragStart(null);
    setDragEnd(null);
  };

  const leaveGame = () => { socket.emit('room:leave'); navigate('/lobby'); };
  const returnToLobby = () => { socket.emit('game:return_lobby'); navigate('/lobby'); };

  const team0Count = gameState.stones.filter((s) => s.team === 0 && s.alive).length;
  const team1Count = gameState.stones.filter((s) => s.team === 1 && s.alive).length;

  return (
    <div className="page-layout">
      <div className="page-main">
        <div className="game-container">
          <header className="game-header">
            <button onClick={leaveGame} className="btn-secondary btn-small">나가기</button>
            <div className="round-info">알까기</div>
            <div className="phase-info">
              {gameState.phase === 'game_over'
                ? `${TEAM_NAMES[gameState.winningTeam!]} 팀 승리!`
                : animating ? '시뮬레이션 중...'
                : isMyTurn ? '돌을 드래그해서 쏘세요!'
                : `${gameState.players.find((p) => p.id === gameState.currentPlayerId)?.nickname || TEAM_NAMES[gameState.currentTeam]}의 차례`
              }
            </div>
            <div className="my-penalty">
              {isSpectating ? '관전 중' : `${TEAM_NAMES[gameState.myTeam!]} 팀`}
            </div>
          </header>

          {replaceToast && <div className="replace-toast">{replaceToast}</div>}

          {/* Score bar */}
          <div className="flick-score">
            <span style={{ color: TEAM_COLORS[0] }}>● RED {team0Count}</span>
            <span>턴 {gameState.turnCount}</span>
            <span style={{ color: TEAM_COLORS[1] }}>● BLUE {team1Count}</span>
          </div>

          {/* Players */}
          <div className="flick-teams">
            {[0, 1].map((team) => (
              <div key={team} className="flick-team" style={{ borderColor: TEAM_COLORS[team] }}>
                <div className="flick-team-name" style={{ color: TEAM_COLORS[team] }}>{TEAM_NAMES[team]}</div>
                {gameState.players.filter((p) => p.team === team).map((p) => (
                  <span key={p.id} className={`flick-player ${!p.connected ? 'disconnected' : ''} ${p.id === gameState.currentPlayerId ? 'active' : ''}`}>
                    {p.nickname}
                  </span>
                ))}
              </div>
            ))}
          </div>

          {/* Canvas */}
          <div className="flick-board-wrap">
            <canvas
              ref={canvasRef}
              width={BOARD_W}
              height={BOARD_H}
              className="flick-canvas"
              onMouseDown={handlePointerDown}
              onMouseMove={handlePointerMove}
              onMouseUp={handlePointerUp}
              onMouseLeave={handlePointerUp}
              onTouchStart={handlePointerDown}
              onTouchMove={handlePointerMove}
              onTouchEnd={handlePointerUp}
            />
          </div>

          {/* Game over */}
          {gameState.phase === 'game_over' && (
            <div className="modal-overlay">
              <div className="modal score-modal">
                <h2 style={{ color: TEAM_COLORS[gameState.winningTeam!] }}>
                  {TEAM_NAMES[gameState.winningTeam!]} 팀 승리!
                </h2>
                <p className="gomoku-win-reason">
                  {gameState.winReason === 'eliminate' ? '상대 팀 돌 전멸!' : '상대 팀 전원 이탈'}
                </p>
                <div className="modal-actions">
                  <button onClick={leaveGame} className="btn-secondary">나가기</button>
                  {isHost && <button onClick={returnToLobby} className="btn-primary">로비로 돌아가기</button>}
                </div>
                <ExpGainedBadge data={expGained} />
              </div>
            </div>
          )}
        </div>
      </div>
      <ChatPanel channel={roomId!} />
    </div>
  );
}
