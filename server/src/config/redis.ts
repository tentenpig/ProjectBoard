import { createClient } from 'redis';

const redis = createClient({
  url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`,
});

redis.on('error', (err) => console.error('Redis error:', err));
redis.on('connect', () => console.log('Redis connected'));

redis.connect();

const LEADERBOARD_KEY = 'leaderboard';

export async function updateLeaderboard(userId: number, nickname: string, exp: number) {
  // Store exp as score, member as "userId:nickname"
  await redis.zAdd(LEADERBOARD_KEY, { score: exp, value: `${userId}:${nickname}` });
}

export async function getTopRanking(count: number = 50): Promise<{ rank: number; userId: number; nickname: string; exp: number }[]> {
  const results = await redis.zRangeWithScores(LEADERBOARD_KEY, 0, count - 1, { REV: true });
  return results.map((r, i) => {
    const [userId, ...nickParts] = r.value.split(':');
    return {
      rank: i + 1,
      userId: parseInt(userId),
      nickname: nickParts.join(':'),
      exp: r.score,
    };
  });
}

export async function getUserRank(userId: number, nickname: string): Promise<number | null> {
  const rank = await redis.zRevRank(LEADERBOARD_KEY, `${userId}:${nickname}`);
  return rank !== null ? rank + 1 : null;
}

export async function syncLeaderboardFromDB(pool: any) {
  const [rows] = await pool.query('SELECT id, nickname, exp FROM users');
  for (const row of rows as any[]) {
    await redis.zAdd(LEADERBOARD_KEY, { score: row.exp, value: `${row.id}:${row.nickname}` });
  }
  console.log(`Leaderboard synced: ${(rows as any[]).length} users`);
}

export default redis;
