import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/database';
import { RowDataPacket } from 'mysql2';
import { calculateLevel } from '../config/level';
import shopData from '../config/shop.json';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';

function authUser(req: Request): { id: number; nickname: string } | null {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET) as any; } catch { return null; }
}

function getOwnedRods(ownedStr: string | null): string[] {
  if (!ownedStr) return ['basic_rod'];
  const rods = ownedStr.split(',').filter(Boolean);
  if (!rods.includes('basic_rod')) rods.unshift('basic_rod');
  return [...new Set(rods)];
}

// Get shop items + user's gold and equipment
router.get('/info', async (req: Request, res: Response) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: '인증이 필요합니다.' });

  try {
    const [userRows] = await pool.query<RowDataPacket[]>('SELECT gold, exp FROM users WHERE id = ?', [user.id]);
    const [equipRows] = await pool.query<RowDataPacket[]>('SELECT rod_key, owned_rods FROM user_equipment WHERE user_id = ?', [user.id]);

    const gold = userRows[0]?.gold || 0;
    const level = calculateLevel(userRows[0]?.exp || 0).level;
    const currentRod = equipRows[0]?.rod_key || 'basic_rod';
    const ownedRods = getOwnedRods(equipRows[0]?.owned_rods);

    res.json({ gold, level, currentRod, ownedRods, rods: shopData.rods });
  } catch (err) {
    console.error('Shop info error:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// Buy rod
router.post('/buy-rod', async (req: Request, res: Response) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: '인증이 필요합니다.' });

  const { rodKey } = req.body;
  const rod = shopData.rods.find((r) => r.key === rodKey);
  if (!rod) return res.status(400).json({ error: '알 수 없는 아이템입니다.' });

  try {
    const [userRows] = await pool.query<RowDataPacket[]>('SELECT gold, exp FROM users WHERE id = ?', [user.id]);
    const gold = userRows[0]?.gold || 0;
    const level = calculateLevel(userRows[0]?.exp || 0).level;

    if (level < rod.level) return res.status(400).json({ error: `레벨 ${rod.level} 이상이어야 구매할 수 있습니다.` });
    if (gold < rod.price) return res.status(400).json({ error: '골드가 부족합니다.' });

    // Check if already owned
    const [equipRows] = await pool.query<RowDataPacket[]>('SELECT rod_key, owned_rods FROM user_equipment WHERE user_id = ?', [user.id]);
    const ownedRods = getOwnedRods(equipRows[0]?.owned_rods);

    if (ownedRods.includes(rodKey)) {
      return res.status(400).json({ error: '이미 보유한 낚시대입니다.' });
    }

    ownedRods.push(rodKey);
    const ownedStr = ownedRods.join(',');

    await pool.query('UPDATE users SET gold = gold - ? WHERE id = ?', [rod.price, user.id]);
    await pool.query(
      'INSERT INTO user_equipment (user_id, rod_key, owned_rods) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE owned_rods = ?',
      [user.id, equipRows[0]?.rod_key || 'basic_rod', ownedStr, ownedStr]
    );

    const newGold = gold - rod.price;
    res.json({ success: true, newGold, rodKey, ownedRods });
  } catch (err) {
    console.error('Buy rod error:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// Equip rod
router.post('/equip-rod', async (req: Request, res: Response) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: '인증이 필요합니다.' });

  const { rodKey } = req.body;
  if (!shopData.rods.find((r) => r.key === rodKey)) {
    return res.status(400).json({ error: '알 수 없는 아이템입니다.' });
  }

  try {
    const [equipRows] = await pool.query<RowDataPacket[]>('SELECT owned_rods FROM user_equipment WHERE user_id = ?', [user.id]);
    const ownedRods = getOwnedRods(equipRows[0]?.owned_rods);

    if (!ownedRods.includes(rodKey)) {
      return res.status(400).json({ error: '보유하지 않은 낚시대입니다.' });
    }

    await pool.query(
      'INSERT INTO user_equipment (user_id, rod_key, owned_rods) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE rod_key = ?',
      [user.id, rodKey, ownedRods.join(','), rodKey]
    );

    res.json({ success: true, currentRod: rodKey });
  } catch (err) {
    console.error('Equip rod error:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

export default router;
