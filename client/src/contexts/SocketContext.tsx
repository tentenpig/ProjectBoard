import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';

const SERVER_URL = `http://${window.location.hostname}:3001`;

const SocketContext = createContext<Socket | null>(null);

export function useSocket() {
  return useContext(SocketContext);
}

export function SocketProvider({ children }: { children: ReactNode }) {
  const { token, updateUser } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (!token) return;

    const s = io(SERVER_URL, {
      auth: { token },
    });

    s.onAny((event, ...args) => {
      console.log(`[Socket] ${event}`, ...args);
    });

    s.onAnyOutgoing((event, ...args) => {
      console.log(`[Socket >>] ${event}`, ...args);
    });

    s.on('connect', () => {
      console.log('[Socket] Connected:', s.id);
    });

    s.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message);
    });

    s.on('error', (msg) => {
      console.error('[Socket] Server error:', msg);
    });

    s.on('exp:gained', (data: { exp: number; totalExp: number; level: number; currentExp: number; nextLevelExp: number }) => {
      updateUser({ exp: data.totalExp, level: data.level, currentExp: data.currentExp, nextLevelExp: data.nextLevelExp });
    });

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, [token]);

  return (
    <SocketContext.Provider value={socket}>
      {children}
    </SocketContext.Provider>
  );
}
