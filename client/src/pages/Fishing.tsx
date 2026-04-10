import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import Chat from '../components/Chat';
import FishDetail, { getSizeLabel } from '../components/FishDetail';

import { SERVER_URL } from '../config';

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

const GRADE_COLORS: Record<string, string> = {
  mythical: '#ff450099',
  legendary: '#c8a20088',
  rare: '#9b59b688',
  uncommon: '#2980b988',
  common: '#27ae6088',
};

const GRADE_LABELS: Record<string, string> = {
  mythical: '신화',
  legendary: '전설',
  rare: '희귀',
  uncommon: '보통',
  common: '흔함',
};

function getRarityColor(grade?: string): string {
  return GRADE_COLORS[grade || 'common'] || GRADE_COLORS.common;
}

function getRarityLabel(grade?: string): string {
  return GRADE_LABELS[grade || 'common'] || GRADE_LABELS.common;
}

export default function Fishing() {
  const { token, user, updateUser } = useAuth();
  const socket = useSocket();
  const navigate = useNavigate();

  const [location, setLocation] = useState<string | null>(null);
  const [casting, setCasting] = useState(false);
  const [catchTime, setCatchTime] = useState(0);
  const [lastCatch, setLastCatch] = useState<FishDef | null>(null);
  const [fishLog, setFishLog] = useState<{ type: 'catch' | 'system'; nickname?: string; fish?: FishDef; sizeCm?: number; text?: string; timestamp: number }[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const [fishingUsers, setFishingUsers] = useState<{ id: number; nickname: string }[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [activeEvent, setActiveEvent] = useState<{ location: string; locationName: string; endTime: number } | null>(null);
  const [eventToast, setEventToast] = useState<string | null>(null);
  const [showInventory, setShowInventory] = useState(false);
  const [showShop, setShowShop] = useState(false);
  const [shopTab, setShopTab] = useState<'buy' | 'sell'>('buy');
  const [shopInfo, setShopInfo] = useState<{ gold: number; level: number; currentRod: string; rods: any[] } | null>(null);
  const [sellSelected, setSellSelected] = useState<Set<number>>(new Set());
  const [showEncyclopedia, setShowEncyclopedia] = useState(false);
  const [encyclopedia, setEncyclopedia] = useState<{ entries: EncyclopediaEntry[]; total: number; caught: number }>({ entries: [], total: 0, caught: 0 });
  const [fishDetail, setFishDetail] = useState<any>(null);
  const [showFishRanking, setShowFishRanking] = useState(false);
  const [fishRanking, setFishRanking] = useState<{ rank: number; userId: number; nickname: string; totalCount: number }[]>([]);
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
    socket.on('fishing:users', (u: { id: number; nickname: string }[]) => {
      setFishingUsers((prev) => {
        // Detect joins/leaves
        const prevIds = new Set(prev.map((p) => p.id));
        const newIds = new Set(u.map((p) => p.id));
        const joined = u.filter((p) => !prevIds.has(p.id));
        const left = prev.filter((p) => !newIds.has(p.id));
        for (const p of joined) {
          setFishLog((logs) => [...logs.slice(-49), { type: 'system' as const, text: `${p.nickname}님이 낚시터에 입장했습니다.`, timestamp: Date.now() }]);
        }
        for (const p of left) {
          setFishLog((logs) => [...logs.slice(-49), { type: 'system' as const, text: `${p.nickname}님이 낚시터를 떠났습니다.`, timestamp: Date.now() }]);
        }
        return u;
      });
    });
    socket.on('fishing:cast', (data: { catchTime: number }) => { setCasting(true); setCatchTime(Date.now() + data.catchTime); setLastCatch(null); });
    socket.on('fishing:caught', (data: { fish: FishDef }) => { setCasting(false); setLastCatch(data.fish); loadInventory(); });
    socket.on('fishing:log', (entry: { nickname: string; fish: FishDef; timestamp: number }) => {
      setFishLog((prev) => [...prev.slice(-49), { type: 'catch' as const, ...entry }]);
    });
    socket.on('fishing:kicked', () => {
      setLocation(null);
      setCasting(false);
      setLastCatch(null);
      setFishLog([]);
      setFishingUsers([]);
    });
    socket.on('fishing:event_start', (data: { location: string; locationName: string; endTime: number }) => {
      setActiveEvent(data);
      setEventToast(`🎉 ${data.locationName} 낚시터에 특별 이벤트가 시작되었습니다!`);
      setTimeout(() => setEventToast(null), 5000);
    });
    socket.on('fishing:event_end', (data: { location: string; locationName: string }) => {
      setActiveEvent(null);
      setEventToast(`${data.locationName} 낚시터 이벤트가 종료되었습니다.`);
      setTimeout(() => setEventToast(null), 4000);
    });
    socket.on('fishing:event_status', (event: any) => {
      if (event) {
        setActiveEvent({ location: event.location, locationName: LOCATION_INFO[event.location]?.name || event.location, endTime: event.endTime });
      } else {
        setActiveEvent(null);
      }
    });
    socket.emit('fishing:get_counts');
    socket.emit('fishing:get_event');
    return () => { socket.off('fishing:counts'); socket.off('fishing:users'); socket.off('fishing:cast'); socket.off('fishing:caught'); socket.off('fishing:log'); socket.off('fishing:kicked'); socket.off('fishing:event_start'); socket.off('fishing:event_end'); socket.off('fishing:event_status'); };
  }, [socket]);

  const loadInventory = () => fetch(`${SERVER_URL}/api/fishing/inventory`, { headers }).then((r) => r.json()).then((d) => setInventory(d.inventory || []));
  const loadEncyclopedia = () => fetch(`${SERVER_URL}/api/fishing/encyclopedia`, { headers }).then((r) => r.json()).then((d) => setEncyclopedia({ entries: d.encyclopedia, total: d.totalSpecies, caught: d.caughtSpecies }));
  const loadShop = () => fetch(`${SERVER_URL}/api/shop/info`, { headers }).then((r) => r.json()).then((d) => setShopInfo(d));

  useEffect(() => { loadInventory(); }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [fishLog]);

  const loadFishRanking = () => {
    fetch(`${SERVER_URL}/api/fishing-ranking/top`).then((r) => r.json()).then((d) => setFishRanking(Array.isArray(d) ? d : []));
  };

  const enterLocation = (loc: string) => { setLocation(loc); setCasting(false); setLastCatch(null); setFishLog([]); setMessage(''); socket?.emit('fishing:join', loc); };
  const leaveLocation = () => { socket?.emit('fishing:leave'); setLocation(null); setCasting(false); setLastCatch(null); setFishLog([]); setFishingUsers([]); };

  const buyRod = (rodKey: string) => {
    fetch(`${SERVER_URL}/api/shop/buy-rod`, { method: 'POST', headers, body: JSON.stringify({ rodKey }) })
      .then((r) => r.json()).then((d) => { if (d.error) { setMessage(d.error); return; } setMessage('낚시대를 구매했습니다!'); updateUser({ gold: d.newGold } as any); loadShop(); });
  };

  const equipRod = (rodKey: string) => {
    fetch(`${SERVER_URL}/api/shop/equip-rod`, { method: 'POST', headers, body: JSON.stringify({ rodKey }) })
      .then((r) => r.json()).then((d) => { if (d.error) { setMessage(d.error); return; } setMessage('낚시대를 장착했습니다!'); loadShop(); });
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
  const selectByGrade = (grade: string) => {
    const gradeIds = inventory.filter((i) => i.grade === grade).map((i) => i.inventoryId);
    setSellSelected((prev) => {
      const next = new Set(prev);
      const allSelected = gradeIds.every((id) => next.has(id));
      if (allSelected) {
        gradeIds.forEach((id) => next.delete(id));
      } else {
        gradeIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };
  const toggleAll = () => setSellSelected((prev) => prev.size === inventory.length ? new Set() : new Set(inventory.map((i) => i.inventoryId)));

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
            <button onClick={() => { loadFishRanking(); setShowFishRanking(true); }} className="btn-secondary">🏆 랭킹</button>
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
                    <div key={item.inventoryId} className="inv-grid-item" style={{ background: getRarityColor(item.grade) }} onClick={() => { const fi = getFishInfo(item.key); setFishDetail({ ...item, minSize: fi?.minSize, maxSize: fi?.maxSize }); }}>
                      <span className="inv-grid-emoji">{item.emoji}</span>
                      <span className="inv-grid-name">{item.name}</span>
                      {item.sizeCm && (() => { const fi = getFishInfo(item.key); const sl = getSizeLabel(item.sizeCm, fi?.minSize, fi?.maxSize); return (
                        <span className="inv-grid-size">{item.sizeCm}cm {sl.label && <span style={{ color: sl.color }}>({sl.label})</span>}</span>
                      ); })()}
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
                        const grade = fishInfo?.grade || 'common';
                        return (
                          <div key={entry.key}
                            className={`inv-grid-item ${!entry.caught ? 'enc-unknown' : ''}`}
                            style={{ background: entry.caught ? getRarityColor(grade) : 'var(--bg-surface)' }}
                            onClick={() => entry.caught && setFishDetail({ ...entry, grade, weight: fishInfo?.weight, description: fishInfo?.description })}
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

        {/* Fishing Ranking */}
        {showFishRanking && (
          <div className="modal-overlay" onClick={() => setShowFishRanking(false)}>
            <div className="modal encyclopedia-modal" onClick={(e) => e.stopPropagation()}>
              <div className="rules-header">
                <h2>🏆 낚시 랭킹</h2>
                <button onClick={() => setShowFishRanking(false)} className="btn-secondary btn-small">닫기</button>
              </div>
              <div className="ranking-table-wrap" style={{ maxHeight: '60vh', overflow: 'auto' }}>
                <table className="ranking-table">
                  <thead>
                    <tr><th>순위</th><th>닉네임</th><th>잡은 수</th></tr>
                  </thead>
                  <tbody>
                    {fishRanking.length === 0 ? (
                      <tr><td colSpan={3} style={{ textAlign: 'center', color: '#888' }}>아직 데이터가 없습니다</td></tr>
                    ) : fishRanking.map((r) => (
                      <tr key={r.userId} className={r.userId === user?.id ? 'ranking-me' : ''}>
                        <td className="rank-col">
                          {r.rank <= 3 ? <span className={`rank-medal rank-${r.rank}`}>{r.rank}</span> : r.rank}
                        </td>
                        <td>{r.nickname} {r.userId === user?.id ? '(나)' : ''}</td>
                        <td>{r.totalCount}마리</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                    const owned = (shopInfo.ownedRods || []).includes(rod.key);
                    const equipped = shopInfo.currentRod === rod.key;
                    return (
                      <div key={rod.key} className={`shop-item ${equipped ? 'shop-owned' : ''}`}>
                        <div className="shop-item-info">
                          <span className="shop-item-emoji">{rod.emoji}</span>
                          <div>
                            <div className="shop-item-name">
                              {rod.name}
                              {equipped && <span className="shop-equipped">장착 중</span>}
                              {owned && !equipped && <span className="shop-owned-badge">보유</span>}
                            </div>
                            <div className="shop-item-desc">{rod.description}</div>
                            <div className="shop-item-meta">Lv.{rod.level} | {rod.price > 0 ? `💰 ${rod.price}` : '무료'}</div>
                          </div>
                        </div>
                        {!equipped && owned && (
                          <button onClick={() => equipRod(rod.key)} className="btn-secondary btn-small">장착</button>
                        )}
                        {!owned && (
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
                    <div className="sell-filter-btns">
                      <button onClick={toggleAll} className="btn-secondary btn-small">{sellSelected.size === inventory.length ? '전체 해제' : '전체'}</button>
                      <button onClick={() => selectByGrade('common')} className="btn-secondary btn-small" style={{ color: '#27ae60' }}>흔함</button>
                      <button onClick={() => selectByGrade('uncommon')} className="btn-secondary btn-small" style={{ color: '#2980b9' }}>보통</button>
                      <button onClick={() => selectByGrade('rare')} className="btn-secondary btn-small" style={{ color: '#9b59b6' }}>희귀</button>
                      <button onClick={() => selectByGrade('legendary')} className="btn-secondary btn-small" style={{ color: '#c8a200' }}>전설</button>
                      <button onClick={() => selectByGrade('mythical')} className="btn-secondary btn-small" style={{ color: '#ff4500' }}>신화</button>
                    </div>
                  </div>
                  {inventory.length === 0 ? <p className="fishing-empty">판매할 물고기가 없습니다</p> : (
                    <>
                      <div className="sell-grid">
                        {inventory.map((item) => (
                          <div key={item.inventoryId} className={`inv-grid-item sell-selectable ${sellSelected.has(item.inventoryId) ? 'sell-checked' : ''}`}
                            style={{ background: getRarityColor(item.grade) }}
                            onClick={() => toggleSell(item.inventoryId)}>
                            <div className="sell-item-check">{sellSelected.has(item.inventoryId) ? '✓' : ''}</div>
                            <span className="inv-grid-emoji">{item.emoji}</span>
                            <span className="inv-grid-name">{item.name}</span>
                            {item.sizeCm && (() => { const fi = getFishInfo(item.key); const sl = getSizeLabel(item.sizeCm, fi?.minSize, fi?.maxSize); return (
                              <span className="inv-grid-size">{item.sizeCm}cm {sl.label && <span style={{ color: sl.color }}>({sl.label})</span>}</span>
                            ); })()}
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

        {eventToast && <div className="fishing-event-toast">{eventToast}</div>}

        {activeEvent && (
          <div className="fishing-event-banner">
            <span className="event-banner-icon">🎉</span>
            <span className="event-banner-text">
              <strong>특별 이벤트 진행 중!</strong> {LOCATION_INFO[activeEvent.location]?.emoji} {LOCATION_INFO[activeEvent.location]?.name} 낚시터에서 이벤트 전용 물고기가 등장합니다!
            </span>
          </div>
        )}

        <p className="fishing-desc">낚시터를 선택하세요</p>
        <div className="fishing-locations">
          {Object.entries(LOCATION_INFO).map(([key, info]) => (
            <div key={key} className="fishing-loc-card" style={{ background: info.bg }} onClick={() => enterLocation(key)}>
              <span className="loc-emoji">{info.emoji}</span>
              <span className="loc-name">{info.name}</span>
              <span className="loc-count">{counts[key] || 0}명 낚시 중</span>
              {activeEvent?.location === key && <span className="loc-event">🎉 이벤트!</span>}
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
          <button onClick={() => { loadEncyclopedia(); setShowEncyclopedia(true); }} className="btn-secondary">📖 도감</button>
          <button onClick={() => { loadInventory(); setShowInventory(!showInventory); }} className="btn-secondary">
            배낭 ({inventory.length})
          </button>
        </div>
      </header>

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
                  <div key={item.inventoryId} className="inv-grid-item" style={{ background: getRarityColor(item.grade) }} onClick={() => { const fi = getFishInfo(item.key); setFishDetail({ ...item, minSize: fi?.minSize, maxSize: fi?.maxSize }); }}>
                    <span className="inv-grid-emoji">{item.emoji}</span>
                    <span className="inv-grid-name">{item.name}</span>
                    {item.sizeCm && (() => { const fi = getFishInfo(item.key); const sl = getSizeLabel(item.sizeCm, fi?.minSize, fi?.maxSize); return (
                      <span className="inv-grid-size">{item.sizeCm}cm {sl.label && <span style={{ color: sl.color }}>({sl.label})</span>}</span>
                    ); })()}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {fishingUsers.length > 0 && (
        <div className="fishing-users">
          <span className="fishing-users-label">🎣 낚시 중 ({fishingUsers.length})</span>
          {fishingUsers.map((u) => (
            <span key={u.id} className={`fishing-user ${u.id === user?.id ? 'is-me' : ''}`}>{u.nickname}</span>
          ))}
        </div>
      )}

      <div className="fishing-main">
        <div className="fishing-left">
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

          <div className="fishing-log-panel">
            <div className="fishing-log-header">낚시 이력</div>
            <div className="fishing-log-list">
              {fishLog.length === 0 ? (
                <p className="fishing-log-empty">아직 이력이 없습니다</p>
              ) : fishLog.map((entry, i) => (
                entry.type === 'system' ? (
                  <div key={i} className="fishing-log-entry log-system">
                    <span className="log-text-system">{entry.text}</span>
                  </div>
                ) : (
                  <div key={i} className="fishing-log-entry" style={{ background: getRarityColor(entry.fish?.grade) }}>
                    <span className="log-text-catch">🎣 {entry.nickname}님이 {entry.fish?.emoji} {entry.fish?.name}을(를) 낚았습니다! {entry.sizeCm ? `(${entry.sizeCm}cm)` : ''}</span>
                  </div>
                )
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>

        <div className="fishing-chat">
          <Chat channel={`fishing:${location}`} />
        </div>
      </div>

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
                      const grade = fishInfo?.grade || 'common';
                      return (
                        <div key={entry.key}
                          className={`inv-grid-item ${!entry.caught ? 'enc-unknown' : ''}`}
                          style={{ background: entry.caught ? getRarityColor(grade) : 'var(--bg-surface)' }}
                          onClick={() => entry.caught && setFishDetail({ ...entry, grade, weight: fishInfo?.weight, description: fishInfo?.description })}
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

      {fishDetail && <FishDetail fish={fishDetail} onClose={() => setFishDetail(null)} />}
    </div>
  );
}
