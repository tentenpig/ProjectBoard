import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import authRouter from './routes/auth';
import rankingRouter from './routes/ranking';
import fishingRouter from './routes/fishing';
import { setupSocket } from './socket/index';
import pool from './config/database';
import { syncLeaderboardFromDB } from './config/redis';

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/ranking', rankingRouter);
app.use('/api/fishing', fishingRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

setupSocket(io);

const PORT = process.env.PORT || 3001;
server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  // Sync leaderboard from DB on startup
  try {
    await syncLeaderboardFromDB(pool);
  } catch (err) {
    console.error('Leaderboard sync failed:', err);
  }
});
