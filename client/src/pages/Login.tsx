import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const SERVER_URL = `http://${window.location.hostname}:3001`;

export default function Login() {
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');

    if (!nickname.trim() || !password) return;

    try {
      const res = await fetch(`${SERVER_URL}/api/auth/enter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: nickname.trim(), password }),
      });

      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }

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
        <h2>닉네임과 비밀번호를 입력하세요</h2>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="닉네임"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={20}
            autoFocus
          />
          <input
            type="password"
            placeholder="비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="error">{error}</p>}
          {info && <p className="success">{info}</p>}
          <button type="submit" className="btn-primary">입장</button>
        </form>
        <p className="auth-hint">처음 사용하는 닉네임은 자동으로 계정이 생성됩니다.</p>
      </div>
    </div>
  );
}
