#!/bin/bash

# Dynatrace Quick Start Script
# This script helps you quickly set up Dynatrace monitoring

echo "🚀 Dynatrace Integration Setup"
echo "================================"
echo ""

# Check if we're in the right directory
if [ ! -f "backend/package.json" ]; then
    echo "❌ Error: Please run this script from the goodmen-logistics root directory"
    exit 1
fi

# Install backend dependencies
echo "📦 Installing Dynatrace OneAgent SDK..."
cd backend
npm install @dynatrace/oneagent-sdk --save
cd ..

echo ""
echo "✅ Dynatrace SDK installed successfully!"
echo ""
echo "📝 Next Steps:"
echo "1. Get your Dynatrace credentials:"
echo "   - Environment URL: https://YOUR_ENV_ID.live.dynatrace.com"
echo "   - API Token: Settings > Integration > Dynatrace API"
echo "   - PaaS Token: Settings > Integration > Platform as a Service"
echo "   - Application ID: Applications & Microservices > Frontend > Your App"
echo ""
echo "2. Configure backend:"
echo "   - Copy: cp backend/.env.dynatrace backend/.env.dynatrace.local"
echo "   - Edit: backend/.env.dynatrace.local with your credentials"
echo ""
echo "3. Configure frontend:"
echo "   - Edit: frontend/src/dynatrace-config.ts"
echo "   - Update: environmentId and applicationId"
echo "   - Uncomment script tag in: frontend/src/index.html"
echo ""
echo "4. Start the application:"
echo "   - Backend: cd backend && npm start"
echo "   - Frontend: cd frontend && npm start"
echo ""
echo "📚 For detailed instructions, see: DYNATRACE_SETUP.md"
echo ""
