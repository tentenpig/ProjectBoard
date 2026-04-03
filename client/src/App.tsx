import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import Login from './pages/Login';
import Register from './pages/Register';
import Lobby from './pages/Lobby';
import Room from './pages/Room';
import Game from './pages/Game';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  return token ? <>{children}</> : <Navigate to="/login" />;
}

function PrivateRoutes() {
  return (
    <SocketProvider>
      <Routes>
        <Route path="/lobby" element={<Lobby />} />
        <Route path="/room/:roomId" element={<Room />} />
        <Route path="/game/:roomId" element={<Game />} />
        <Route path="*" element={<Navigate to="/lobby" />} />
      </Routes>
    </SocketProvider>
  );
}

function AppRoutes() {
  const { token } = useAuth();

  if (!token) {
    return (
      <Routes>
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  return <PrivateRoutes />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
