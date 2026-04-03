import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import ChatPanel from '../components/ChatPanel';
import DaVinciGame from '../components/DaVinciGame';

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
  gameType?: string;
  rows: Card[][];
  hand: Card[];
  myPenalty: number;
  phase: string;
  round: number;
  choosingPlayerId: number | null;
  players: PlayerInfo[];
  totalScores: Record<number, number>;
  sortedPlays?: { playerId: number; card: Card | null; nickname?: string }[];
  spectating?: boolean;
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
  const [spectators, setSpectators] = useState<{ id: number; nickname: string }[]>([]);
  const [penaltyToast, setPenaltyToast] = useState<{ nickname: string; points: number } | null>(null);
  const [screenFlash, setScreenFlash] = useState(false);
  const [lastPlacement, setLastPlacement] = useState<{ playerId: number; nickname: string; card: Card; rowIndex: number; type: string } | null>(null);
  const [flyingCard, setFlyingCard] = useState<{ card: Card; from: DOMRect; to: DOMRect } | null>(null);
  const [myPlayedCard, setMyPlayedCard] = useState<number | null>(null);
  const [showScoreboard, setShowScoreboard] = useState(false);
  const revealCardRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const gameStateRef = useRef(gameState);
  const { user } = useAuth();
  const socket = useSocket();
  const navigate = useNavigate();

  useEffect(() => {
    if (!socket) return;

    const handleGameState = (state: GameStateView) => {
      console.log('[Game] game:state received, phase:', state.phase);
      gameStateRef.current = state;
      setGameState(state);
      if (state.phase === 'selecting') {
        setEvents([]);
        setAllSelected(null);
        setMyPlayedCard(null);
      }
    };

    const handleGameEvent = (event: GameEvent) => {
      setEvents((prev) => [...prev, event]);

      if ((event.type === 'placed' || event.type === 'took_row') && event.rowIndex !== undefined) {
        const nickname = gameStateRef.current?.players.find((p) => p.id === event.playerId)?.nickname || '???';
        setLastPlacement({ playerId: event.playerId, nickname, card: event.card, rowIndex: event.rowIndex, type: event.type });
        setTimeout(() => setLastPlacement(null), 750);

        // Trigger flying card animation
        const sourceEl = revealCardRefs.current.get(event.card.number);
        const rowEl = rowRefs.current.get(event.rowIndex);
        if (sourceEl && rowEl) {
          const from = sourceEl.getBoundingClientRect();
          const rowCardsEl = rowEl.querySelector('.row-cards')!;
          let toRect: { x: number; y: number };
          if (event.type === 'took_row') {
            // Row gets cleared, card goes to first slot
            const rc = rowCardsEl.getBoundingClientRect();
            toRect = { x: rc.x, y: rc.y };
          } else {
            // Normal placement: next to the last card
            const rowCards = rowEl.querySelectorAll('.row-cards > .card:not(.card-empty)');
            const lastCard = rowCards[rowCards.length - 1];
            if (lastCard) {
              const lastRect = lastCard.getBoundingClientRect();
              toRect = { x: lastRect.x + lastRect.width + 4, y: lastRect.y };
            } else {
              const rc = rowCardsEl.getBoundingClientRect();
              toRect = { x: rc.x, y: rc.y };
            }
          }
          setFlyingCard({ card: event.card, from, to: { x: toRect.x, y: toRect.y } as DOMRect });
          setTimeout(() => setFlyingCard(null), 500);
        }
      }

      if (event.type === 'took_row' && event.takenCards) {
        const points = event.takenCards.reduce((s, c) => s + c.bullHeads, 0);
        const nickname = gameStateRef.current?.players.find((p) => p.id === event.playerId)?.nickname || '???';
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
      alert('게임이 중단되었습니다.');
      navigate('/lobby');
    };

    const handleReadyStatus = (status: { ready: number[]; total: number }) => {
      setReadyStatus(status);
    };

    const handleRoomState = (state: { spectators?: { id: number; nickname: string }[] }) => {
      setSpectators(state.spectators || []);
    };

    socket.on('game:state', handleGameState);
    socket.on('game:event', handleGameEvent);
    socket.on('game:all_selected', handleAllSelected);
    socket.on('game:round_end', handleRoundEnd);
    socket.on('game:new_round', handleNewRound);
    socket.on('game:aborted', handleAborted);
    socket.on('game:ready_status', handleReadyStatus);
    socket.on('room:state', handleRoomState);

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
      socket.off('room:state', handleRoomState);
    };
  }, [socket, roomId]);

  const playCard = useCallback(() => {
    if (!socket || selectedCard === null) return;
    socket.emit('game:select_card', selectedCard);
    setMyPlayedCard(selectedCard);
    setSelectedCard(null);
  }, [socket, selectedCard]);

  const cancelCard = useCallback(() => {
    if (!socket) return;
    socket.emit('game:unselect_card');
    setMyPlayedCard(null);
  }, [socket]);

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

  if (gameState.gameType === 'davinci-code') {
    return <DaVinciGame socket={socket!} gameState={gameState as any} />;
  }

  const isSpectating = gameState.spectating === true;
  const isMyTurnToChoose = !isSpectating && gameState.phase === 'choosing_row' && gameState.choosingPlayerId === user?.id;
  const myPlayer = isSpectating ? null : gameState.players.find((p) => p.id === user?.id);
  const isHost = !isSpectating && gameState.players[0]?.id === user?.id;

  return (
    <div className="page-layout">
    {screenFlash && <div className="penalty-flash" />}
    {flyingCard && (
      <div
        className={`flying-card card bull-${getBullClass(flyingCard.card.bullHeads)}`}
        style={{
          '--from-x': `${flyingCard.from.x}px`,
          '--from-y': `${flyingCard.from.y}px`,
          '--to-x': `${flyingCard.to.x}px`,
          '--to-y': `${flyingCard.to.y}px`,
          '--from-w': `${flyingCard.from.width}px`,
          '--from-h': `${flyingCard.from.height}px`,
        } as React.CSSProperties}
      >
        <span className="card-number">{flyingCard.card.number}</span>
        <span className="card-bulls">{'🐂'.repeat(flyingCard.card.bullHeads)}</span>
      </div>
    )}
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
        <div className="my-penalty" onClick={() => setShowScoreboard(!showScoreboard)} style={{ cursor: 'pointer' }}>
          {isSpectating ? '관전 중' : `🐂 ${(gameState.totalScores[user?.id ?? -1] || 0) + (myPlayer?.penalty || 0)} / 66`}
          <span className="scoreboard-hint"> [점수표]</span>
        </div>
      </header>

      {/* Scoreboard */}
      {showScoreboard && (
        <div className="scoreboard-panel">
          <div className="scoreboard-header">
            <h3>종합 점수표</h3>
            <button onClick={() => setShowScoreboard(false)} className="btn-secondary btn-small">닫기</button>
          </div>
          <table className="score-table">
            <thead>
              <tr>
                <th>플레이어</th>
                <th>이번 라운드</th>
                <th>총 벌점</th>
              </tr>
            </thead>
            <tbody>
              {gameState.players
                .map((p) => ({
                  ...p,
                  totalScore: (gameState.totalScores[p.id] || 0) + p.penalty,
                }))
                .sort((a, b) => a.totalScore - b.totalScore)
                .map((p) => (
                  <tr key={p.id} className={p.id === user?.id ? 'score-me' : ''}>
                    <td>{p.nickname} {p.id === user?.id ? '(나)' : ''}</td>
                    <td>{p.penalty}</td>
                    <td>{p.totalScore} / 66</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

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
        {spectators.length > 0 && (
          <div className="spectator-badge">
            <span className="spectator-icon">👁</span>
            <span>{spectators.map((s) => s.nickname).join(', ')}</span>
          </div>
        )}
      </div>

      {/* All selected cards reveal */}
      {allSelected && (() => {
        const placedCards = new Set(events.filter(e => e.type === 'placed' || e.type === 'took_row').map(e => e.card.number));
        return (
          <div className="selected-cards-reveal">
            {allSelected.map((play) => (
              <div key={play.playerId} className={`selected-play ${placedCards.has(play.card.number) ? 'play-done' : ''}`}>
                <span className="play-nickname">{play.nickname}</span>
                <div
                  ref={(el) => { if (el) revealCardRefs.current.set(play.card.number, el); }}
                  className={`card card-small bull-${getBullClass(play.card.bullHeads)}`}
                >
                  <span className="card-number">{play.card.number}</span>
                  <span className="card-bulls">{'🐂'.repeat(play.card.bullHeads)}</span>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Rows */}
      <div className="game-rows">
        {gameState.rows.map((row, rowIdx) => (
          <div
            key={rowIdx}
            ref={(el) => { if (el) rowRefs.current.set(rowIdx, el); }}
            className={`game-row ${isMyTurnToChoose ? 'chooseable' : ''} ${lastPlacement?.rowIndex === rowIdx ? 'row-highlight' : ''}`}
            onClick={() => isMyTurnToChoose && chooseRow(rowIdx)}
          >
            <div className="row-label">
              <span>열 {rowIdx + 1}</span>
              <span className="row-penalty">🐂 {row.reduce((sum, c) => sum + c.bullHeads, 0)}</span>
            </div>
            <div className="row-cards">
              {row.map((card, cardIdx) => (
                <div key={cardIdx} className={`card bull-${getBullClass(card.bullHeads)} ${lastPlacement?.card.number === card.number ? 'card-just-placed' : ''}`}>
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
      {gameState.phase === 'selecting' && !isSpectating && (
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
                <button onClick={cancelCard} className="btn-secondary btn-small" style={{ marginTop: 8 }}>선택 취소</button>
              </div>
              <div className="hand-cards hand-waiting">
                {gameState.hand.map((card) => (
                  <div
                    key={card.number}
                    className={`card bull-${getBullClass(card.bullHeads)} ${myPlayedCard === card.number ? 'card-played' : 'card-dimmed'}`}
                    onClick={myPlayedCard === card.number ? cancelCard : undefined}
                    style={myPlayedCard === card.number ? { cursor: 'pointer' } : undefined}
                  >
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
              {isSpectating ? (
                <p className="waiting-message">다음 라운드를 기다리는 중...</p>
              ) : roundResult.gameOver ? (
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
    <ChatPanel channel={roomId!} />
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
