import { useState } from 'react';

interface Props {
  fishKey: string;
  location: string;
  emoji: string;
  alt?: string;
  className?: string;
  size?: number;
}

/**
 * Renders /fish/{location}/{fishKey}.png with emoji fallback on load error.
 * Used in inventory, encyclopedia, shop sell list, and FishDetail.
 * Chat/log views keep using emoji directly.
 */
export default function FishImage({ fishKey, location, emoji, alt, className, size }: Props) {
  const [failed, setFailed] = useState(false);

  if (failed || !fishKey || !location) {
    return <span className={className} style={size ? { fontSize: size } : undefined}>{emoji}</span>;
  }

  return (
    <img
      src={`/fish/${location}/${fishKey}.png`}
      alt={alt || fishKey}
      className={className}
      style={size ? { width: size, height: size, objectFit: 'contain' } : undefined}
      onError={() => setFailed(true)}
      draggable={false}
    />
  );
}
