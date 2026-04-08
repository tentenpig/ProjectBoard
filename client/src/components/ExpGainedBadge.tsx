import { ExpGainedData } from '../hooks/useExpGained';

export default function ExpGainedBadge({ data }: { data: ExpGainedData | null }) {
  if (!data || data.exp <= 0) return null;

  return (
    <div className="exp-gained-badge">
      <span className="exp-gained-amount">+{data.exp} EXP</span>
      <span className="exp-gained-reason">{data.reason}</span>
    </div>
  );
}
