import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import { ThemeProvider } from './contexts/ThemeContext';
import Login from './pages/Login';
import Lobby from './pages/Lobby';
import Room from './pages/Room';
import Game from './pages/Game';
import Ranking from './pages/Ranking';

function AppRoutes() {
  const { token } = useAuth();

  return (
    <Routes>
      {!token ? (
        <Route path="*" element={<Login />} />
      ) : (
        <>
          <Route path="/lobby" element={<Lobby />} />
          <Route path="/ranking" element={<Ranking />} />
          <Route path="/room/:roomId" element={<Room />} />
          <Route path="/game/:roomId" element={<Game />} />
          <Route path="*" element={<Navigate to="/lobby" />} />
        </>
      )}
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SocketProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </SocketProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
