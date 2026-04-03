import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../config/database';
import { RowDataPacket } from 'mysql2';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';

router.post('/register', async (req: Request, res: Response) => {
  const { username, password, nickname } = req.body;

  if (!username || !password || !nickname) {
    return res.status(400).json({ error: '모든 필드를 입력해주세요.' });
  }

  try {
    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM users WHERE username = ?',
      [username]
    );

    if (existing.length > 0) {
      return res.status(409).json({ error: '이미 존재하는 아이디입니다.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (username, password_hash, nickname) VALUES (?, ?, ?)',
      [username, passwordHash, nickname]
    );

    res.status(201).json({ message: '회원가입이 완료되었습니다.' });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요.' });
  }

  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, username, password_hash, nickname FROM users WHERE username = ?',
      [username]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }

    const user = rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, nickname: user.nickname },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token, user: { id: user.id, username: user.username, nickname: user.nickname } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

export default router;
