import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Socket } from 'socket.io-client';
import ChatPanel from './ChatPanel';

const RANK_NAMES: Record<number, string> = {
  1: '달무티', 2: '대주교', 3: '원수', 4: '남작부인',
  5: '수녀원장', 6: '기사', 7: '재봉사', 8: '석공',
  9: '요리사', 10: '양치기', 11: '석수', 12: '농부', 13: '광대',
};

const RANK_COLORS: Record<number, string> = {
  1: '#8b0000', 2: '#6a0dad', 3: '#1a3c6d', 4: '#8b4513',
  5: '#4a6741', 6: '#4a4a4a', 7: '#7a5230', 8: '#5a5a5a',
  9: '#8a6914', 10: '#3a6b3e', 11: '#6b6b6b', 12: '#8a7d6b', 13: '#d4a020',
};

interface DalmutiPlayerView {
  id: number;
  nickname: string;
  cardCount: number;
  passed: boolean;
  finished: boolean;
  finishOrder: number;
  hand?: { rank: number }[];
}

interface PlayedSet {
  playerId: number;
  cards: { rank: number }[];
  effectiveRank: number;
  count: number;
}

interface DalmutiStateView {
  gameType: 'dalmuti';
  players: DalmutiPlayerView[];
  phase: string;
  currentPlayerId: number;
  currentTrick: PlayedSet | null;
  round: number;
  maxRounds: number;
  roundResults: { playerId: number; nickname: string; position: number }[][];
  spectating?: boolean;
}

interface Props {
  socket: Socket;
  gameState: DalmutiStateView;
}

export default function DalmutiGame({ socket, gameState }: Props) {
  const { roomId } = useParams<{ roomId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedCards, setSelectedCards] = useState<number[]>([]); // indices in hand
  const [readyStatus, setReadyStatus] = useState<{ ready: number[]; total: number } | null>(null);
  const [replaceToast, setReplaceToast] = useState<string | null>(null);

  const isSpectating = gameState.spectating === true;
  const isMyTurn = gameState.currentPlayerId === user?.id && gameState.phase === 'playing';
  const myPlayer = gameState.players.find((p) => p.id === user?.id);
  const myHand = myPlayer?.hand || [];
  const isHost = gameState.players[0]?.id === user?.id;

  useEffect(() => {
    const handleReady = (status: { ready: number[]; total: number }) => setReadyStatus(status);
    const handleNewRound = () => { setReadyStatus(null); setSelectedCards([]); };
    const handleReplaced = (data: { nickname: string; botNickname: string }) => {
      setReplaceToast(`${data.nickname}님이 나갔습니다. ${data.botNickname}이(가) 대신합니다.`);
      setTimeout(() => setReplaceToast(null), 3000);
    };

    socket.on('game:ready_status', handleReady);
    socket.on('game:new_round', handleNewRound);
    socket.on('game:player_replaced', handleReplaced);
    return () => {
      socket.off('game:ready_status', handleReady);
      socket.off('game:new_round', handleNewRound);
      socket.off('game:player_replaced', handleReplaced);
    };
  }, [socket]);

  const toggleCard = (idx: number) => {
    if (!isMyTurn) return;
    setSelectedCards((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
    );
  };

  const canPlay = (): boolean => {
    if (selectedCards.length === 0) return false;
    const ranks = selectedCards.map((i) => myHand[i].rank);
    const nonJesters = ranks.filter((r) => r !== 13);
    if (nonJesters.length > 0 && !nonJesters.every((r) => r === nonJesters[0])) return false;
    const effectiveRank = nonJesters.length > 0 ? nonJesters[0] : 13;

    if (gameState.currentTrick) {
      if (ranks.length !== gameState.currentTrick.count) return false;
      if (effectiveRank >= gameState.currentTrick.effectiveRank) return false;
    }
    return true;
  };

  const handlePlay = () => {
    if (!canPlay()) return;
    const cardRanks = selectedCards.map((i) => myHand[i].rank);
    socket.emit('dalmuti:play', { cardRanks });
    setSelectedCards([]);
  };

  const handlePass = () => {
    socket.emit('dalmuti:pass');
    setSelectedCards([]);
  };

  const handleNextRound = () => {
    socket.emit('dalmuti:next_round');
  };

  const leaveGame = () => {
    socket.emit('room:leave');
    navigate('/lobby');
  };

  const returnToLobby = () => {
    socket.emit('game:return_lobby');
    navigate('/lobby');
  };

  const currentPlayer = gameState.players.find((p) => p.id === gameState.currentPlayerId);

  // Calculate overall scores for game_over
  const overallScores = gameState.roundResults.length > 0
    ? gameState.players.map((p) => {
        let score = 0;
        for (const round of gameState.roundResults) {
          const r = round.find((x) => x.playerId === p.id);
          if (r) score += gameState.players.length - r.position + 1;
        }
        return { ...p, score };
      }).sort((a, b) => b.score - a.score)
    : [];

  return (
    <div className="page-layout">
      <div className="page-main">
        <div className="game-container">
          <header className="game-header">
            <button onClick={leaveGame} className="btn-secondary btn-small">나가기</button>
            <div className="round-info">달무티 - 라운드 {gameState.round}/{gameState.maxRounds}</div>
            <div className="phase-info">
              {gameState.phase === 'playing'
                ? (isMyTurn ? '카드를 내세요' : `${currentPlayer?.nickname}의 차례...`)
                : gameState.phase === 'round_end' ? '라운드 종료!'
                : '게임 종료!'
              }
            </div>
            <div className="my-penalty">{isSpectating ? '관전 중' : `내 카드: ${myHand.length}장`}</div>
          </header>

          {replaceToast && <div className="replace-toast">{replaceToast}</div>}

          {/* Current trick */}
          <div className="dal-trick-area">
            {gameState.currentTrick ? (
              <div className="dal-trick">
                <span className="dal-trick-label">
                  {gameState.players.find((p) => p.id === gameState.currentTrick!.playerId)?.nickname}:
                </span>
                <div className="dal-trick-cards">
                  {gameState.currentTrick.cards.map((c, i) => (
                    <div key={i} className="dal-card dal-card-small" style={{ backgroundColor: RANK_COLORS[c.rank] || '#666' }}>
                      <span className="dal-card-rank">{c.rank === 13 ? '★' : c.rank}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="dal-trick-empty">새로운 트릭 - 자유롭게 카드를 내세요</div>
            )}
          </div>

          {/* Players */}
          <div className="dal-players">
            {gameState.players.map((p) => (
              <div key={p.id} className={`dal-player ${p.id === gameState.currentPlayerId ? 'active' : ''} ${p.finished ? 'finished' : ''} ${p.passed ? 'passed' : ''}`}>
                <div className="dal-player-info">
                  <span className={`dal-player-name ${p.id === user?.id ? 'is-me' : ''}`}>{p.nickname}</span>
                  {p.finished && <span className="dal-finish-badge">{p.finishOrder}등</span>}
                  {p.passed && !p.finished && <span className="dal-pass-badge">패스</span>}
                </div>
                <span className="dal-player-cards">{p.cardCount}장</span>
              </div>
            ))}
          </div>

          {/* My hand */}
          {!isSpectating && myHand.length > 0 && gameState.phase === 'playing' && (
            <div className="dal-hand-area">
              <div className="dal-hand">
                {myHand.map((card, i) => (
                  <div
                    key={i}
                    className={`dal-card ${selectedCards.includes(i) ? 'dal-card-selected' : ''} ${isMyTurn ? 'dal-card-playable' : ''}`}
                    style={{ backgroundColor: RANK_COLORS[card.rank] || '#666' }}
                    onClick={() => toggleCard(i)}
                  >
                    <span className="dal-card-rank">{card.rank === 13 ? '★' : card.rank}</span>
                    <span className="dal-card-name">{RANK_NAMES[card.rank]}</span>
                  </div>
                ))}
              </div>
              {isMyTurn && (
                <div className="dal-actions">
                  <button onClick={handlePlay} className="btn-primary" disabled={!canPlay()}>
                    카드 내기 ({selectedCards.length}장)
                  </button>
                  {gameState.currentTrick && (
                    <button onClick={handlePass} className="btn-secondary">패스</button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Round end */}
          {gameState.phase === 'round_end' && (
            <div className="modal-overlay">
              <div className="modal score-modal">
                <h2>라운드 {gameState.round} 결과</h2>
                <div className="dv-result-list">
                  {gameState.roundResults[gameState.roundResults.length - 1]?.map((r) => (
                    <div key={r.playerId} className={`dv-result-item ${r.position === 1 ? 'winner' : ''}`}>
                      <span>{r.position}등 - {r.nickname}</span>
                      <span>{RANK_NAMES[r.position] || ''}</span>
                    </div>
                  ))}
                </div>
                <div className="modal-actions">
                  <button onClick={leaveGame} className="btn-secondary">나가기</button>
                  {!isSpectating && (
                    <button
                      onClick={handleNextRound}
                      className="btn-primary"
                      disabled={readyStatus?.ready.includes(user?.id ?? -1)}
                    >
                      {readyStatus?.ready.includes(user?.id ?? -1) ? '대기 중...' : '다음 라운드'}
                    </button>
                  )}
                </div>
                {readyStatus && (
                  <div className="ready-status">
                    <p>{readyStatus.ready.length}/{readyStatus.total}명 준비 완료</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Game over */}
          {gameState.phase === 'game_over' && (
            <div className="modal-overlay">
              <div className="modal score-modal">
                <h2>게임 종료!</h2>
                <table className="score-table">
                  <thead>
                    <tr><th>순위</th><th>플레이어</th><th>점수</th></tr>
                  </thead>
                  <tbody>
                    {overallScores.map((p, i) => (
                      <tr key={p.id} className={i === 0 ? 'winner' : ''}>
                        <td>{i + 1}</td>
                        <td>{p.nickname} {p.id === user?.id ? '(나)' : ''}</td>
                        <td>{p.score}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
