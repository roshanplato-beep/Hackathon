@echo off
REM HeatScape - start backend and frontend in separate windows

echo Starting HeatScape...

if not exist "backend\.env" (
  echo.
  echo   NOTE: backend\.env not found.
  echo   Copy backend\.env.example to backend\.env and add your API keys.
  echo   The globe and thermal layer work without keys; AI diagnosis and
  echo   live weather fall back to computed values.
  echo.
)

echo Installing backend dependencies...
pushd backend
pip install -r requirements.txt -q
start "HeatScape API" cmd /k python -m uvicorn app.main:app --reload --port 8000
popd

timeout /t 3 /nobreak >nul

echo Installing frontend dependencies...
pushd frontend
call npm install --silent
start "HeatScape UI" cmd /k npm run dev
popd

echo.
echo HeatScape is starting in two new windows.
echo    Frontend: http://localhost:5173
echo    Backend:  http://localhost:8000
echo    API docs: http://localhost:8000/docs
echo.
echo Close those windows to stop the servers.
