#!/bin/bash
# HeatScape — Start both backend and frontend

echo "🔥 Starting HeatScape..."

# Start backend
echo "📡 Starting FastAPI backend on port 8000..."
cd backend
pip install -r requirements.txt --break-system-packages -q 2>/dev/null
uvicorn app.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
cd ..

# Wait for backend to be ready
sleep 3

# Start frontend
echo "🗺️  Starting React frontend on port 5173..."
cd frontend
npm install -q 2>/dev/null
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "✅ HeatScape is running!"
echo "   Frontend: http://localhost:5173"
echo "   Backend:  http://localhost:8000"
echo "   API docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop both servers."

# Trap Ctrl+C to kill both
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM
wait
