import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import pool from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { onlineNicknames } from '../socket/index';
import { calculateLevel } from '../config/level';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';

router.post('/enter', async (req: Request, res: Response) => {
  const { nickname, password } = req.body;

  if (!nickname || !password) {
    return res.status(400).json({ error: '닉네임과 비밀번호를 입력해주세요.' });
  }

  const trimmed = nickname.trim();
  if (trimmed.length > 20) {
    return res.status(400).json({ error: '닉네임은 20자 이하로 입력해주세요.' });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: '비밀번호는 4자 이상이어야 합니다.' });
  }

  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, nickname, password_hash, exp FROM users WHERE nickname = ?',
      [trimmed]
    );

    if (rows.length > 0) {
      // Existing account: verify password
      const user = rows[0];
      if (!(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
      }

      if (onlineNicknames.has(user.nickname)) {
        return res.status(409).json({ error: '이미 접속 중인 계정입니다.' });
      }

      const levelInfo = calculateLevel(user.exp);
      const token = jwt.sign({ id: user.id, nickname: user.nickname }, JWT_SECRET, { expiresIn: '24h' });
      return res.json({ token, user: { id: user.id, nickname: user.nickname, exp: user.exp, ...levelInfo }, created: false });
    }

    // New account: create and login
    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.query<ResultSetHeader>(
      'INSERT INTO users (nickname, password_hash) VALUES (?, ?)',
      [trimmed, passwordHash]
    );

    const newUser = { id: result.insertId, nickname: trimmed };
    const levelInfo = calculateLevel(0);
    const token = jwt.sign(newUser, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { ...newUser, exp: 0, ...levelInfo }, created: true });
  } catch (err) {
    console.error('Enter error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

export default router;
