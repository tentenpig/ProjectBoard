import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';

export interface AuthRequest extends Request {
  user?: { id: number; username: string; nickname: string };
}

export function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: '인증이 필요합니다.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: number; username: string; nickname: string };
    req.user = decoded;
    next();
  } catch {
    return res.status(403).json({ error: '유효하지 않은 토큰입니다.' });
  }
}
