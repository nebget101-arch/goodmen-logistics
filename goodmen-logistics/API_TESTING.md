# API Testing Guide

## Quick API Tests (Backend is Running)

Open a new terminal and test these endpoints:

### 1. Health Check
```bash
curl http://localhost:3000/api/health
```

### 2. Dashboard Stats
```bash
curl http://localhost:3000/api/dashboard/stats
```

### 3. Get All Drivers
```bash
curl http://localhost:3000/api/drivers
```

### 4. Get All Vehicles
```bash
curl http://localhost:3000/api/vehicles
```

### 5. Get HOS Records
```bash
curl http://localhost:3000/api/hos
```

### 6. Get Compliance Alerts
```bash
curl http://localhost:3000/api/dashboard/alerts
```

### 7. Get Loads
```bash
curl http://localhost:3000/api/loads
```

### 8. Get Maintenance Records
```bash
curl http://localhost:3000/api/maintenance
```

### 9. Get Compliance Summary
```bash
curl http://localhost:3000/api/audit/compliance-summary
```

### 10. Export DQF Data
```bash
curl http://localhost:3000/api/audit/export/dqf
```

## Or Use Your Browser

Simply open these URLs in your browser:

- http://localhost:3000/api/health
- http://localhost:3000/api/dashboard/stats
- http://localhost:3000/api/drivers
- http://localhost:3000/api/vehicles
- http://localhost:3000/api/hos
- http://localhost:3000/api/loads
- http://localhost:3000/api/maintenance
- http://localhost:3000/api/audit/compliance-summary

## Frontend Access (After Installing)

Once you run the frontend (`cd frontend && npm install && npm start`):

Open: **http://localhost:4200**

You'll see:
- Dashboard with real-time stats
- Driver management
- Vehicle fleet
- HOS tracking
- Maintenance records
- Load dispatch
- Audit reports

All pulling data from the backend APIs! 🚀
