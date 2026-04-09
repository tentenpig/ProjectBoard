import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/database';
import { RowDataPacket } from 'mysql2';
import { calculateLevel } from '../config/level';
import { updateLeaderboard } from '../config/redis';
import fishData from '../config/fish.json';
import fishSizeData from '../config/fishSize.json';
import shopData from '../config/shop.json';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';

interface FishDef {
  key: string; name: string; emoji: string; location: string;
  weight: number; minTime: number; maxTime: number; price: number; exp: number;
  minSize: number; maxSize: number;
}

const sizeMap = fishSizeData as Record<string, [number, number]>;
const allFish: FishDef[] = (fishData.fish as any[]).map((f) => {
  const size = sizeMap[f.key] || [10, 50];
  return { ...f, minSize: size[0], maxSize: size[1] };
});

function authUser(req: Request): { id: number; nickname: string } | null {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET) as any; } catch { return null; }
}

// Get inventory
router.get('/inventory', async (req: Request, res: Response) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: '인증이 필요합니다.' });

  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, fish_key, caught_at, size_cm FROM fish_inventory WHERE user_id = ? AND sold = FALSE ORDER BY caught_at DESC',
      [user.id]
    );

    const inventory = rows.map((r) => {
      const fish = allFish.find((f) => f.key === r.fish_key);
      return { ...fish, inventoryId: r.id, caughtAt: r.caught_at, sizeCm: r.size_cm };
    });

    res.json({ inventory });
  } catch (err) {
    console.error('Inventory error:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// Sell fish by inventory IDs
router.post('/sell', async (req: Request, res: Response) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: '인증이 필요합니다.' });

  const { inventoryIds } = req.body;
  if (!inventoryIds || !Array.isArray(inventoryIds) || inventoryIds.length === 0) {
    return res.status(400).json({ error: '판매할 물고기를 선택해주세요.' });
  }

  try {
    // Verify ownership
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, fish_key FROM fish_inventory WHERE user_id = ? AND id IN (?) AND sold = FALSE',
      [user.id, inventoryIds]
    );

    if (rows.length === 0) return res.status(400).json({ error: '판매할 물고기가 없습니다.' });

    const ids = rows.map((r) => r.id);
    await pool.query('UPDATE fish_inventory SET sold = TRUE WHERE id IN (?)', [ids]);

    // Calculate totals from sold items
    let totalExp = 0, totalGold = 0;
    for (const row of rows) {
      const fish = allFish.find((f) => f.key === row.fish_key);
      if (fish) { totalExp += fish.exp; totalGold += fish.price; }
    }

    await pool.query('UPDATE users SET exp = exp + ?, gold = gold + ? WHERE id = ?', [totalExp, totalGold, user.id]);

    const [userRows] = await pool.query<RowDataPacket[]>('SELECT exp, gold, nickname FROM users WHERE id = ?', [user.id]);
    const newExp = userRows[0].exp;
    const newGold = userRows[0].gold;
    updateLeaderboard(user.id, userRows[0].nickname, newExp).catch(() => {});
    const levelInfo = calculateLevel(newExp);

    res.json({ soldCount: ids.length, totalExp, totalGold, newExp, newGold, ...levelInfo });
  } catch (err) {
    console.error('Sell error:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// Encyclopedia: all species the user has ever caught
router.get('/encyclopedia', async (req: Request, res: Response) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: '인증이 필요합니다.' });

  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT fish_key, MIN(size_cm) as min_size, MAX(size_cm) as max_size, COUNT(*) as cnt FROM fish_inventory WHERE user_id = ? GROUP BY fish_key',
      [user.id]
    );
    const caughtMap = new Map(rows.map((r) => [r.fish_key, { minSize: r.min_size, maxSize: r.max_size, count: r.cnt }]));
    const caughtKeys = new Set(rows.map((r) => r.fish_key));

    const encyclopedia = allFish.map((f) => ({
      key: f.key,
      name: caughtKeys.has(f.key) ? f.name : '???',
      emoji: caughtKeys.has(f.key) ? f.emoji : '❓',
      location: f.location,
      caught: caughtKeys.has(f.key),
      price: caughtKeys.has(f.key) ? f.price : null,
      exp: caughtKeys.has(f.key) ? f.exp : null,
      description: caughtKeys.has(f.key) ? (f as any).description : null,
      recordMinSize: caughtMap.get(f.key)?.minSize || null,
      recordMaxSize: caughtMap.get(f.key)?.maxSize || null,
      caughtCount: caughtMap.get(f.key)?.count || 0,
    }));

    res.json({ encyclopedia, totalSpecies: allFish.length, caughtSpecies: caughtKeys.size });
  } catch (err) {
    console.error('Encyclopedia error:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// Fish data
router.get('/fish-data', (_req: Request, res: Response) => {
  res.json({ ...fishData, fish: allFish });
});

export default router;

// Export for socket usage
export { allFish, FishDef };
export function pickFish(location: string, rarityBonus: number = 0): FishDef {
  const locationFish = allFish.filter((f) => f.location === location);

  // Apply rarity bonus: boost weight of rarer fish (lower base weight)
  const adjustedFish = locationFish.map((f) => {
    if (rarityBonus <= 0 || f.weight >= 20) return { fish: f, weight: f.weight };
    // Rare fish get weight multiplied by bonus
    return { fish: f, weight: f.weight * (1 + rarityBonus) };
  });

  const totalWeight = adjustedFish.reduce((s, f) => s + f.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const { fish, weight } of adjustedFish) {
    roll -= weight;
    if (roll <= 0) return fish;
  }
  return locationFish[locationFish.length - 1];
}

export function getRodBonus(rodKey: string): number {
  const rod = (shopData.rods as any[]).find((r) => r.key === rodKey);
  return rod?.rarityBonus || 0;
}
