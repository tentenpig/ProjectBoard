export const RANK_NAMES: Record<number, string> = {
  1: '달무티', 2: '대주교', 3: '원수', 4: '남작부인',
  5: '수녀원장', 6: '기사', 7: '재봉사', 8: '석공',
  9: '요리사', 10: '양치기', 11: '석수', 12: '농부', 13: '광대',
};

export interface DalmutiCard {
  rank: number; // 1-12, 13=jester
}

export interface DalmutiPlayer {
  id: number;
  nickname: string;
  hand: DalmutiCard[];
  passed: boolean;
  finished: boolean;
  finishOrder: number; // 0 = not finished
}

export interface PlayedSet {
  playerId: number;
  cards: DalmutiCard[];
  effectiveRank: number;
  count: number;
}

export interface DalmutiState {
  players: DalmutiPlayer[];
  phase: 'playing' | 'round_end' | 'tax' | 'game_over';
  currentPlayerId: number;
  turnOrder: number[];
  turnIndex: number;
  currentTrick: PlayedSet | null; // last played set on table
  finishCount: number;
  roundResults: { playerId: number; nickname: string; position: number }[][];
  round: number;
  maxRounds: number;
}

function createDeck(): DalmutiCard[] {
  const cards: DalmutiCard[] = [];
  for (let rank = 1; rank <= 12; rank++) {
    for (let i = 0; i < rank; i++) {
      cards.push({ rank });
    }
  }
  // 2 jesters (rank 13)
  cards.push({ rank: 13 });
  cards.push({ rank: 13 });
  return cards;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sortHand(hand: DalmutiCard[]): DalmutiCard[] {
  return [...hand].sort((a, b) => a.rank - b.rank);
}

function dealCards(playerCount: number): DalmutiCard[][] {
  const deck = shuffle(createDeck());
  const hands: DalmutiCard[][] = Array.from({ length: playerCount }, () => []);
  for (let i = 0; i < deck.length; i++) {
    hands[i % playerCount].push(deck[i]);
  }
  return hands.map(sortHand);
}

export function initGame(
  playerInfos: { id: number; nickname: string }[],
  maxRounds: number = 5,
): DalmutiState {
  const hands = dealCards(playerInfos.length);

  const players: DalmutiPlayer[] = playerInfos.map((info, i) => ({
    id: info.id,
    nickname: info.nickname,
    hand: hands[i],
    passed: false,
    finished: false,
    finishOrder: 0,
  }));

  const turnOrder = players.map((p) => p.id);

  // First player: whoever has the 1 (Dalmuti card) starts, or lowest card
  let startIdx = 0;
  for (let i = 0; i < players.length; i++) {
    if (players[i].hand.some((c) => c.rank === 1)) {
      startIdx = i;
      break;
    }
  }

  return {
    players,
    phase: 'playing',
    currentPlayerId: turnOrder[startIdx],
    turnOrder,
    turnIndex: startIdx,
    currentTrick: null,
    finishCount: 0,
    roundResults: [],
    round: 1,
    maxRounds,
  };
}

export function playCards(
  state: DalmutiState,
  playerId: number,
  cardRanks: number[], // ranks of cards to play (e.g. [3, 3, 3] or [5, 5, 13] with jester)
): boolean {
  if (state.phase !== 'playing' || state.currentPlayerId !== playerId) return false;

  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.finished || player.passed) return false;

  if (cardRanks.length === 0) return false;

  // Validate player has these cards
  const handCopy = [...player.hand];
  for (const rank of cardRanks) {
    const idx = handCopy.findIndex((c) => c.rank === rank);
    if (idx === -1) return false;
    handCopy.splice(idx, 1);
  }

  // Determine effective rank (non-jester rank, or 13 if all jesters)
  const nonJesters = cardRanks.filter((r) => r !== 13);
  const jesters = cardRanks.filter((r) => r === 13);

  let effectiveRank: number;
  if (nonJesters.length === 0) {
    // All jesters - played as rank 13
    effectiveRank = 13;
  } else {
    // All non-jesters must be same rank
    if (!nonJesters.every((r) => r === nonJesters[0])) return false;
    effectiveRank = nonJesters[0];
  }

  const count = cardRanks.length;

  // Check against current trick
  if (state.currentTrick) {
    // Must play same count
    if (count !== state.currentTrick.count) return false;
    // Must play lower rank (lower = stronger)
    if (effectiveRank >= state.currentTrick.effectiveRank) return false;
  }

  // Remove cards from hand
  for (const rank of cardRanks) {
    const idx = player.hand.findIndex((c) => c.rank === rank);
    player.hand.splice(idx, 1);
  }

  state.currentTrick = { playerId, cards: cardRanks.map((r) => ({ rank: r })), effectiveRank, count };

  // Reset passes (new play resets all passes)
  for (const p of state.players) {
    if (!p.finished) p.passed = false;
  }

  // Check if player finished
  if (player.hand.length === 0) {
    player.finished = true;
    state.finishCount++;
    player.finishOrder = state.finishCount;
  }

  // Check if round over (all but one finished)
  const activePlayers = state.players.filter((p) => !p.finished);
  if (activePlayers.length <= 1) {
    if (activePlayers.length === 1) {
      state.finishCount++;
      activePlayers[0].finishOrder = state.finishCount;
      activePlayers[0].finished = true;
    }
    endRound(state);
    return true;
  }

  advanceTurn(state);
  return true;
}

export function pass(state: DalmutiState, playerId: number): boolean {
  if (state.phase !== 'playing' || state.currentPlayerId !== playerId) return false;

  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.finished || player.passed) return false;

  // Can't pass if you're leading (no current trick)
  if (!state.currentTrick) return false;

  player.passed = true;

  // Check if all active non-finished players have passed
  const activePlayers = state.players.filter((p) => !p.finished && !p.passed);

  if (activePlayers.length === 0) {
    // Everyone passed - trick winner leads new trick
    state.currentTrick = null;
    for (const p of state.players) p.passed = false;

    // Find the last player who played (trick winner)
    // They should lead next - but they might be finished
    const lastPlayer = state.players.find((p) => p.id === state.currentTrick?.playerId);
    if (lastPlayer && !lastPlayer.finished) {
      state.turnIndex = state.turnOrder.indexOf(lastPlayer.id);
      state.currentPlayerId = lastPlayer.id;
    } else {
      advanceTurn(state);
    }
    return true;
  }

  // Actually, check: if only the trick owner is left not passed
  const trickOwner = state.players.find((p) => p.id === state.currentTrick?.playerId);
  const nonPassedNonFinished = state.players.filter((p) => !p.finished && !p.passed);
  if (nonPassedNonFinished.length === 1 && nonPassedNonFinished[0].id === trickOwner?.id) {
    // Everyone else passed, trick owner leads
    state.currentTrick = null;
    for (const p of state.players) p.passed = false;
    state.turnIndex = state.turnOrder.indexOf(trickOwner.id);
    state.currentPlayerId = trickOwner.id;
    return true;
  }

  advanceTurn(state);
  return true;
}

function advanceTurn(state: DalmutiState) {
  const max = state.turnOrder.length;
  for (let i = 1; i <= max; i++) {
    const nextIdx = (state.turnIndex + i) % max;
    const nextId = state.turnOrder[nextIdx];
    const nextPlayer = state.players.find((p) => p.id === nextId)!;
    if (!nextPlayer.finished && !nextPlayer.passed) {
      state.turnIndex = nextIdx;
      state.currentPlayerId = nextId;
      return;
    }
  }
}

function endRound(state: DalmutiState) {
  const results = state.players
    .map((p) => ({ playerId: p.id, nickname: p.nickname, position: p.finishOrder }))
    .sort((a, b) => a.position - b.position);

  state.roundResults.push(results);

  if (state.round >= state.maxRounds) {
    state.phase = 'game_over';
  } else {
    state.phase = 'round_end';
  }
}

export function startNextRound(state: DalmutiState): boolean {
  if (state.phase !== 'round_end') return false;

  state.round++;
  const hands = dealCards(state.players.length);

  // Reorder players by last round's finish order
  const lastResults = state.roundResults[state.roundResults.length - 1];
  const orderedIds = lastResults.map((r) => r.playerId);

  state.players.forEach((p) => {
    const orderIdx = orderedIds.indexOf(p.id);
    p.hand = hands[orderIdx];
    p.passed = false;
    p.finished = false;
    p.finishOrder = 0;
  });

  // Winner of last round starts
  state.turnOrder = orderedIds;
  state.turnIndex = 0;
  state.currentPlayerId = orderedIds[0];
  state.currentTrick = null;
  state.finishCount = 0;
  state.phase = 'playing';

  return true;
}

export function getPlayerView(state: DalmutiState, playerId: number) {
  return {
    players: state.players.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      cardCount: p.hand.length,
      passed: p.passed,
      finished: p.finished,
      finishOrder: p.finishOrder,
      hand: p.id === playerId ? p.hand : undefined,
    })),
    phase: state.phase,
    currentPlayerId: state.currentPlayerId,
    currentTrick: state.currentTrick,
    round: state.round,
    maxRounds: state.maxRounds,
    roundResults: state.roundResults,
  };
}

export function getSpectatorView(state: DalmutiState) {
  return { ...getPlayerView(state, -1), spectating: true };
}
