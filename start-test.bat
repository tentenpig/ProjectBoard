@echo off
chcp 65001 >nul
echo [ProjectBoard TEST] Starting test server...
docker compose -f docker-compose.test.yml up --build -d
echo.
echo Test Client:  http://localhost:5174
echo Test Server:  http://localhost:3002
echo.
pause
