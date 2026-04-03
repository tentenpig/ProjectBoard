import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Socket } from 'socket.io-client';
import ChatPanel from './ChatPanel';

interface TileView {
  id: number;
  number: number | null;
  color: 'black' | 'white';
  revealed: boolean;
  joker: boolean | null;
}

interface PlayerView {
  id: number;
  nickname: string;
  eliminated: boolean;
  tiles: TileView[];
  tileCount: number;
  hiddenCount: number;
}

interface DaVinciStateView {
  gameType: 'davinci-code';
  players: PlayerView[];
  poolCount: number;
  currentPlayerId: number;
  phase: string;
  drawnTile: any;
  lastGuessCorrect: boolean;
  winnerId: number | null;
  spectating?: boolean;
}

interface Props {
  socket: Socket;
  gameState: DaVinciStateView;
}

export default function DaVinciGame({ socket, gameState }: Props) {
  const { roomId } = useParams<{ roomId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedTarget, setSelectedTarget] = useState<{ playerId: number; tileIndex: number } | null>(null);
  const [guessNumber, setGuessNumber] = useState<number | null>(null);
  const [guessAnim, setGuessAnim] = useState<{
    playerName: string;
    targetName: string;
    tileIndex: number;
    targetPlayerId: number;
    guessedNumber: number;
    phase: 'pending' | 'result';
    correct: boolean;
  } | null>(null);

  const isMyTurn = gameState.currentPlayerId === user?.id;
  const isSpectating = gameState.spectating === true;
  const myPlayer = gameState.players.find((p) => p.id === user?.id);

  useEffect(() => {
    const handleResult = (data: any) => {
      const playerName = gameState.players.find((p) => p.id === data.playerId)?.nickname || '???';
      const targetName = gameState.players.find((p) => p.id === data.targetPlayerId)?.nickname || '???';

      // Phase 1: Show pending animation (highlight tile)
      setGuessAnim({
        playerName,
        targetName,
        tileIndex: data.tileIndex,
        targetPlayerId: data.targetPlayerId,
        guessedNumber: data.guessedNumber,
        phase: 'pending',
        correct: data.correct,
      });

      // Phase 2: Show result after 1 second
      setTimeout(() => {
        setGuessAnim((prev) => prev ? { ...prev, phase: 'result' } : null);
      }, 1000);

      // Phase 3: Clear after another 1.5 seconds
      setTimeout(() => {
        setGuessAnim(null);
      }, 2500);

      setSelectedTarget(null);
      setGuessNumber(null);
    };

    socket.on('davinci:guess_result', handleResult);
    return () => { socket.off('davinci:guess_result', handleResult); };
  }, [socket, gameState.players]);

  const handleDraw = () => {
    socket.emit('davinci:draw');
  };

  const handleGuess = () => {
    if (!selectedTarget || guessNumber === null) return;
    socket.emit('davinci:guess', {
      targetPlayerId: selectedTarget.playerId,
      tileIndex: selectedTarget.tileIndex,
      guessedNumber: guessNumber,
    });
  };

  const handleContinue = () => {
    socket.emit('davinci:continue');
  };

  const handleStop = () => {
    socket.emit('davinci:stop', {});
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
  const isHost = gameState.players[0]?.id === user?.id;

  const renderTile = (tile: TileView, belongsToMe: boolean, playerId: number, tileIndex: number) => {
    const isSelectable = isMyTurn && !isSpectating && gameState.phase === 'guessing'
      && playerId !== user?.id && !tile.revealed && !guessAnim;
    const isSelected = selectedTarget?.playerId === playerId && selectedTarget?.tileIndex === tileIndex;
    const isGuessTarget = guessAnim?.targetPlayerId === playerId && guessAnim?.tileIndex === tileIndex;
    const guessClass = isGuessTarget
      ? (guessAnim?.phase === 'pending' ? 'guess-pending' : guessAnim?.correct ? 'guess-correct' : 'guess-wrong')
      : '';

    return (
      <div
        key={tile.id}
        className={`dv-tile ${tile.color} ${tile.revealed ? 'revealed' : 'hidden'} ${isSelectable ? 'selectable' : ''} ${isSelected ? 'selected' : ''} ${guessClass}`}
        onClick={() => isSelectable && setSelectedTarget({ playerId, tileIndex })}
      >
        {(tile.revealed || (belongsToMe && tile.number !== null)) ? (
          <span className="dv-tile-number">{tile.joker ? '★' : tile.number}</span>
        ) : isGuessTarget && guessAnim?.phase === 'pending' ? (
          <span className="dv-tile-number dv-guess-num">{guessAnim.guessedNumber === -1 ? '★' : guessAnim.guessedNumber}?</span>
        ) : (
          <span className="dv-tile-back">?</span>
        )}
      </div>
    );
  };

  return (
    <div className="page-layout">
      <div className="page-main">
        <div className="game-container">
          <header className="game-header">
            <button onClick={leaveGame} className="btn-secondary btn-small">나가기</button>
            <div className="round-info">다빈치 코드</div>
            <div className="phase-info">
              {gameState.phase === 'game_over'
                ? `${gameState.players.find((p) => p.id === gameState.winnerId)?.nickname} 승리!`
                : isSpectating
                ? `${currentPlayer?.nickname}의 턴`
                : isMyTurn
                ? (gameState.phase === 'drawing' ? '타일을 뽑으세요'
                  : gameState.phase === 'guessing' ? '상대 타일을 추측하세요'
                  : '계속 추측하거나 멈추세요')
                : `${currentPlayer?.nickname}의 턴...`
              }
            </div>
            <div className="my-penalty">{isSpectating ? '관전 중' : `남은 타일: ${gameState.poolCount}개`}</div>
          </header>

          {/* Guess animation banner */}
          {guessAnim && (
            <div className={`dv-guess-banner ${guessAnim.phase === 'result' ? (guessAnim.correct ? 'dv-banner-correct' : 'dv-banner-wrong') : 'dv-banner-pending'}`}>
              <span className="dv-banner-text">
                <strong>{guessAnim.playerName}</strong>이(가) <strong>{guessAnim.targetName}</strong>의 {guessAnim.tileIndex + 1}번째 타일을
                <span className="dv-banner-number">{guessAnim.guessedNumber === -1 ? ' ★' : ` ${guessAnim.guessedNumber}`}</span>
                (으)로 추측!
              </span>
              {guessAnim.phase === 'result' && (
                <span className="dv-banner-result">{guessAnim.correct ? '정답!' : '오답...'}</span>
              )}
              {guessAnim.phase === 'pending' && (
                <span className="dv-banner-dots">...</span>
              )}
            </div>
          )}

          {/* All players' tiles */}
          <div className="dv-board">
            {gameState.players.map((p) => (
              <div key={p.id} className={`dv-player-row ${p.eliminated ? 'eliminated' : ''} ${p.id === gameState.currentPlayerId ? 'active-turn' : ''}`}>
                <div className="dv-player-info">
                  <span className={`dv-player-name ${p.id === user?.id ? 'is-me' : ''}`}>
                    {p.nickname}
                    {p.eliminated && ' (탈락)'}
                  </span>
                  <span className="dv-player-hidden">{p.hiddenCount}장 남음</span>
                </div>
                <div className="dv-tiles">
                  {p.tiles.map((tile, idx) => renderTile(tile, p.id === user?.id, p.id, idx))}
                </div>
              </div>
            ))}
          </div>

          {/* Drawn tile display */}
          {isMyTurn && !isSpectating && gameState.drawnTile && gameState.drawnTile.number !== undefined && (
            <div className="dv-drawn-area">
              <span>뽑은 타일:</span>
              <div className={`dv-tile ${gameState.drawnTile.color} revealed`}>
                <span className="dv-tile-number">{gameState.drawnTile.joker ? '★' : gameState.drawnTile.number}</span>
              </div>
            </div>
          )}

          {/* Action area */}
          {!isSpectating && isMyTurn && gameState.phase !== 'game_over' && (
            <div className="dv-actions">
              {gameState.phase === 'drawing' && (
                <button onClick={handleDraw} className="btn-primary">
                  {gameState.poolCount > 0 ? '타일 뽑기' : '뽑기 건너뛰기'}
                </button>
              )}

              {gameState.phase === 'guessing' && (
                <div className="dv-guess-controls">
                  {selectedTarget ? (
                    <>
                      <span className="dv-guess-label">
                        {gameState.players.find((p) => p.id === selectedTarget.playerId)?.nickname}의
                        {selectedTarget.tileIndex + 1}번째 타일:
                      </span>
                      <div className="dv-number-grid">
                        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => (
                          <button
                            key={n}
                            className={`dv-num-btn ${guessNumber === n ? 'active' : ''}`}
                            onClick={() => setGuessNumber(n)}
                          >
                            {n}
                          </button>
                        ))}
                        <button
                          className={`dv-num-btn dv-joker-btn ${guessNumber === -1 ? 'active' : ''}`}
                          onClick={() => setGuessNumber(-1)}
                        >
                          ★
                        </button>
                      </div>
                      <button
                        onClick={handleGuess}
                        className="btn-primary"
                        disabled={guessNumber === null}
                      >
                        추측!
                      </button>
                    </>
                  ) : (
                    <p className="dv-hint">상대방의 뒤집어진 타일을 클릭하세요</p>
                  )}
                </div>
              )}

              {gameState.phase === 'continue_or_stop' && (
                <div className="dv-continue-actions">
                  <p>정답! 계속 추측하시겠습니까?</p>
                  <button onClick={handleContinue} className="btn-primary">계속 추측</button>
                  <button onClick={handleStop} className="btn-secondary">멈추기 (타일 비공개 배치)</button>
                </div>
              )}
            </div>
          )}

          {/* Game over */}
          {gameState.phase === 'game_over' && (
            <div className="modal-overlay">
              <div className="modal score-modal">
                <h2>게임 종료!</h2>
                <div className="dv-result-list">
                  {gameState.players.map((p) => (
                    <div key={p.id} className={`dv-result-item ${p.id === gameState.winnerId ? 'winner' : ''}`}>
                      <span>{p.nickname}</span>
                      <span>{p.id === gameState.winnerId ? '승리!' : '탈락'}</span>
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
