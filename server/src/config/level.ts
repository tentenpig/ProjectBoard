// Level thresholds: total EXP needed to reach each level
// Level 1 = 0 EXP, Level 2 = 100 EXP, Level 3 = 300 EXP, ...
// Formula: each level requires (level * 100) more EXP than the previous

const MAX_LEVEL = 99;

function getExpForLevel(level: number): number {
  // Total EXP to reach this level
  // sum of 100 + 200 + 300 + ... + (level-1)*100 = 50 * level * (level - 1)
  return 50 * level * (level - 1);
}

export function calculateLevel(exp: number): { level: number; currentExp: number; nextLevelExp: number } {
  let level = 1;
  while (level < MAX_LEVEL) {
    const needed = getExpForLevel(level + 1);
    if (exp < needed) break;
    level++;
  }

  const currentLevelExp = getExpForLevel(level);
  const nextLevelExp = level < MAX_LEVEL ? getExpForLevel(level + 1) : currentLevelExp;

  return {
    level,
    currentExp: exp - currentLevelExp,
    nextLevelExp: nextLevelExp - currentLevelExp,
  };
}

// EXP rewards (placeholder values - to be balanced later)
export const EXP_REWARDS = {
  'six-nimmt': {
    win: 50,
    participate: 10,
    perRound: 5,
  },
  'davinci-code': {
    win: 50,
    participate: 10,
    perCorrectGuess: 3,
  },
};
