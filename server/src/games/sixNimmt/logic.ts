export interface Card {
  number: number;
  bullHeads: number;
}

export interface Player {
  id: number;
  nickname: string;
  hand: Card[];
  penalty: Card[];
  selectedCard: Card | null;
}

export interface GameState {
  rows: Card[][];
  players: Player[];
  phase: 'selecting' | 'resolving' | 'choosing_row' | 'round_end' | 'game_over';
  currentResolveIndex: number;
  sortedPlays: { playerId: number; card: Card }[];
  choosingPlayerId: number | null;
  round: number;
  totalScores: Map<number, number>;
}

export function getBullHeads(cardNumber: number): number {
  if (cardNumber === 55) return 7;
  if (cardNumber % 11 === 0) return 5;
  if (cardNumber % 10 === 0) return 3;
  if (cardNumber % 5 === 0) return 2;
  return 1;
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (let i = 1; i <= 104; i++) {
    deck.push({ number: i, bullHeads: getBullHeads(i) });
  }
  return deck;
}

export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function calculatePenalty(cards: Card[]): number {
  return cards.reduce((sum, card) => sum + card.bullHeads, 0);
}

export function initRound(playerInfos: { id: number; nickname: string }[]): GameState {
  const deck = shuffleDeck(createDeck());
  let cardIndex = 0;

  const rows: Card[][] = [];
  for (let i = 0; i < 4; i++) {
    rows.push([deck[cardIndex++]]);
  }

  const players: Player[] = playerInfos.map((info) => {
    const hand: Card[] = [];
    for (let i = 0; i < 10; i++) {
      hand.push(deck[cardIndex++]);
    }
    hand.sort((a, b) => a.number - b.number);
    return {
      id: info.id,
      nickname: info.nickname,
      hand,
      penalty: [],
      selectedCard: null,
    };
  });

  return {
    rows,
    players,
    phase: 'selecting',
    currentResolveIndex: 0,
    sortedPlays: [],
    choosingPlayerId: null,
    round: 1,
    totalScores: new Map(playerInfos.map((p) => [p.id, 0])),
  };
}

export function selectCard(state: GameState, playerId: number, cardNumber: number): boolean {
  if (state.phase !== 'selecting') return false;

  const player = state.players.find((p) => p.id === playerId);
  if (!player) return false;

  const cardIndex = player.hand.findIndex((c) => c.number === cardNumber);
  if (cardIndex === -1) return false;

  player.selectedCard = player.hand[cardIndex];
  return true;
}

export function allPlayersSelected(state: GameState): boolean {
  return state.players.every((p) => p.selectedCard !== null);
}

export function beginResolve(state: GameState): void {
  state.sortedPlays = state.players
    .map((p) => ({ playerId: p.id, card: p.selectedCard! }))
    .sort((a, b) => a.card.number - b.card.number);

  // Remove selected cards from hands
  for (const player of state.players) {
    player.hand = player.hand.filter((c) => c.number !== player.selectedCard!.number);
    player.selectedCard = null;
  }

  state.currentResolveIndex = 0;
  state.phase = 'resolving';
}

export interface PlaceResult {
  type: 'placed' | 'took_row' | 'must_choose';
  playerId: number;
  card: Card;
  rowIndex?: number;
  takenCards?: Card[];
}

export function resolveNextCard(state: GameState): PlaceResult | null {
  if (state.currentResolveIndex >= state.sortedPlays.length) return null;

  const play = state.sortedPlays[state.currentResolveIndex];
  const card = play.card;

  // Find eligible row: row whose last card is highest but still less than played card
  let bestRowIndex = -1;
  let bestLastValue = -1;

  for (let i = 0; i < state.rows.length; i++) {
    const lastCard = state.rows[i][state.rows[i].length - 1];
    if (lastCard.number < card.number && lastCard.number > bestLastValue) {
      bestLastValue = lastCard.number;
      bestRowIndex = i;
    }
  }

  if (bestRowIndex === -1) {
    // Card is lower than all rows - player must choose
    state.phase = 'choosing_row';
    state.choosingPlayerId = play.playerId;
    return { type: 'must_choose', playerId: play.playerId, card };
  }

  if (state.rows[bestRowIndex].length >= 5) {
    // 6th card - player takes the row
    const takenCards = [...state.rows[bestRowIndex]];
    const player = state.players.find((p) => p.id === play.playerId)!;
    player.penalty.push(...takenCards);
    state.rows[bestRowIndex] = [card];
    state.currentResolveIndex++;
    return { type: 'took_row', playerId: play.playerId, card, rowIndex: bestRowIndex, takenCards };
  }

  // Normal placement
  state.rows[bestRowIndex].push(card);
  state.currentResolveIndex++;
  return { type: 'placed', playerId: play.playerId, card, rowIndex: bestRowIndex };
}

export function chooseRow(state: GameState, playerId: number, rowIndex: number): PlaceResult | null {
  if (state.phase !== 'choosing_row' || state.choosingPlayerId !== playerId) return null;
  if (rowIndex < 0 || rowIndex >= state.rows.length) return null;

  const play = state.sortedPlays[state.currentResolveIndex];
  const takenCards = [...state.rows[rowIndex]];
  const player = state.players.find((p) => p.id === playerId)!;
  player.penalty.push(...takenCards);
  state.rows[rowIndex] = [play.card];

  state.currentResolveIndex++;
  state.choosingPlayerId = null;
  state.phase = 'resolving';

  return { type: 'took_row', playerId, card: play.card, rowIndex, takenCards };
}

export function isTurnDone(state: GameState): boolean {
  return state.currentResolveIndex >= state.sortedPlays.length && state.phase === 'resolving';
}

export function isRoundOver(state: GameState): boolean {
  return state.players.every((p) => p.hand.length === 0);
}

export function endRound(state: GameState): { scores: { playerId: number; nickname: string; roundPenalty: number; totalScore: number }[]; gameOver: boolean } {
  const scores = state.players.map((p) => {
    const roundPenalty = calculatePenalty(p.penalty);
    const prev = state.totalScores.get(p.id) || 0;
    const totalScore = prev + roundPenalty;
    state.totalScores.set(p.id, totalScore);
    return { playerId: p.id, nickname: p.nickname, roundPenalty, totalScore };
  });

  const gameOver = scores.some((s) => s.totalScore >= 66);

  if (gameOver) {
    state.phase = 'game_over';
  } else {
    state.phase = 'round_end';
  }

  return { scores, gameOver };
}

export function startNewRound(state: GameState): void {
  const playerInfos = state.players.map((p) => ({ id: p.id, nickname: p.nickname }));
  const newState = initRound(playerInfos);

  // Preserve total scores
  newState.totalScores = state.totalScores;
  newState.round = state.round + 1;

  Object.assign(state, newState);
}

export function getPlayerView(state: GameState, playerId: number) {
  const player = state.players.find((p) => p.id === playerId);
  return {
    rows: state.rows,
    hand: player?.hand || [],
    myPenalty: player ? calculatePenalty(player.penalty) : 0,
    phase: state.phase,
    round: state.round,
    choosingPlayerId: state.choosingPlayerId,
    players: state.players.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      cardCount: p.hand.length,
      hasSelected: p.selectedCard !== null,
      penalty: calculatePenalty(p.penalty),
    })),
    totalScores: Object.fromEntries(state.totalScores),
    currentResolveIndex: state.currentResolveIndex,
    sortedPlays: state.phase === 'resolving' || state.phase === 'choosing_row'
      ? state.sortedPlays.map((sp, i) => ({
          playerId: sp.playerId,
          card: i < state.currentResolveIndex ? sp.card : (state.phase === 'choosing_row' && i === state.currentResolveIndex ? sp.card : null),
          nickname: state.players.find((p) => p.id === sp.playerId)?.nickname,
        }))
      : undefined,
  };
}
