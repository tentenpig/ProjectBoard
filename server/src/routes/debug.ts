import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/database';
import { RowDataPacket } from 'mysql2';
import fishData from '../config/fish.json';
import fishSizeData from '../config/fishSize.json';
import { forceStartEvent, forceEndEvent, getAllEvents } from '../config/fishEvent';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';

const allFish = fishData.fish as any[];
const sizeMap = fishSizeData as Record<string, [number, number]>;

function authUser(req: Request): { id: number; nickname: string } | null {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET) as any; } catch { return null; }
}

// Admin guard: applied to ALL routes in this router
async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT is_admin FROM users WHERE id = ?', [user.id]);
    if (rows.length === 0 || !rows[0].is_admin) {
      return res.status(403).json({ error: 'Forbidden: admin only' });
    }
    (req as any).authUser = user;
    next();
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

router.use(requireAdmin);

// Add fish to inventory
router.post('/add-fish', async (req: Request, res: Response) => {
  const user = (req as any).authUser as { id: number; nickname: string };
  const { fishKey, count = 1 } = req.body;
  const fish = allFish.find((f: any) => f.key === fishKey);
  if (!fish) return res.status(400).json({ error: 'Unknown fish', available: allFish.map((f: any) => f.key) });

  try {
    const size = sizeMap[fishKey] || [10, 50];
    for (let i = 0; i < Math.min(count, 100); i++) {
      const sizeCm = Math.round((size[0] + Math.random() * (size[1] - size[0])) * 10) / 10;
      await pool.query('INSERT INTO fish_inventory (user_id, fish_key, size_cm) VALUES (?, ?, ?)', [user.id, fishKey, sizeCm]);
    }
    res.json({ success: true, added: Math.min(count, 100), fish: fish.name });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Set gold
router.post('/set-gold', async (req: Request, res: Response) => {
  const user = (req as any).authUser as { id: number };
  const { amount } = req.body;
  await pool.query('UPDATE users SET gold = ? WHERE id = ?', [amount, user.id]);
  res.json({ success: true, gold: amount });
});

// Set exp
router.post('/set-exp', async (req: Request, res: Response) => {
  const user = (req as any).authUser as { id: number };
  const { amount } = req.body;
  await pool.query('UPDATE users SET exp = ? WHERE id = ?', [amount, user.id]);
  res.json({ success: true, exp: amount });
});

// Force start event
router.post('/start-event', (req: Request, res: Response) => {
  const { location, durationMin = 60 } = req.body;
  if (!['river', 'lake', 'sea'].includes(location)) return res.status(400).json({ error: 'Invalid location' });
  const result = forceStartEvent(location, durationMin * 60 * 1000);
  res.json({ success: true, event: result });
});

// Force end event
router.post('/end-event', (_req: Request, res: Response) => {
  forceEndEvent();
  res.json({ success: true });
});

// Get current events
router.get('/events', (_req: Request, res: Response) => {
  res.json(getAllEvents());
});

// List all fish keys
router.get('/fish-list', (_req: Request, res: Response) => {
  res.json(allFish.map((f: any) => ({ key: f.key, name: f.name, grade: f.grade, event: f.event || false, location: f.location })));
});

export default router;
