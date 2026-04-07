import balance from './balance.json';

const { maxLevel, expMultiplier } = balance.level;

function getExpForLevel(level: number): number {
  return expMultiplier * level * (level - 1);
}

export function calculateLevel(exp: number): { level: number; currentExp: number; nextLevelExp: number } {
  let level = 1;
  while (level < maxLevel) {
    const needed = getExpForLevel(level + 1);
    if (exp < needed) break;
    level++;
  }

  const currentLevelExp = getExpForLevel(level);
  const nextLevelExp = level < maxLevel ? getExpForLevel(level + 1) : currentLevelExp;

  return {
    level,
    currentExp: exp - currentLevelExp,
    nextLevelExp: nextLevelExp - currentLevelExp,
  };
}

export function calcReward(gameType: 'six-nimmt' | 'davinci-code', rewardKey: string, humanCount: number): number {
  const gameConfig = balance.exp[gameType] as Record<string, { base: number; perPlayer: number }>;
  const reward = gameConfig[rewardKey];
  if (!reward) return 0;
  if (humanCount < balance.exp.minHumanPlayers) return 0;
  return reward.base + reward.perPlayer * humanCount;
}
