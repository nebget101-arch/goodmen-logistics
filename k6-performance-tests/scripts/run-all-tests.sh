#!/bin/bash

# Enterprise K6 Performance Test Suite Runner
# Runs all performance tests and generates consolidated report

echo "🚀 Starting Goodmen Logistics Performance Test Suite"
echo "=================================================="

# Create reports directory
mkdir -p reports

# Set base URL
export BASE_URL=${BASE_URL:-"https://safetyapp-ln58.onrender.com"}

echo "📊 Target: $BASE_URL"
echo ""

# Run Smoke Test
echo "1️⃣  Running Smoke Test..."
k6 run --out json=reports/smoke-raw.json tests/smoke.test.js
if [ $? -eq 0 ]; then
  echo "✅ Smoke Test: PASSED"
else
  echo "❌ Smoke Test: FAILED"
  exit 1
fi
echo ""

# Run Load Test
echo "2️⃣  Running Load Test..."
k6 run --out json=reports/load-raw.json tests/load.test.js
if [ $? -eq 0 ]; then
  echo "✅ Load Test: PASSED"
else
  echo "❌ Load Test: FAILED (continuing...)"
fi
echo ""

# Run Stress Test
echo "3️⃣  Running Stress Test..."
k6 run --out json=reports/stress-raw.json tests/stress.test.js
if [ $? -eq 0 ]; then
  echo "✅ Stress Test: PASSED"
else
  echo "❌ Stress Test: FAILED (expected under extreme load)"
fi
echo ""

# Optional: Run Spike Test
read -p "Run Spike Test? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo "4️⃣  Running Spike Test..."
  k6 run --out json=reports/spike-raw.json tests/spike.test.js
  echo "✅ Spike Test: COMPLETED"
  echo ""
fi

echo "=================================================="
echo "✅ Performance Test Suite Completed!"
echo "📁 Reports saved in: ./reports/"
echo ""
echo "Next steps:"
echo "  1. Review reports in ./reports/ directory"
echo "  2. Run: npm run report (to generate consolidated report)"
echo "  3. Post results to Confluence using MCP server"
echo "=================================================="
