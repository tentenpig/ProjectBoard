import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import pool from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { onlineNicknames } from '../socket/index';
import { calculateLevel } from '../config/level';
import { updateLeaderboard } from '../config/redis';
import balance from '../config/balance.json';

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
      'SELECT id, nickname, password_hash, exp, last_login_reward FROM users WHERE nickname = ?',
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

      // Daily login reward
      let exp = user.exp;
      const today = new Date().toISOString().slice(0, 10);
      const lastReward = user.last_login_reward ? new Date(user.last_login_reward).toISOString().slice(0, 10) : null;
      let dailyReward = 0;
      if (lastReward !== today && balance.dailyLoginExp > 0) {
        dailyReward = balance.dailyLoginExp;
        exp += dailyReward;
        await pool.query('UPDATE users SET exp = ?, last_login_reward = CURDATE() WHERE id = ?', [exp, user.id]);
        updateLeaderboard(user.id, user.nickname, exp).catch(() => {});
      }

      const levelInfo = calculateLevel(exp);
      const token = jwt.sign({ id: user.id, nickname: user.nickname }, JWT_SECRET, { expiresIn: '24h' });
      return res.json({ token, user: { id: user.id, nickname: user.nickname, exp, ...levelInfo }, created: false, dailyReward });
    }

    // New account: create and login
    const dailyReward = balance.dailyLoginExp;
    const initialExp = dailyReward;
    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.query<ResultSetHeader>(
      'INSERT INTO users (nickname, password_hash, exp, last_login_reward) VALUES (?, ?, ?, CURDATE())',
      [trimmed, passwordHash, initialExp]
    );

    const newUser = { id: result.insertId, nickname: trimmed };
    updateLeaderboard(newUser.id, trimmed, initialExp).catch(() => {});
    const levelInfo = calculateLevel(initialExp);
    const token = jwt.sign(newUser, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { ...newUser, exp: initialExp, ...levelInfo }, created: true, dailyReward });
  } catch (err) {
    console.error('Enter error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.post('/daily-check', async (req: Request, res: Response) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: '인증이 필요합니다.' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: number; nickname: string };
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, nickname, exp, last_login_reward FROM users WHERE id = ?',
      [decoded.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });

    const user = rows[0];
    const today = new Date().toISOString().slice(0, 10);
    const lastReward = user.last_login_reward ? new Date(user.last_login_reward).toISOString().slice(0, 10) : null;

    if (lastReward === today) {
      const levelInfo = calculateLevel(user.exp);
      return res.json({ dailyReward: 0, user: { id: user.id, nickname: user.nickname, exp: user.exp, ...levelInfo } });
    }

    const dailyReward = balance.dailyLoginExp;
    const newExp = user.exp + dailyReward;
    await pool.query('UPDATE users SET exp = ?, last_login_reward = CURDATE() WHERE id = ?', [newExp, user.id]);
    updateLeaderboard(user.id, user.nickname, newExp).catch(() => {});

    const levelInfo = calculateLevel(newExp);
    res.json({ dailyReward, user: { id: user.id, nickname: user.nickname, exp: newExp, ...levelInfo } });
  } catch {
    res.status(403).json({ error: '유효하지 않은 토큰입니다.' });
  }
});

export default router;
