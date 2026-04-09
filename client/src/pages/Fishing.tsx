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
interface InventoryItem extends FishDef { inventoryId: number; caughtAt: string; }
interface EncyclopediaEntry {
  key: string; name: string; emoji: string; location: string;
  caught: boolean; price: number | null; exp: number | null; description?: string;
}

const LOCATION_INFO: Record<string, { name: string; emoji: string; bg: string }> = {
  river: { name: '강', emoji: '🏞️', bg: '#2d5a3d' },
  lake: { name: '호수', emoji: '🌊', bg: '#1a4a6a' },
  sea: { name: '바다', emoji: '🌅', bg: '#1a3a5a' },
};

function getRarityColor(weight: number): string {
  if (weight <= 1) return '#c8a20088';    // legendary - gold
  if (weight <= 5) return '#9b59b688';    // rare - purple
  if (weight <= 15) return '#2980b988';   // uncommon - blue
  return '#27ae6088';                      // common - green
}

function getRarityLabel(weight: number): string {
  if (weight <= 1) return '전설';
  if (weight <= 5) return '희귀';
  if (weight <= 15) return '보통';
  return '흔함';
}

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
  const [sellSelected, setSellSelected] = useState<Set<number>>(new Set());
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
    const ids = Array.from(sellSelected);
    if (ids.length === 0) return;
    fetch(`${SERVER_URL}/api/fishing/sell`, { method: 'POST', headers, body: JSON.stringify({ inventoryIds: ids }) })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setMessage(data.error); return; }
        setMessage(`판매 완료! +${data.totalGold} 골드 / +${data.totalExp} EXP`);
        updateUser({ exp: data.newExp, gold: data.newGold, level: data.level, currentExp: data.currentExp, nextLevelExp: data.nextLevelExp });
        setSellSelected(new Set());
        loadInventory();
        loadShop();
      });
  };

  const toggleSell = (id: number) => setSellSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAllSell = () => { if (sellSelected.size === inventory.length) setSellSelected(new Set()); else setSellSelected(new Set(inventory.map((i) => i.inventoryId))); };

  const getFishInfo = (key: string) => allFishData.find((f) => f.key === key);

  const sellTotal = Array.from(sellSelected).reduce((acc, id) => {
    const item = inventory.find((i) => i.inventoryId === id);
    return { gold: acc.gold + (item?.price || 0), exp: acc.exp + (item?.exp || 0) };
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
            <button onClick={() => { loadInventory(); setShowInventory(!showInventory); }} className="btn-secondary">배낭 ({inventory.length})</button>
          </div>
        </header>

        {/* Inventory (view only) */}
        {showInventory && (
          <div className="modal-overlay" onClick={() => setShowInventory(false)}>
            <div className="modal inventory-modal" onClick={(e) => e.stopPropagation()}>
              <div className="rules-header">
                <h2>🎒 배낭 ({inventory.length})</h2>
                <button onClick={() => setShowInventory(false)} className="btn-secondary btn-small">닫기</button>
              </div>
              {inventory.length === 0 ? <p className="fishing-empty">비어있습니다</p> : (
                <div className="inventory-grid">
                  {inventory.map((item) => (
                    <div key={item.inventoryId} className="inv-grid-item" style={{ background: getRarityColor(item.weight) }} onClick={() => setFishDetail(item)}>
                      <span className="inv-grid-emoji">{item.emoji}</span>
                      <span className="inv-grid-name">{item.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
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
                    <div className="inventory-grid">
                      {encyclopedia.entries.filter((e) => e.location === locKey).map((entry) => {
                        const fishInfo = getFishInfo(entry.key);
                        const weight = fishInfo?.weight || 30;
                        return (
                          <div key={entry.key}
                            className={`inv-grid-item ${!entry.caught ? 'enc-unknown' : ''}`}
                            style={{ background: entry.caught ? getRarityColor(weight) : 'var(--bg-surface)' }}
                            onClick={() => entry.caught && setFishDetail({ ...entry, weight, description: fishInfo?.description })}
                          >
                            <span className="inv-grid-emoji">{entry.emoji}</span>
                            <span className="inv-grid-name">{entry.name}</span>
                          </div>
                        );
                      })}
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
                      <div className="sell-grid">
                        {inventory.map((item) => (
                          <div key={item.inventoryId} className={`inv-grid-item sell-selectable ${sellSelected.has(item.inventoryId) ? 'sell-checked' : ''}`}
                            style={{ background: getRarityColor(item.weight) }}
                            onClick={() => toggleSell(item.inventoryId)}>
                            <div className="sell-item-check">{sellSelected.has(item.inventoryId) ? '✓' : ''}</div>
                            <span className="inv-grid-emoji">{item.emoji}</span>
                            <span className="inv-grid-name">{item.name}</span>
                            <span className="inv-grid-price">💰{item.price}</span>
                          </div>
                        ))}
                      </div>
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
            배낭 ({inventory.length})
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
