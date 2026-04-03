import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const SERVER_URL = `http://${window.location.hostname}:3001`;

export default function Login() {
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!nickname.trim()) return;

    try {
      const res = await fetch(`${SERVER_URL}/api/auth/enter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: nickname.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error);
        return;
      }

      login(data.token, data.user);
      navigate('/lobby');
    } catch {
      setError('서버에 연결할 수 없습니다.');
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>네온 보드게임</h1>
        <h2>닉네임을 입력하고 입장하세요</h2>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="닉네임"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={20}
            autoFocus
          />
          {error && <p className="error">{error}</p>}
          <button type="submit" className="btn-primary">입장</button>
        </form>
      </div>
    </div>
  );
}
