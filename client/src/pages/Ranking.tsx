import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

import { SERVER_URL } from '../config';

interface RankEntry {
  rank: number;
  userId: number;
  nickname: string;
  exp: number;
  level: number;
  currentExp: number;
  nextLevelExp: number;
}

export default function Ranking() {
  const [ranking, setRanking] = useState<RankEntry[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    async function load() {
      try {
        const [topRes, myRes] = await Promise.all([
          fetch(`${SERVER_URL}/api/ranking/top?count=50`),
          user ? fetch(`${SERVER_URL}/api/ranking/me/${user.id}/${encodeURIComponent(user.nickname)}`) : null,
        ]);

        if (topRes.ok) setRanking(await topRes.json());
        if (myRes?.ok) {
          const data = await myRes.json();
          setMyRank(data.rank);
        }
      } catch (err) {
        console.error('Ranking load error:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user]);

  return (
    <div className="ranking-container">
      <header className="ranking-header">
        <button onClick={() => navigate('/lobby')} className="btn-secondary">← 로비</button>
        <h1>랭킹</h1>
        {myRank && <span className="my-rank-badge">내 순위: {myRank}위</span>}
      </header>

      {loading ? (
        <div className="loading" style={{ minHeight: '200px' }}>불러오는 중...</div>
      ) : (
        <div className="ranking-table-wrap">
          <table className="ranking-table">
            <thead>
              <tr>
                <th>순위</th>
                <th>닉네임</th>
                <th>레벨</th>
                <th>EXP</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((r) => (
                <tr key={r.userId} className={r.userId === user?.id ? 'ranking-me' : ''}>
                  <td className="rank-col">
                    {r.rank <= 3 ? (
                      <span className={`rank-medal rank-${r.rank}`}>{r.rank}</span>
                    ) : r.rank}
                  </td>
                  <td>{r.nickname}</td>
                  <td>Lv.{r.level}</td>
                  <td>{r.exp.toLocaleString()}</td>
                </tr>
              ))}
              {ranking.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: '#888' }}>랭킹 데이터가 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
