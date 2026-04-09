import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import Chat from '../components/Chat';

const SERVER_URL = `http://${window.location.hostname}:3001`;

interface FishDef {
  key: string; name: string; emoji: string; location: string;
  weight: number; minTime: number; maxTime: number; price: number; exp: number;
}

interface InventoryItem extends FishDef { count: number; }

interface EncyclopediaEntry {
  key: string; name: string; emoji: string; location: string;
  caught: boolean; price: number | null; exp: number | null;
}

const LOCATION_INFO: Record<string, { name: string; emoji: string; bg: string }> = {
  river: { name: '강', emoji: '🏞️', bg: '#2d5a3d' },
  lake: { name: '호수', emoji: '🌊', bg: '#1a4a6a' },
  sea: { name: '바다', emoji: '🌅', bg: '#1a3a5a' },
};

export default function Fishing() {
  const { token, updateUser } = useAuth();
  const socket = useSocket();
  const navigate = useNavigate();

  const [location, setLocation] = useState<string | null>(null);
  const [casting, setCasting] = useState(false);
  const [catchTime, setCatchTime] = useState(0);
  const [lastCatch, setLastCatch] = useState<FishDef | null>(null);
  const [catches, setCatches] = useState<FishDef[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [showInventory, setShowInventory] = useState(false);
  const [showEncyclopedia, setShowEncyclopedia] = useState(false);
  const [encyclopedia, setEncyclopedia] = useState<{ entries: EncyclopediaEntry[]; total: number; caught: number }>({ entries: [], total: 0, caught: 0 });
  const [counts, setCounts] = useState<Record<string, number>>({ river: 0, lake: 0, sea: 0 });
  const [message, setMessage] = useState('');
  const [remainSec, setRemainSec] = useState(0);

  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Fishing counts
  useEffect(() => {
    if (!socket) return;
    const handler = (c: Record<string, number>) => setCounts(c);
    socket.on('fishing:counts', handler);
    return () => { socket.off('fishing:counts', handler); };
  }, [socket]);

  // Fishing events
  useEffect(() => {
    if (!socket) return;

    const handleCast = (data: { catchTime: number }) => {
      setCasting(true);
      setCatchTime(Date.now() + data.catchTime);
      setLastCatch(null);
    };

    const handleCaught = (data: { fish: FishDef }) => {
      setCasting(false);
      setLastCatch(data.fish);
      setCatches((prev) => [data.fish, ...prev.slice(0, 19)]);
      loadInventory();
    };

    socket.on('fishing:cast', handleCast);
    socket.on('fishing:caught', handleCaught);
    return () => {
      socket.off('fishing:cast', handleCast);
      socket.off('fishing:caught', handleCaught);
    };
  }, [socket]);

  // Countdown timer
  useEffect(() => {
    if (!casting) { setRemainSec(0); return; }
    const interval = setInterval(() => {
      const r = Math.max(0, Math.ceil((catchTime - Date.now()) / 1000));
      setRemainSec(r);
    }, 500);
    return () => clearInterval(interval);
  }, [casting, catchTime]);

  const loadInventory = () => {
    fetch(`${SERVER_URL}/api/fishing/inventory`, { headers })
      .then((r) => r.json())
      .then((data) => setInventory(data.inventory || []));
  };

  const loadEncyclopedia = () => {
    fetch(`${SERVER_URL}/api/fishing/encyclopedia`, { headers })
      .then((r) => r.json())
      .then((data) => setEncyclopedia({ entries: data.encyclopedia, total: data.totalSpecies, caught: data.caughtSpecies }));
  };

  useEffect(() => { loadInventory(); }, []);

  const enterLocation = (loc: string) => {
    setLocation(loc);
    setCasting(false);
    setLastCatch(null);
    setCatches([]);
    setMessage('');
    socket?.emit('fishing:join', loc);
  };

  const leaveLocation = () => {
    socket?.emit('fishing:leave');
    setLocation(null);
    setCasting(false);
    setLastCatch(null);
    setCatches([]);
  };

  const sellFish = (fishKey: string, count: number) => {
    fetch(`${SERVER_URL}/api/fishing/sell`, {
      method: 'POST', headers, body: JSON.stringify({ fishKey, count }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setMessage(data.error); return; }
        setMessage(`판매 완료! +${data.totalExp} EXP`);
        updateUser({ exp: data.newExp, level: data.level, currentExp: data.currentExp, nextLevelExp: data.nextLevelExp });
        loadInventory();
      });
  };

  // Location select
  if (!location) {
    return (
      <div className="fishing-container">
        <header className="fishing-header">
          <button onClick={() => navigate('/lobby')} className="btn-secondary">← 로비</button>
          <h1>🎣 낚시터</h1>
          <div className="fishing-header-btns">
            <button onClick={() => { loadEncyclopedia(); setShowEncyclopedia(true); }} className="btn-secondary">📖 도감</button>
            <button onClick={() => { loadInventory(); setShowInventory(!showInventory); }} className="btn-secondary">
              배낭 ({inventory.reduce((s, i) => s + i.count, 0)})
            </button>
          </div>
        </header>

        {showInventory && <InventoryPanel inventory={inventory} onSell={sellFish} message={message} />}

        {showEncyclopedia && (
          <div className="modal-overlay" onClick={() => setShowEncyclopedia(false)}>
            <div className="modal encyclopedia-modal" onClick={(e) => e.stopPropagation()}>
              <div className="rules-header">
                <h2>📖 물고기 도감 ({encyclopedia.caught}/{encyclopedia.total})</h2>
                <button onClick={() => setShowEncyclopedia(false)} className="btn-secondary btn-small">닫기</button>
              </div>
              <div className="encyclopedia-content">
                {Object.entries(LOCATION_INFO).map(([locKey, info]) => (
                  <div key={locKey} className="encyclopedia-section">
                    <h3>{info.emoji} {info.name}</h3>
                    <div className="encyclopedia-grid">
                      {encyclopedia.entries.filter((e) => e.location === locKey).map((entry) => (
                        <div key={entry.key} className={`encyclopedia-item ${entry.caught ? 'caught' : 'unknown'}`}>
                          <span className="enc-emoji">{entry.emoji}</span>
                          <span className="enc-name">{entry.name}</span>
                          {entry.caught && <span className="enc-info">💰{entry.price} | EXP {entry.exp}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <p className="fishing-desc">낚시터를 선택하세요</p>
        <div className="fishing-locations">
          {Object.entries(LOCATION_INFO).map(([key, info]) => (
            <div key={key} className="fishing-loc-card" style={{ background: info.bg }} onClick={() => enterLocation(key)}>
              <span className="loc-emoji">{info.emoji}</span>
              <span className="loc-name">{info.name}</span>
              <span className="loc-count">{counts[key] || 0}명 낚시 중</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const locInfo = LOCATION_INFO[location];

  return (
    <div className="fishing-container">
      <header className="fishing-header">
        <button onClick={leaveLocation} className="btn-secondary">← 뒤로</button>
        <h1>{locInfo.emoji} {locInfo.name} 낚시터</h1>
        <button onClick={() => { loadInventory(); setShowInventory(!showInventory); }} className="btn-secondary">
          배낭 ({inventory.reduce((s, i) => s + i.count, 0)})
        </button>
      </header>

      {showInventory && <InventoryPanel inventory={inventory} onSell={sellFish} message={message} />}

      <div className="fishing-main">
        <div className="fishing-scene" style={{ background: locInfo.bg }}>
          {casting ? (
            <div className="fishing-waiting">
              <div className="fishing-bobber">🎣</div>
              <p>입질을 기다리는 중...</p>
              <p className="fishing-timer">. . .</p>
            </div>
          ) : lastCatch ? (
            <div className="fishing-caught">
              <div className="fishing-catch-emoji">{lastCatch.emoji}</div>
              <p className="fishing-catch-name">{lastCatch.name} 획득!</p>
              <p className="fishing-catch-info">💰 {lastCatch.price} | EXP {lastCatch.exp}</p>
              <p className="fishing-auto-msg">곧 다시 찌를 던집니다...</p>
            </div>
          ) : (
            <div className="fishing-waiting">
              <div className="fishing-bobber">🎣</div>
              <p>낚시를 준비하는 중...</p>
            </div>
          )}

          {/* Recent catches log */}
          {catches.length > 0 && (
            <div className="fishing-log">
              {catches.slice(0, 5).map((f, i) => (
                <span key={i} className="fishing-log-item">{f.emoji}{f.name}</span>
              ))}
            </div>
          )}
        </div>

        <div className="fishing-chat">
          <Chat channel={`fishing:${location}`} />
        </div>
      </div>
    </div>
  );
}

function InventoryPanel({ inventory, onSell, message }: {
  inventory: InventoryItem[];
  onSell: (key: string, count: number) => void;
  message: string;
}) {
  return (
    <div className="fishing-inventory">
      <h3>배낭</h3>
      {message && <p className="fishing-message">{message}</p>}
      {inventory.length === 0 ? (
        <p className="fishing-empty">비어있습니다</p>
      ) : (
        <div className="inventory-list">
          {inventory.map((item) => (
            <div key={item.key} className="inventory-item">
              <span className="inv-fish">{item.emoji} {item.name} x{item.count}</span>
              <span className="inv-info">EXP {item.exp} / 개</span>
              <div className="inv-actions">
                <button onClick={() => onSell(item.key, 1)} className="btn-secondary btn-small">1개 판매</button>
                {item.count > 1 && (
                  <button onClick={() => onSell(item.key, item.count)} className="btn-secondary btn-small">전체 판매</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
