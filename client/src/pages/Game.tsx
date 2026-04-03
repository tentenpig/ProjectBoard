import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import Chat from '../components/Chat';

interface Card {
  number: number;
  bullHeads: number;
}

interface PlayerInfo {
  id: number;
  nickname: string;
  cardCount: number;
  hasSelected: boolean;
  penalty: number;
}

interface GameStateView {
  rows: Card[][];
  hand: Card[];
  myPenalty: number;
  phase: string;
  round: number;
  choosingPlayerId: number | null;
  players: PlayerInfo[];
  totalScores: Record<number, number>;
  sortedPlays?: { playerId: number; card: Card | null; nickname?: string }[];
}

interface GameEvent {
  type: string;
  playerId: number;
  card: Card;
  rowIndex?: number;
  takenCards?: Card[];
}

interface RoundEndResult {
  scores: { playerId: number; nickname: string; roundPenalty: number; totalScore: number }[];
  gameOver: boolean;
}

export default function Game() {
  const { roomId } = useParams<{ roomId: string }>();
  const [gameState, setGameState] = useState<GameStateView | null>(null);
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [roundResult, setRoundResult] = useState<RoundEndResult | null>(null);
  const [allSelected, setAllSelected] = useState<{ playerId: number; card: Card; nickname?: string }[] | null>(null);
  const [readyStatus, setReadyStatus] = useState<{ ready: number[]; total: number } | null>(null);
  const [penaltyToast, setPenaltyToast] = useState<{ nickname: string; points: number } | null>(null);
  const [screenFlash, setScreenFlash] = useState(false);
  const { user } = useAuth();
  const socket = useSocket();
  const navigate = useNavigate();

  useEffect(() => {
    if (!socket) return;

    const handleGameState = (state: GameStateView) => {
      console.log('[Game] game:state received, phase:', state.phase);
      setGameState(state);
      if (state.phase === 'selecting') {
        setEvents([]);
        setAllSelected(null);
      }
    };

    const handleGameEvent = (event: GameEvent) => {
      setEvents((prev) => [...prev, event]);
      if (event.type === 'took_row' && event.takenCards) {
        const points = event.takenCards.reduce((s, c) => s + c.bullHeads, 0);
        const nickname = gameState?.players.find((p) => p.id === event.playerId)?.nickname || '???';
        setPenaltyToast({ nickname, points });
        if (event.playerId === user?.id) {
          setScreenFlash(true);
          setTimeout(() => setScreenFlash(false), 500);
        }
        setTimeout(() => setPenaltyToast(null), 2500);
      }
    };

    const handleAllSelected = (plays: { playerId: number; card: Card; nickname?: string }[]) => {
      setAllSelected(plays);
    };

    const handleRoundEnd = (result: RoundEndResult) => {
      setRoundResult(result);
    };

    const handleNewRound = () => {
      setRoundResult(null);
      setReadyStatus(null);
      setEvents([]);
      setAllSelected(null);
      setSelectedCard(null);
    };

    const handleAborted = () => {
      alert('상대방이 나갔습니다. 대기실로 돌아갑니다.');
      navigate(`/room/${roomId}`);
    };

    const handleReadyStatus = (status: { ready: number[]; total: number }) => {
      setReadyStatus(status);
    };

    socket.on('game:state', handleGameState);
    socket.on('game:event', handleGameEvent);
    socket.on('game:all_selected', handleAllSelected);
    socket.on('game:round_end', handleRoundEnd);
    socket.on('game:new_round', handleNewRound);
    socket.on('game:aborted', handleAborted);
    socket.on('game:ready_status', handleReadyStatus);

    // Request current game state on mount
    if (roomId) {
      console.log('[Game] Emitting room:get_state', roomId);
      socket.emit('room:get_state', roomId);
    }

    return () => {
      socket.off('game:state', handleGameState);
      socket.off('game:event', handleGameEvent);
      socket.off('game:all_selected', handleAllSelected);
      socket.off('game:round_end', handleRoundEnd);
      socket.off('game:new_round', handleNewRound);
      socket.off('game:ready_status', handleReadyStatus);
      socket.off('game:aborted', handleAborted);
    };
  }, [socket, roomId]);

  const playCard = useCallback(() => {
    if (!socket || selectedCard === null) return;
    socket.emit('game:select_card', selectedCard);
    setSelectedCard(null);
  }, [socket, selectedCard]);

  const chooseRow = (rowIndex: number) => {
    if (!socket) return;
    socket.emit('game:choose_row', rowIndex);
  };

  const nextRound = () => {
    if (!socket) return;
    socket.emit('game:next_round');
  };

  const returnToLobby = () => {
    if (!socket) return;
    socket.emit('game:return_lobby');
    navigate('/lobby');
  };

  const leaveGame = () => {
    if (!socket) return;
    socket.emit('room:leave');
    navigate('/lobby');
  };

  if (!gameState) {
    return <div className="loading">게임을 불러오는 중...</div>;
  }

  const isMyTurnToChoose = gameState.phase === 'choosing_row' && gameState.choosingPlayerId === user?.id;
  const myPlayer = gameState.players.find((p) => p.id === user?.id);
  const isHost = gameState.players[0]?.id === user?.id;

  return (
    <div className="page-layout">
    {screenFlash && <div className="penalty-flash" />}
    {penaltyToast && (
      <div className={`penalty-toast ${penaltyToast.nickname === user?.nickname ? 'penalty-mine' : ''}`}>
        <span className="penalty-icon">🐂</span>
        <span>{penaltyToast.nickname} +{penaltyToast.points} 벌점!</span>
      </div>
    )}
    <div className="page-main">
    <div className="game-container">
      <header className="game-header">
        <button onClick={leaveGame} className="btn-secondary btn-small">나가기</button>
        <div className="round-info">라운드 {gameState.round}</div>
        <div className="phase-info">
          {gameState.phase === 'selecting' && '카드를 선택하세요'}
          {gameState.phase === 'resolving' && '카드 배치 중...'}
          {gameState.phase === 'choosing_row' && (
            isMyTurnToChoose
              ? '가져갈 열을 선택하세요!'
              : `${gameState.players.find((p) => p.id === gameState.choosingPlayerId)?.nickname}님이 열을 선택 중...`
          )}
          {gameState.phase === 'round_end' && '라운드 종료!'}
          {gameState.phase === 'game_over' && '게임 종료!'}
        </div>
        <div className="my-penalty">내 벌점: {myPlayer?.penalty || 0}</div>
      </header>

      {/* Players bar */}
      <div className="players-bar">
        {gameState.players.map((p) => (
          <div key={p.id} className={`player-badge ${p.id === user?.id ? 'me' : ''} ${p.hasSelected ? 'selected' : ''}`}>
            <span className="player-name">{p.nickname}</span>
            <span className="player-cards">{p.cardCount}장</span>
            <span className="player-penalty">🐂 {p.penalty}</span>
            {p.hasSelected && gameState.phase === 'selecting' && <span className="check">✓</span>}
          </div>
        ))}
      </div>

      {/* All selected cards reveal */}
      {allSelected && (
        <div className="selected-cards-reveal">
          {allSelected.map((play) => (
            <div key={play.playerId} className="selected-play">
              <span className="play-nickname">{play.nickname}</span>
              <div className={`card card-small bull-${getBullClass(play.card.bullHeads)}`}>
                <span className="card-number">{play.card.number}</span>
                <span className="card-bulls">{'🐂'.repeat(play.card.bullHeads)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Rows */}
      <div className="game-rows">
        {gameState.rows.map((row, rowIdx) => (
          <div
            key={rowIdx}
            className={`game-row ${isMyTurnToChoose ? 'chooseable' : ''}`}
            onClick={() => isMyTurnToChoose && chooseRow(rowIdx)}
          >
            <div className="row-label">
              <span>열 {rowIdx + 1}</span>
              <span className="row-penalty">🐂 {row.reduce((sum, c) => sum + c.bullHeads, 0)}</span>
            </div>
            <div className="row-cards">
              {row.map((card, cardIdx) => (
                <div key={cardIdx} className={`card bull-${getBullClass(card.bullHeads)}`}>
                  <span className="card-number">{card.number}</span>
                  <span className="card-bulls">{'🐂'.repeat(card.bullHeads)}</span>
                </div>
              ))}
              {/* Empty slots */}
              {Array.from({ length: 5 - row.length }).map((_, i) => (
                <div key={`empty-${i}`} className="card card-empty" />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Hand */}
      {gameState.phase === 'selecting' && (
        <div className="hand-area">
          {myPlayer?.hasSelected ? (
            <>
              <div className="waiting-select">
                <p>카드를 선택했습니다. 다른 플레이어를 기다리는 중...</p>
                <div className="waiting-players">
                  {gameState.players.filter((p) => !p.hasSelected).map((p) => (
                    <span key={p.id} className="waiting-name">{p.nickname}</span>
                  ))}
                </div>
              </div>
              <div className="hand-cards hand-disabled">
                {gameState.hand.map((card) => (
                  <div key={card.number} className={`card bull-${getBullClass(card.bullHeads)}`}>
                    <span className="card-number">{card.number}</span>
                    <span className="card-bulls">{'🐂'.repeat(card.bullHeads)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="hand-cards">
                {gameState.hand.map((card) => (
                  <div
                    key={card.number}
                    className={`card card-hand bull-${getBullClass(card.bullHeads)} ${selectedCard === card.number ? 'card-selected' : ''}`}
                    onClick={() => setSelectedCard(card.number)}
                  >
                    <span className="card-number">{card.number}</span>
                    <span className="card-bulls">{'🐂'.repeat(card.bullHeads)}</span>
                  </div>
                ))}
              </div>
              {selectedCard !== null && (
                <button onClick={playCard} className="btn-primary btn-play">
                  카드 내기 ({selectedCard})
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Round end / Game over overlay */}
      {roundResult && (
        <div className="modal-overlay">
          <div className="modal score-modal">
            <h2>{roundResult.gameOver ? '🏆 게임 종료!' : `라운드 ${gameState.round} 결과`}</h2>
            <table className="score-table">
              <thead>
                <tr>
                  <th>플레이어</th>
                  <th>이번 라운드</th>
                  <th>총 벌점</th>
                </tr>
              </thead>
              <tbody>
                {[...roundResult.scores]
                  .sort((a, b) => a.totalScore - b.totalScore)
                  .map((s, i) => (
                    <tr key={s.playerId} className={i === 0 && roundResult.gameOver ? 'winner' : ''}>
                      <td>{s.nickname} {s.playerId === user?.id ? '(나)' : ''}</td>
                      <td>+{s.roundPenalty}</td>
                      <td>{s.totalScore}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <div className="modal-actions">
              <button onClick={leaveGame} className="btn-secondary">나가기</button>
              {roundResult.gameOver ? (
                <button onClick={returnToLobby} className="btn-primary">로비로 돌아가기</button>
              ) : (
                <button
                  onClick={nextRound}
                  className="btn-primary"
                  disabled={readyStatus?.ready.includes(user?.id ?? -1)}
                >
                  {readyStatus?.ready.includes(user?.id ?? -1) ? '대기 중...' : '다음 라운드'}
                </button>
              )}
            </div>
            {readyStatus && !roundResult.gameOver && (
              <div className="ready-status">
                <p>{readyStatus.ready.length}/{readyStatus.total}명 준비 완료</p>
                <div className="ready-players">
                  {gameState.players.map((p) => (
                    <span key={p.id} className={`ready-player ${readyStatus.ready.includes(p.id) ? 'is-ready' : ''}`}>
                      {p.nickname} {readyStatus.ready.includes(p.id) ? '✓' : '...'}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
    </div>
    <div className="page-chat">
      <Chat channel={roomId!} />
    </div>
    </div>
  );
}

function getBullClass(bullHeads: number): string {
  if (bullHeads >= 7) return '7';
  if (bullHeads >= 5) return '5';
  if (bullHeads >= 3) return '3';
  if (bullHeads >= 2) return '2';
  return '1';
}
