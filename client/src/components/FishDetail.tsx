interface FishInfo {
  key: string;
  name: string;
  emoji: string;
  location: string;
  price?: number | null;
  exp?: number | null;
  description?: string;
  caught?: boolean;
}

const LOCATION_NAMES: Record<string, string> = {
  river: '🏞️ 강',
  lake: '🌊 호수',
  sea: '🌅 바다',
};

export default function FishDetail({ fish, onClose }: { fish: FishInfo; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal fish-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fish-detail-header">
          <span className="fish-detail-emoji">{fish.emoji}</span>
          <div>
            <h2>{fish.name}</h2>
            <span className="fish-detail-location">{LOCATION_NAMES[fish.location] || fish.location}</span>
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
          </div>
        )}
      </div>
    </div>
  );
}
