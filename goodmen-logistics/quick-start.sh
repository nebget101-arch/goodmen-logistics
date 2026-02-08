#!/bin/bash

echo "🚛 Goodmen Logistics - Quick Start Script"
echo "=========================================="
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null
then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

echo "✅ Node.js version: $(node --version)"
echo ""

# Install backend dependencies
echo "📦 Installing backend dependencies..."
cd backend
npm install
echo ""

# Install frontend dependencies
echo "📦 Installing frontend dependencies..."
cd ../frontend
npm install
echo ""

echo "✅ Installation complete!"
echo ""
echo "To start the application:"
echo "  1. Backend:  cd backend && npm start"
echo "  2. Frontend: cd frontend && npm start"
echo ""
echo "Then open http://localhost:4200 in your browser"
