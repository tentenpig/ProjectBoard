import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

const SocketContext = createContext<Socket | null>(null);

export function useSocket() {
  return useContext(SocketContext);
}

export function SocketProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (!token) return;

    const s = io(SERVER_URL, {
      auth: { token },
    });

    s.on('connect', () => {
      console.log('Socket connected');
    });

    s.on('connect_error', (err) => {
      console.error('Socket connection error:', err.message);
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
