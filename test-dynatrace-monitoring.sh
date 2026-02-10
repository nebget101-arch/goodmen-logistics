#!/bin/bash

echo "🔍 Testing Dynatrace Monitoring Setup"
echo "======================================"
echo ""

# 1. Check if Dynatrace is enabled
echo "1️⃣ Checking if Dynatrace is enabled..."
HEALTH=$(curl -s https://safetyapp-ln58.onrender.com/api/health)
echo "$HEALTH"
echo ""

# 2. Make some test requests to generate data
echo "2️⃣ Generating test traffic..."
curl -s https://safetyapp-ln58.onrender.com/api/drivers > /dev/null && echo "✅ GET /api/drivers"
curl -s https://safetyapp-ln58.onrender.com/api/vehicles > /dev/null && echo "✅ GET /api/vehicles"
curl -s https://safetyapp-ln58.onrender.com/api/dashboard/stats > /dev/null && echo "✅ GET /api/dashboard/stats"
echo ""

# 3. Trigger test errors
echo "3️⃣ Generating test errors for Dynatrace..."
curl -s "https://safetyapp-ln58.onrender.com/api/test-error?type=database" > /dev/null && echo "✅ Database error test"
curl -s "https://safetyapp-ln58.onrender.com/api/test-error?type=timeout" > /dev/null && echo "✅ Timeout error test"
curl -s "https://safetyapp-ln58.onrender.com/api/test-error?type=validation" > /dev/null && echo "✅ Validation error test"
echo ""

# 4. Generate some load
echo "4️⃣ Generating load (20 requests)..."
for i in {1..20}; do
  curl -s https://safetyapp-ln58.onrender.com/api/health > /dev/null &
done
wait
echo "✅ Load test complete"
echo ""

echo "======================================"
echo "✅ Test traffic generated!"
echo ""
echo "📊 Now check Dynatrace:"
echo "   1. Go to: https://muz70888.live.dynatrace.com"
echo "   2. Navigate to: Services"
echo "   3. Look for: SafetyApp-Backend"
echo "   4. Navigate to: Logs"
echo "   5. Filter by: dt.source=\"SafetyApp-Backend\""
echo "   6. Navigate to: Metrics"
echo "   7. Search for: custom.http.request.duration"
echo ""
echo "⏱️  Wait 2-3 minutes for data to appear in Dynatrace"
