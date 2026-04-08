import { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';

export interface ExpGainedData {
  exp: number;
  totalExp: number;
  reason: string;
  level: number;
}

export function useExpGained(socket: Socket | null): ExpGainedData | null {
  const [data, setData] = useState<ExpGainedData | null>(null);
  const lockedRef = useRef(false);

  useEffect(() => {
    if (!socket) return;
    const handler = (d: ExpGainedData) => {
      if (!lockedRef.current) {
        setData(d);
        lockedRef.current = true; // Lock after first exp event per game
      }
    };
    socket.on('exp:gained', handler);
    return () => { socket.off('exp:gained', handler); };
  }, [socket]);

  return data;
}
