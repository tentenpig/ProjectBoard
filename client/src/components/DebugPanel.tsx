import { useState, useEffect } from 'react';
import { SERVER_URL } from '../config';
import { useAuth } from '../contexts/AuthContext';

interface FishListItem { key: string; name: string; grade: string; event: boolean; location: string; }
interface FishingEvent { location: string; startTime: number; endTime: number; active: boolean; }

const LOC_LABELS: Record<string, string> = { river: '🏞 강', lake: '🌊 호수', sea: '🌅 바다' };
const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function DebugPanel() {
  const { token, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [fishList, setFishList] = useState<FishListItem[]>([]);
  const [selectedFish, setSelectedFish] = useState('');
  const [fishCount, setFishCount] = useState(1);
  const [goldAmount, setGoldAmount] = useState(10000);
  const [expAmount, setExpAmount] = useState(10000);
  const [eventLocation, setEventLocation] = useState('river');
  const [eventDuration, setEventDuration] = useState(10);
  const [log, setLog] = useState<string[]>([]);
  const [filterGrade, setFilterGrade] = useState('all');
  const [filterLocation, setFilterLocation] = useState('all');
  const [forcedGrade, setForcedGrade] = useState<string>('');
  const [forcedGradeOn, setForcedGradeOn] = useState(false);
  const [todayEvents, setTodayEvents] = useState<FishingEvent[]>([]);

  const headers: any = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => {
    if (!user?.is_admin) return;
    fetch(`${SERVER_URL}/api/debug/fish-list`, { headers: { 'Authorization': `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setFishList(Array.isArray(data) ? data : []))
      .catch(() => {});
    fetch(`${SERVER_URL}/api/debug/force-grade`, { headers: { 'Authorization': `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : { forcedGrade: null })
      .then((data) => {
        if (data.forcedGrade) { setForcedGrade(data.forcedGrade); setForcedGradeOn(true); }
      })
      .catch(() => {});
  }, [user?.is_admin, token]);

  const addLog = (msg: string) => setLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 19)]);

  const call = async (endpoint: string, body?: any) => {
    try {
      const res = await fetch(`${SERVER_URL}/api/debug/${endpoint}`, {
        method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      addLog(`${endpoint}: ${JSON.stringify(data)}`);
      return data;
    } catch (err) {
      addLog(`${endpoint} ERROR: ${err}`);
    }
  };

  const loadEvents = async () => {
    const data = await call('events');
    if (Array.isArray(data)) setTodayEvents(data);
  };

  useEffect(() => {
    if (open && user?.is_admin) loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Admin only — works on both test and prod servers.
  // Server-side, /api/debug/* requires DB is_admin check.
  if (!user?.is_admin) return null;

  const filteredFish = fishList.filter((f) =>
    (filterGrade === 'all' || f.grade === filterGrade) &&
    (filterLocation === 'all' || f.location === filterLocation)
  );

  if (!open) {
    return <button onClick={() => setOpen(true)} className="debug-toggle">🛠 Debug</button>;
  }

  return (
    <div className="debug-panel">
      <div className="debug-header">
        <h3>🛠 Debug Console</h3>
        <button onClick={() => setOpen(false)} className="btn-secondary btn-small">닫기</button>
      </div>

      <div className="debug-sections">
        {/* Add Fish */}
        <div className="debug-section">
          <h4>물고기 추가</h4>
          <div className="debug-filters">
            <select value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)}>
              <option value="all">전체 지역</option>
              <option value="river">강</option>
              <option value="lake">호수</option>
              <option value="sea">바다</option>
            </select>
            <select value={filterGrade} onChange={(e) => setFilterGrade(e.target.value)}>
              <option value="all">전체 등급</option>
              <option value="common">흔함</option>
              <option value="uncommon">보통</option>
              <option value="rare">희귀</option>
              <option value="legendary">전설</option>
              <option value="mythical">신화</option>
            </select>
          </div>
          <select value={selectedFish} onChange={(e) => setSelectedFish(e.target.value)}>
            <option value="">-- 선택 --</option>
            {filteredFish.map((f) => (
              <option key={f.key} value={f.key}>{f.event ? '🎉 ' : ''}{f.name} ({f.grade})</option>
            ))}
          </select>
          <div className="debug-row">
            <input type="number" value={fishCount} onChange={(e) => setFishCount(Number(e.target.value))} min={1} max={100} />
            <button onClick={() => selectedFish && call('add-fish', { fishKey: selectedFish, count: fishCount })} className="btn-primary btn-small">추가</button>
          </div>
        </div>

        {/* Gold / EXP */}
        <div className="debug-section">
          <h4>골드 설정</h4>
          <div className="debug-row">
            <input type="number" value={goldAmount} onChange={(e) => setGoldAmount(Number(e.target.value))} />
            <button onClick={() => call('set-gold', { amount: goldAmount })} className="btn-primary btn-small">설정</button>
          </div>
          <h4>경험치 설정</h4>
          <div className="debug-row">
            <input type="number" value={expAmount} onChange={(e) => setExpAmount(Number(e.target.value))} />
            <button onClick={() => call('set-exp', { amount: expAmount })} className="btn-primary btn-small">설정</button>
          </div>
        </div>

        {/* Events */}
        <div className="debug-section">
          <h4>이벤트 제어</h4>
          <div className="debug-row">
            <select value={eventLocation} onChange={(e) => setEventLocation(e.target.value)}>
              <option value="river">강</option>
              <option value="lake">호수</option>
              <option value="sea">바다</option>
            </select>
            <input type="number" value={eventDuration} onChange={(e) => setEventDuration(Number(e.target.value))} min={1} placeholder="분" style={{ width: 60 }} />
            <span style={{ fontSize: 12 }}>분</span>
          </div>
          <div className="debug-row">
            <button onClick={async () => { await call('start-event', { location: eventLocation, durationMin: eventDuration }); loadEvents(); }} className="btn-primary btn-small">이벤트 시작</button>
            <button onClick={async () => { await call('end-event', {}); loadEvents(); }} className="btn-secondary btn-small">이벤트 종료</button>
            <button onClick={loadEvents} className="btn-secondary btn-small">새로고침</button>
          </div>
          <div style={{ marginTop: 8, fontSize: 11 }}>
            <div style={{ color: '#ffab91', marginBottom: 4 }}>오늘 예정된 이벤트</div>
            {todayEvents.length === 0 ? (
              <div style={{ color: '#888' }}>예정된 이벤트 없음</div>
            ) : (
              todayEvents
                .slice()
                .sort((a, b) => a.startTime - b.startTime)
                .map((e, i) => {
                  const now = Date.now();
                  let status = '⏳ 대기';
                  let color = '#888';
                  if (e.active && now >= e.startTime && now < e.endTime) { status = '🔴 진행중'; color = '#8f8'; }
                  else if (now >= e.endTime) { status = '✓ 종료'; color = '#666'; }
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', color }}>
                      <span>{LOC_LABELS[e.location] || e.location}</span>
                      <span>{fmtTime(e.startTime)}~{fmtTime(e.endTime)}</span>
                      <span>{status}</span>
                    </div>
                  );
                })
            )}
          </div>
        </div>

        {/* Forced grade */}
        <div className="debug-section">
          <h4>다음 낚시 등급 강제 {forcedGradeOn && <span style={{ color: '#8f8' }}>● ON</span>}</h4>
          <div className="debug-row">
            <select value={forcedGrade} onChange={(e) => setForcedGrade(e.target.value)}>
              <option value="">-- 등급 선택 --</option>
              <option value="common">흔함</option>
              <option value="uncommon">보통</option>
              <option value="rare">희귀</option>
              <option value="legendary">전설</option>
              <option value="mythical">신화</option>
            </select>
            <button
              onClick={async () => {
                if (!forcedGrade) return;
                await call('force-grade', { grade: forcedGrade });
                setForcedGradeOn(true);
              }}
              className="btn-primary btn-small"
            >ON</button>
            <button
              onClick={async () => {
                await call('force-grade', { grade: null });
                setForcedGradeOn(false);
              }}
              className="btn-secondary btn-small"
            >OFF</button>
          </div>
          <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>
            ON 상태에서는 본인이 잡는 다음 모든 물고기가 선택한 등급으로 고정됩니다.
          </div>
        </div>

        {/* Log */}
        <div className="debug-section">
          <h4>로그</h4>
          <div className="debug-log">
            {log.length === 0 ? <span style={{ color: '#888' }}>실행 결과가 여기에 표시됩니다</span> : log.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
      </div>
    </div>
  );
}
