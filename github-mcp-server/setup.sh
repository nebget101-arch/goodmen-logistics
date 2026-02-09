#!/bin/bash

echo "🚀 GitHub Actions MCP Server Setup"
echo "=================================="
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "⚠️  Please edit .env file with your GitHub credentials"
    echo ""
    echo "You need:"
    echo "1. GitHub Personal Access Token (with 'repo' and 'workflow' scopes)"
    echo "   Create at: https://github.com/settings/tokens/new"
    echo ""
    echo "2. Your GitHub username/org and repository name"
    echo ""
    read -p "Press Enter to open .env file for editing..."
    
    if command -v code &> /dev/null; then
        code .env
    elif command -v nano &> /dev/null; then
        nano .env
    elif command -v vi &> /dev/null; then
        vi .env
    else
        echo "Please manually edit the .env file"
    fi
else
    echo "✅ .env file already exists"
fi

echo ""
echo "📦 Installing dependencies..."
npm install

echo ""
echo "🔨 Building TypeScript..."
npm run build

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Ensure your .env file has valid GitHub credentials"
echo "2. Add this server to your Claude Desktop config:"
echo ""
echo '   {
     "mcpServers": {
       "github-actions": {
         "command": "node",
         "args": ["'$(pwd)'/dist/index.js"]
       }
     }
   }'
echo ""
echo "3. Restart Claude Desktop"
echo ""
echo "🎉 You'll then be able to trigger and monitor GitHub tests from Claude!"
