import { Router, Request, Response } from 'express';
import { getTopRanking, getUserRank } from '../config/redis';
import { calculateLevel } from '../config/level';

const router = Router();

router.get('/top', async (req: Request, res: Response) => {
  const count = Math.min(parseInt(req.query.count as string) || 50, 100);
  try {
    const ranking = await getTopRanking(count);
    const result = ranking.map((r) => ({
      ...r,
      ...calculateLevel(r.exp),
    }));
    res.json(result);
  } catch (err) {
    console.error('Ranking error:', err);
    res.status(500).json({ error: '랭킹을 불러올 수 없습니다.' });
  }
});

router.get('/me/:userId/:nickname', async (req: Request, res: Response) => {
  const userId = parseInt(req.params.userId);
  const nickname = req.params.nickname;
  try {
    const rank = await getUserRank(userId, nickname);
    res.json({ rank });
  } catch (err) {
    console.error('Rank lookup error:', err);
    res.status(500).json({ error: '순위를 불러올 수 없습니다.' });
  }
});

export default router;
