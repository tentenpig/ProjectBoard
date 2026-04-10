import FishImage from './FishImage';

interface FishInfo {
  key: string;
  name: string;
  emoji: string;
  location: string;
  weight?: number;
  grade?: string;
  price?: number | null;
  exp?: number | null;
  description?: string;
  caught?: boolean;
  sizeCm?: number;
  minSize?: number;
  maxSize?: number;
  recordMinSize?: number | null;
  recordMaxSize?: number | null;
  caughtCount?: number;
}

const LOCATION_NAMES: Record<string, string> = {
  river: '🏞️ 강',
  lake: '🌊 호수',
  sea: '🌅 바다',
};

const GRADE_INFO: Record<string, { label: string; color: string }> = {
  mythical: { label: '신화', color: '#ff4500' },
  legendary: { label: '전설', color: '#c8a200' },
  rare: { label: '희귀', color: '#9b59b6' },
  uncommon: { label: '보통', color: '#2980b9' },
  common: { label: '흔함', color: '#27ae60' },
};

export function getSizeLabel(sizeCm: number, minSize?: number, maxSize?: number): { label: string; color: string } {
  if (!minSize || !maxSize || minSize === maxSize) return { label: '', color: '' };
  if (sizeCm >= maxSize) return { label: '최대', color: '#ff4500' };
  const ratio = (sizeCm - minSize) / (maxSize - minSize);
  if (ratio >= 0.8) return { label: '대', color: '#c8a200' };
  if (ratio >= 0.4) return { label: '중', color: '#2980b9' };
  return { label: '소', color: '#27ae60' };
}

export default function FishDetail({ fish, onClose }: { fish: FishInfo; onClose: () => void }) {
  const rarity = fish.grade ? GRADE_INFO[fish.grade] || null : null;
  const sizeInfo = fish.sizeCm ? getSizeLabel(fish.sizeCm, fish.minSize, fish.maxSize) : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal fish-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fish-detail-header">
          <FishImage fishKey={fish.key} location={fish.location} emoji={fish.emoji} className="fish-detail-emoji" size={80} />
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
                {sizeInfo && sizeInfo.label && (
                  <span className="fish-size-grade" style={{ color: sizeInfo.color }}>{sizeInfo.label}</span>
                )}
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
