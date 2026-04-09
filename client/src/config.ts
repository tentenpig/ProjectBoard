// Map client port to server port
const PORT_MAP: Record<string, string> = {
  '5173': '3001', // production
  '5174': '3002', // test
};

const clientPort = window.location.port || '5173';
const serverPort = PORT_MAP[clientPort] || '3001';

export const SERVER_URL = `http://${window.location.hostname}:${serverPort}`;
