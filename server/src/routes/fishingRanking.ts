import { Router, Request, Response } from 'express';
import pool from '../config/database';
import { RowDataPacket } from 'mysql2';
import fishData from '../config/fish.json';

const router = Router();

interface FishDef {
  key: string; weight: number;
}

const allFish: FishDef[] = fishData.fish as FishDef[];

// Rarity score: lower weight = more rare = higher score
function rarityScore(fishKey: string): number {
  const fish = allFish.find((f) => f.key === fishKey);
  if (!fish) return 0;
  const weight = fish.weight;
  if (weight <= 1) return 100;   // legendary
  if (weight <= 5) return 30;    // rare
  if (weight <= 15) return 10;   // uncommon
  return 1;                       // common
}

router.get('/top', async (_req: Request, res: Response) => {
  try {
    // Get all caught fish grouped by user
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT fi.user_id, u.nickname, fi.fish_key, COUNT(*) as cnt
       FROM fish_inventory fi
       JOIN users u ON fi.user_id = u.id
       GROUP BY fi.user_id, u.nickname, fi.fish_key`
    );

    // Aggregate per user
    const userMap = new Map<number, { nickname: string; totalCount: number; rarityTotal: number }>();

    for (const row of rows) {
      if (!userMap.has(row.user_id)) {
        userMap.set(row.user_id, { nickname: row.nickname, totalCount: 0, rarityTotal: 0 });
      }
      const entry = userMap.get(row.user_id)!;
      entry.totalCount += row.cnt;
      entry.rarityTotal += rarityScore(row.fish_key) * row.cnt;
    }

    // Sort: total count desc, then rarity total desc
    const sorted = Array.from(userMap.entries())
      .map(([userId, data]) => ({ userId, ...data }))
      .sort((a, b) => b.totalCount - a.totalCount || b.rarityTotal - a.rarityTotal);

    // Assign ranks (same rank for ties)
    let rank = 1;
    const ranking = sorted.map((entry, i) => {
      if (i > 0) {
        const prev = sorted[i - 1];
        if (entry.totalCount !== prev.totalCount || entry.rarityTotal !== prev.rarityTotal) {
          rank = i + 1;
        }
      }
      return { rank, userId: entry.userId, nickname: entry.nickname, totalCount: entry.totalCount, rarityTotal: entry.rarityTotal };
    });

    res.json(ranking.slice(0, 50));
  } catch (err) {
    console.error('Fishing ranking error:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

export default router;
