@echo off
chcp 65001 >nul
echo [ProjectBoard TEST] Stopping test server...
docker compose -f docker-compose.test.yml down
echo.
echo Test server stopped.
pause
