import { useState, useEffect } from 'react';
import { Socket } from 'socket.io-client';

export interface ExpGainedData {
  exp: number;
  totalExp: number;
  reason: string;
  level: number;
}

export function useExpGained(socket: Socket | null): ExpGainedData | null {
  const [data, setData] = useState<ExpGainedData | null>(null);

  useEffect(() => {
    if (!socket) return;
    const handler = (d: ExpGainedData) => setData(d);
    socket.on('exp:gained', handler);
    return () => { socket.off('exp:gained', handler); };
  }, [socket]);

  return data;
}
