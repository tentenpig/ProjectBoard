interface FishInfo {
  key: string;
  name: string;
  emoji: string;
  location: string;
  weight?: number;
  price?: number | null;
  exp?: number | null;
  description?: string;
  caught?: boolean;
  sizeCm?: number;
  recordMinSize?: number | null;
  recordMaxSize?: number | null;
  caughtCount?: number;
}

const LOCATION_NAMES: Record<string, string> = {
  river: '🏞️ 강',
  lake: '🌊 호수',
  sea: '🌅 바다',
};

function getRarityInfo(weight: number): { label: string; color: string } {
  if (weight <= 1) return { label: '전설', color: '#c8a200' };
  if (weight <= 5) return { label: '희귀', color: '#9b59b6' };
  if (weight <= 15) return { label: '보통', color: '#2980b9' };
  return { label: '흔함', color: '#27ae60' };
}

export default function FishDetail({ fish, onClose }: { fish: FishInfo; onClose: () => void }) {
  const rarity = fish.weight != null ? getRarityInfo(fish.weight) : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal fish-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fish-detail-header">
          <span className="fish-detail-emoji">{fish.emoji}</span>
          <div>
            <h2>{fish.name}</h2>
            <div className="fish-detail-sub">
              <span className="fish-detail-location">{LOCATION_NAMES[fish.location] || fish.location}</span>
              {rarity && <span className="fish-detail-rarity" style={{ color: rarity.color }}>[ {rarity.label} ]</span>}
            </div>
          </div>
          <button onClick={onClose} className="btn-secondary btn-small">닫기</button>
        </div>
        {fish.description && (
          <p className="fish-detail-desc">{fish.description}</p>
        )}
        {fish.price != null && (
          <div className="fish-detail-stats">
            <div className="fish-stat">
              <span className="fish-stat-label">판매가</span>
              <span className="fish-stat-value">💰 {fish.price}</span>
            </div>
            <div className="fish-stat">
              <span className="fish-stat-label">경험치</span>
              <span className="fish-stat-value">⭐ {fish.exp}</span>
            </div>
            {fish.sizeCm && (
              <div className="fish-stat">
                <span className="fish-stat-label">크기</span>
                <span className="fish-stat-value">📏 {fish.sizeCm}cm</span>
              </div>
            )}
          </div>
        )}
        {(fish.recordMinSize || fish.recordMaxSize) && (
          <div className="fish-detail-records">
            <span className="fish-stat-label">내 기록</span>
            <span> 최소 {fish.recordMinSize}cm / 최대 {fish.recordMaxSize}cm</span>
            {fish.caughtCount && <span className="fish-record-count"> ({fish.caughtCount}마리 낚음)</span>}
          </div>
        )}
      </div>
    </div>
  );
}
