import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import Chat from '../components/Chat';
import FishDetail from '../components/FishDetail';

const SERVER_URL = `http://${window.location.hostname}:3001`;

interface FishDef {
  key: string; name: string; emoji: string; location: string;
  weight: number; minTime: number; maxTime: number; price: number; exp: number; description?: string;
}
interface InventoryItem extends FishDef { count: number; }
interface EncyclopediaEntry {
  key: string; name: string; emoji: string; location: string;
  caught: boolean; price: number | null; exp: number | null; description?: string;
}

const LOCATION_INFO: Record<string, { name: string; emoji: string; bg: string }> = {
  river: { name: '강', emoji: '🏞️', bg: '#2d5a3d' },
  lake: { name: '호수', emoji: '🌊', bg: '#1a4a6a' },
  sea: { name: '바다', emoji: '🌅', bg: '#1a3a5a' },
};

export default function Fishing() {
  const { token, user, updateUser } = useAuth();
  const socket = useSocket();
  const navigate = useNavigate();

  const [location, setLocation] = useState<string | null>(null);
  const [casting, setCasting] = useState(false);
  const [catchTime, setCatchTime] = useState(0);
  const [lastCatch, setLastCatch] = useState<FishDef | null>(null);
  const [catches, setCatches] = useState<FishDef[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [showInventory, setShowInventory] = useState(false);
  const [showShop, setShowShop] = useState(false);
  const [shopTab, setShopTab] = useState<'buy' | 'sell'>('buy');
  const [shopInfo, setShopInfo] = useState<{ gold: number; level: number; currentRod: string; rods: any[] } | null>(null);
  const [sellSelected, setSellSelected] = useState<Set<string>>(new Set());
  const [showEncyclopedia, setShowEncyclopedia] = useState(false);
  const [encyclopedia, setEncyclopedia] = useState<{ entries: EncyclopediaEntry[]; total: number; caught: number }>({ entries: [], total: 0, caught: 0 });
  const [fishDetail, setFishDetail] = useState<any>(null);
  const [counts, setCounts] = useState<Record<string, number>>({ river: 0, lake: 0, sea: 0 });
  const [message, setMessage] = useState('');
  const [allFishData, setAllFishData] = useState<FishDef[]>([]);

  const headers: any = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => {
    fetch(`${SERVER_URL}/api/fishing/fish-data`).then((r) => r.json()).then((d) => setAllFishData(d.fish || []));
  }, []);

  useEffect(() => {
    if (!socket) return;
    socket.on('fishing:counts', (c: Record<string, number>) => setCounts(c));
    socket.on('fishing:cast', (data: { catchTime: number }) => { setCasting(true); setCatchTime(Date.now() + data.catchTime); setLastCatch(null); });
    socket.on('fishing:caught', (data: { fish: FishDef }) => { setCasting(false); setLastCatch(data.fish); setCatches((p) => [data.fish, ...p.slice(0, 19)]); loadInventory(); });
    return () => { socket.off('fishing:counts'); socket.off('fishing:cast'); socket.off('fishing:caught'); };
  }, [socket]);

  const loadInventory = () => fetch(`${SERVER_URL}/api/fishing/inventory`, { headers }).then((r) => r.json()).then((d) => setInventory(d.inventory || []));
  const loadEncyclopedia = () => fetch(`${SERVER_URL}/api/fishing/encyclopedia`, { headers }).then((r) => r.json()).then((d) => setEncyclopedia({ entries: d.encyclopedia, total: d.totalSpecies, caught: d.caughtSpecies }));
  const loadShop = () => fetch(`${SERVER_URL}/api/shop/info`, { headers }).then((r) => r.json()).then((d) => setShopInfo(d));

  useEffect(() => { loadInventory(); }, []);

  const enterLocation = (loc: string) => { setLocation(loc); setCasting(false); setLastCatch(null); setCatches([]); setMessage(''); socket?.emit('fishing:join', loc); };
  const leaveLocation = () => { socket?.emit('fishing:leave'); setLocation(null); setCasting(false); setLastCatch(null); setCatches([]); };

  const buyRod = (rodKey: string) => {
    fetch(`${SERVER_URL}/api/shop/buy-rod`, { method: 'POST', headers, body: JSON.stringify({ rodKey }) })
      .then((r) => r.json()).then((d) => { if (d.error) { setMessage(d.error); return; } setMessage('낚시대를 구매했습니다!'); updateUser({ gold: d.newGold } as any); loadShop(); });
  };

  const sellFish = () => {
    const items = Array.from(sellSelected);
    if (items.length === 0) return;
    // Sell all selected fish one type at a time
    const promises = items.map((key) => {
      const item = inventory.find((i) => i.key === key);
      if (!item) return Promise.resolve(null);
      return fetch(`${SERVER_URL}/api/fishing/sell`, { method: 'POST', headers, body: JSON.stringify({ fishKey: key, count: item.count }) }).then((r) => r.json());
    });
    Promise.all(promises).then((results) => {
      const totals = results.filter(Boolean).reduce((acc: any, r: any) => ({ gold: (acc.gold || 0) + (r.totalGold || 0), exp: (acc.exp || 0) + (r.totalExp || 0), newGold: r.newGold, newExp: r.newExp, level: r.level, currentExp: r.currentExp, nextLevelExp: r.nextLevelExp }), {});
      setMessage(`판매 완료! +${totals.gold} 골드 / +${totals.exp} EXP`);
      if (totals.newExp) updateUser({ exp: totals.newExp, gold: totals.newGold, level: totals.level, currentExp: totals.currentExp, nextLevelExp: totals.nextLevelExp });
      setSellSelected(new Set());
      loadInventory();
      loadShop();
    });
  };

  const toggleSell = (key: string) => setSellSelected((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleAllSell = () => { if (sellSelected.size === inventory.length) setSellSelected(new Set()); else setSellSelected(new Set(inventory.map((i) => i.key))); };

  const getFishInfo = (key: string) => allFishData.find((f) => f.key === key);

  const sellTotal = Array.from(sellSelected).reduce((acc, key) => {
    const item = inventory.find((i) => i.key === key);
    return { gold: acc.gold + (item?.price || 0) * (item?.count || 0), exp: acc.exp + (item?.exp || 0) * (item?.count || 0) };
  }, { gold: 0, exp: 0 });

  // ===== Location select =====
  if (!location) {
    return (
      <div className="fishing-container">
        <header className="fishing-header">
          <button onClick={() => navigate('/lobby')} className="btn-secondary">← 로비</button>
          <h1>🎣 낚시터</h1>
          <div className="fishing-header-btns">
            <span className="gold-display">💰 {user?.gold || 0}</span>
            <button onClick={() => { loadShop(); loadInventory(); setShowShop(true); setShopTab('buy'); }} className="btn-secondary">🏪 상점</button>
            <button onClick={() => { loadEncyclopedia(); setShowEncyclopedia(true); }} className="btn-secondary">📖 도감</button>
            <button onClick={() => { loadInventory(); setShowInventory(!showInventory); }} className="btn-secondary">배낭 ({inventory.reduce((s, i) => s + i.count, 0)})</button>
          </div>
        </header>

        {/* Inventory (view only) */}
        {showInventory && (
          <div className="fishing-inventory">
            <h3>배낭</h3>
            {inventory.length === 0 ? <p className="fishing-empty">비어있습니다</p> : (
              <div className="inventory-list">
                {inventory.map((item) => (
                  <div key={item.key} className="inventory-item" style={{ cursor: 'pointer' }} onClick={() => setFishDetail(item)}>
                    <span className="inv-fish">{item.emoji} {item.name} x{item.count}</span>
                    <span className="inv-info">💰{item.price} EXP{item.exp}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Encyclopedia */}
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
                        <div key={entry.key} className={`encyclopedia-item ${entry.caught ? 'caught' : 'unknown'}`}
                          onClick={() => entry.caught && setFishDetail({ ...entry, description: getFishInfo(entry.key)?.description })}
                          style={entry.caught ? { cursor: 'pointer' } : undefined}>
                          <span className="enc-emoji">{entry.emoji}</span>
                          <span className="enc-name">{entry.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Shop */}
        {showShop && shopInfo && (
          <div className="modal-overlay" onClick={() => setShowShop(false)}>
            <div className="modal shop-modal" onClick={(e) => e.stopPropagation()}>
              <div className="rules-header">
                <h2>🏪 상점</h2>
                <button onClick={() => setShowShop(false)} className="btn-secondary btn-small">닫기</button>
              </div>
              <div className="shop-tabs">
                <button className={`shop-tab ${shopTab === 'buy' ? 'active' : ''}`} onClick={() => setShopTab('buy')}>구매</button>
                <button className={`shop-tab ${shopTab === 'sell' ? 'active' : ''}`} onClick={() => setShopTab('sell')}>판매</button>
              </div>
              <p className="shop-gold">💰 {shopInfo.gold} | Lv.{shopInfo.level}</p>

              {shopTab === 'buy' && (
                <div className="shop-list">
                  <p className="shop-current">장착: {shopInfo.rods.find((r) => r.key === shopInfo.currentRod)?.emoji} {shopInfo.rods.find((r) => r.key === shopInfo.currentRod)?.name}</p>
                  {shopInfo.rods.map((rod) => {
                    const isOwned = shopInfo.currentRod === rod.key;
                    const isDowngrade = shopInfo.rods.findIndex((r) => r.key === shopInfo.currentRod) >= shopInfo.rods.findIndex((r) => r.key === rod.key);
                    return (
                      <div key={rod.key} className={`shop-item ${isOwned ? 'shop-owned' : ''}`}>
                        <div className="shop-item-info">
                          <span className="shop-item-emoji">{rod.emoji}</span>
                          <div>
                            <div className="shop-item-name">{rod.name} {isOwned && <span className="shop-equipped">장착 중</span>}</div>
                            <div className="shop-item-desc">{rod.description}</div>
                            <div className="shop-item-meta">Lv.{rod.level} | {rod.price > 0 ? `💰 ${rod.price}` : '무료'}</div>
                          </div>
                        </div>
                        {!isOwned && !isDowngrade && (
                          <button onClick={() => buyRod(rod.key)} className="btn-primary btn-small" disabled={shopInfo.gold < rod.price || shopInfo.level < rod.level}>
                            {shopInfo.level < rod.level ? `Lv.${rod.level}` : shopInfo.gold < rod.price ? '부족' : '구매'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {shopTab === 'sell' && (
                <div className="shop-list">
                  <div className="sell-controls">
                    <span>{sellSelected.size}개 선택</span>
                    <button onClick={toggleAllSell} className="btn-secondary btn-small">
                      {sellSelected.size === inventory.length ? '모두 취소' : '모두 선택'}
                    </button>
                  </div>
                  {inventory.length === 0 ? <p className="fishing-empty">판매할 물고기가 없습니다</p> : (
                    <>
                      {inventory.map((item) => (
                        <div key={item.key} className={`sell-item ${sellSelected.has(item.key) ? 'selected' : ''}`} onClick={() => toggleSell(item.key)}>
                          <div className="sell-item-check">{sellSelected.has(item.key) ? '✓' : ''}</div>
                          <span style={{ flex: 1 }}>{item.emoji} {item.name} x{item.count}</span>
                          <span className="inv-info">💰{item.price * item.count} EXP{item.exp * item.count}</span>
                        </div>
                      ))}
                      {sellSelected.size > 0 && (
                        <div className="sell-summary">
                          <span>합계: 💰{sellTotal.gold} / EXP {sellTotal.exp}</span>
                          <button onClick={sellFish} className="btn-primary btn-small">일괄 판매</button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              {message && <p className="fishing-message">{message}</p>}
            </div>
          </div>
        )}

        {fishDetail && <FishDetail fish={fishDetail} onClose={() => setFishDetail(null)} />}

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

  // ===== In location =====
  const locInfo = LOCATION_INFO[location];

  return (
    <div className="fishing-container">
      <header className="fishing-header">
        <button onClick={leaveLocation} className="btn-secondary">← 뒤로</button>
        <h1>{locInfo.emoji} {locInfo.name} 낚시터</h1>
        <div className="fishing-header-btns">
          <span className="gold-display">💰 {user?.gold || 0}</span>
          <button onClick={() => { loadInventory(); setShowInventory(!showInventory); }} className="btn-secondary">
            배낭 ({inventory.reduce((s, i) => s + i.count, 0)})
          </button>
        </div>
      </header>

      {showInventory && (
        <div className="fishing-inventory">
          <h3>배낭</h3>
          {inventory.length === 0 ? <p className="fishing-empty">비어있습니다</p> : (
            <div className="inventory-list">
              {inventory.map((item) => (
                <div key={item.key} className="inventory-item" style={{ cursor: 'pointer' }} onClick={() => setFishDetail(item)}>
                  <span className="inv-fish">{item.emoji} {item.name} x{item.count}</span>
                  <span className="inv-info">💰{item.price} EXP{item.exp}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="fishing-main">
        <div className="fishing-scene" style={{ background: locInfo.bg }}>
          {casting ? (
            <div className="fishing-waiting">
              <div className="fishing-bobber">🎣</div>
              <p>입질을 기다리는 중...</p>
              <p className="fishing-timer">. . .</p>
            </div>
          ) : (
            <div className="fishing-waiting">
              <div className="fishing-bobber">🎣</div>
              <p>낚시를 준비하는 중...</p>
            </div>
          )}
        </div>

        <div className="fishing-chat">
          <Chat channel={`fishing:${location}`} />
        </div>
      </div>

      {fishDetail && <FishDetail fish={fishDetail} onClose={() => setFishDetail(null)} />}
    </div>
  );
}
