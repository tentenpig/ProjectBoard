import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/database';
import { RowDataPacket } from 'mysql2';
import { calculateLevel } from '../config/level';
import { updateLeaderboard } from '../config/redis';
import fishData from '../config/fish.json';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';

interface FishDef {
  key: string; name: string; emoji: string; location: string;
  weight: number; minTime: number; maxTime: number; price: number; exp: number;
}

const allFish: FishDef[] = fishData.fish as FishDef[];

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
      'SELECT fish_key, COUNT(*) as count FROM fish_inventory WHERE user_id = ? AND sold = FALSE GROUP BY fish_key',
      [user.id]
    );

    const inventory = rows.map((r) => {
      const fish = allFish.find((f) => f.key === r.fish_key);
      return { ...fish, count: r.count };
    });

    res.json({ inventory });
  } catch (err) {
    console.error('Inventory error:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// Sell fish
router.post('/sell', async (req: Request, res: Response) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: '인증이 필요합니다.' });

  const { fishKey, count: sellCount } = req.body;
  if (!fishKey || !sellCount || sellCount < 1) {
    return res.status(400).json({ error: '잘못된 요청입니다.' });
  }

  const fish = allFish.find((f) => f.key === fishKey);
  if (!fish) return res.status(400).json({ error: '알 수 없는 물고기입니다.' });

  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM fish_inventory WHERE user_id = ? AND fish_key = ? AND sold = FALSE LIMIT ?',
      [user.id, fishKey, sellCount]
    );

    if (rows.length < sellCount) {
      return res.status(400).json({ error: '보유 수량이 부족합니다.' });
    }

    const ids = rows.map((r) => r.id);
    await pool.query('UPDATE fish_inventory SET sold = TRUE WHERE id IN (?)', [ids]);

    const totalExp = fish.exp * sellCount;
    await pool.query('UPDATE users SET exp = exp + ? WHERE id = ?', [totalExp, user.id]);

    const [userRows] = await pool.query<RowDataPacket[]>('SELECT exp, nickname FROM users WHERE id = ?', [user.id]);
    const newExp = userRows[0].exp;
    updateLeaderboard(user.id, userRows[0].nickname, newExp).catch(() => {});
    const levelInfo = calculateLevel(newExp);

    res.json({ soldCount: sellCount, totalExp, newExp, ...levelInfo });
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
      'SELECT DISTINCT fish_key FROM fish_inventory WHERE user_id = ?',
      [user.id]
    );
    const caughtKeys = new Set(rows.map((r) => r.fish_key));

    const encyclopedia = allFish.map((f) => ({
      key: f.key,
      name: caughtKeys.has(f.key) ? f.name : '???',
      emoji: caughtKeys.has(f.key) ? f.emoji : '❓',
      location: f.location,
      caught: caughtKeys.has(f.key),
      price: caughtKeys.has(f.key) ? f.price : null,
      exp: caughtKeys.has(f.key) ? f.exp : null,
    }));

    res.json({ encyclopedia, totalSpecies: allFish.length, caughtSpecies: caughtKeys.size });
  } catch (err) {
    console.error('Encyclopedia error:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// Fish data
router.get('/fish-data', (_req: Request, res: Response) => {
  res.json(fishData);
});

export default router;

// Export for socket usage
export { allFish, FishDef };
export function pickFish(location: string): FishDef {
  const locationFish = allFish.filter((f) => f.location === location);
  const totalWeight = locationFish.reduce((s, f) => s + f.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const fish of locationFish) {
    roll -= fish.weight;
    if (roll <= 0) return fish;
  }
  return locationFish[locationFish.length - 1];
}
