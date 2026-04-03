import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { onlineNicknames } from '../socket/index';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';

let nextId = 1;

router.post('/enter', (req: Request, res: Response) => {
  const { nickname } = req.body;

  if (!nickname || typeof nickname !== 'string' || nickname.trim().length === 0) {
    return res.status(400).json({ error: '닉네임을 입력해주세요.' });
  }

  if (nickname.trim().length > 20) {
    return res.status(400).json({ error: '닉네임은 20자 이하로 입력해주세요.' });
  }

  if (onlineNicknames.has(nickname.trim())) {
    return res.status(409).json({ error: '이미 사용 중인 닉네임입니다.' });
  }

  const id = nextId++;
  const user = { id, nickname: nickname.trim() };

  const token = jwt.sign(user, JWT_SECRET, { expiresIn: '24h' });

  res.json({ token, user });
});

export default router;
