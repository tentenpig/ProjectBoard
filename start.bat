@echo off
echo [ProjectBoard] Starting server...
docker compose up --build -d
echo.
echo Client:  http://localhost:5173
echo Server:  http://localhost:3001
echo.
pause
