import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

const SERVER_URL = `http://${window.location.hostname}:3001`;

export default function Register() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    try {
      const res = await fetch(`${SERVER_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, nickname }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error);
        return;
      }

      setSuccess('회원가입이 완료되었습니다! 로그인해주세요.');
      setTimeout(() => navigate('/login'), 1500);
    } catch {
      setError('서버에 연결할 수 없습니다.');
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>네온 보드게임</h1>
        <h2>회원가입</h2>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="아이디"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <input
            type="text"
            placeholder="닉네임"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            required
          />
          {error && <p className="error">{error}</p>}
          {success && <p className="success">{success}</p>}
          <button type="submit">회원가입</button>
        </form>
        <p className="auth-link">
          이미 계정이 있으신가요? <Link to="/login">로그인</Link>
        </p>
      </div>
    </div>
  );
}
