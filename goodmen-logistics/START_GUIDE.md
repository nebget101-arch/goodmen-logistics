# 🚀 Quick Start Guide - Goodmen Logistics

## Current Status

✅ **Backend Server**: Running on http://localhost:3000
⏳ **Frontend**: Ready to install and start

---

## Option 1: Manual Start (Recommended for First Time)

### Step 1: Start Backend (Already Running! ✅)

The backend is already running in your terminal. You should see:
```
🚛 Goodmen Logistics Backend running on http://localhost:3000
📊 API Health: http://localhost:3000/api/health
```

**Test it:** Open http://localhost:3000/api/health in your browser

### Step 2: Install Frontend Dependencies

Open a **NEW terminal window** and run:

```bash
cd /Users/nebyougetaneh/Desktop/SafetyApp/goodmen-logistics/frontend
npm install
```

This will install Angular 17 and all dependencies (~2-3 minutes).

### Step 3: Start Frontend

After installation completes, in the same terminal:

```bash
npm start
```

This will start the Angular dev server on http://localhost:4200

### Step 4: Open Application

Open your browser and navigate to:
```
http://localhost:4200
```

You should see the Goodmen Logistics dashboard! 🎉

---

## Option 2: Using Quick Start Script

```bash
cd /Users/nebyougetaneh/Desktop/SafetyApp/goodmen-logistics
./quick-start.sh
```

Then manually start both servers as described in Option 1.

---

## 🧪 Testing the Application

### 1. Test Backend APIs

Open these URLs in your browser (backend must be running):

**Health Check:**
```
http://localhost:3000/api/health
```

**Dashboard Stats:**
```
http://localhost:3000/api/dashboard/stats
```

**All Drivers:**
```
http://localhost:3000/api/drivers
```

**Compliance Alerts:**
```
http://localhost:3000/api/dashboard/alerts
```

### 2. Test Frontend

Once frontend is running, navigate through:

1. **Dashboard** - http://localhost:4200/dashboard
   - View compliance metrics
   - See real-time alerts
   - Check quick actions

2. **Drivers** - http://localhost:4200/drivers
   - View driver roster
   - Check DQF completeness
   - See medical cert expirations

3. **Vehicles** - http://localhost:4200/vehicles
   - View fleet status
   - Check maintenance schedules
   - See out-of-service vehicles

4. **HOS** - http://localhost:4200/hos
   - View hours of service records
   - Check violations and warnings
   - See driver duty status

5. **Maintenance** - http://localhost:4200/maintenance
   - View work orders
   - Check pending maintenance
   - See maintenance history

6. **Loads** - http://localhost:4200/loads
   - View dispatch board
   - Check active loads
   - See pending assignments

7. **Audit** - http://localhost:4200/audit
   - View compliance summary
   - Export data
   - Check audit trail

---

## 📊 What You'll See

### Dashboard
- 8 real-time compliance metrics
- Color-coded status cards (green=good, orange=warning, red=critical)
- Compliance alerts section
- Quick action buttons

### Driver Management
- Complete driver roster table
- CDL and medical certificate tracking
- DQF completeness percentages
- Expiration warnings (⚠️ icons)
- Clearinghouse status

### Vehicle Fleet
- All vehicles with status
- Mileage and inspection dates
- Preventive maintenance schedules
- Out-of-service indicators

### HOS Tracking
- Daily duty status records
- Hours breakdown (on-duty, driving, off-duty)
- Violation detection
- Warning system

### Maintenance
- Work order list
- Preventive maintenance schedules
- Critical priority items
- Mechanic assignments

### Load Dispatch
- Active and pending loads
- Driver/vehicle assignments
- Route information
- Status tracking

### Audit & Compliance
- Comprehensive compliance reports
- Data export functionality
- Audit trail
- Recommended actions

---

## 🎯 Sample Data Included

The app comes pre-loaded with:

- **3 Drivers**
  - John Smith (95% DQF complete, all compliant)
  - Sarah Johnson (88% DQF complete, approaching HOS limit)
  - Michael Davis (72% DQF complete, med cert expiring)

- **3 Vehicles**
  - TRK-001 (In service, 125k miles)
  - TRK-002 (In service, 98k miles)
  - TRK-003 (Out of service, brake repair needed)

- **HOS Records** with real violation examples
- **Maintenance Records** (completed and pending)
- **Drug/Alcohol Testing** records
- **Active Loads** with assignments
- **Pending Loads** waiting for dispatch

---

## 🔧 Troubleshooting

### Backend Issues

**Problem**: "Cannot find module"
```bash
cd /Users/nebyougetaneh/Desktop/SafetyApp/goodmen-logistics/backend
npm install
node server.js
```

**Problem**: "Port 3000 already in use"
```bash
# Find and kill the process
lsof -ti:3000 | xargs kill -9
# Then restart
node server.js
```

### Frontend Issues

**Problem**: "Angular version mismatch"
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```

**Problem**: "Port 4200 already in use"
```bash
# The Angular CLI will automatically try 4201
# Or specify a different port:
ng serve --port 4300
```

**Problem**: Node version too old for Angular 21
- The project uses Angular 17 which works with Node v18
- No action needed!

---

## 📱 Browser Support

Recommended browsers:
- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)

---

## 🎨 UI Features to Try

1. **Click through navigation** - All 7 modules
2. **Check color-coded alerts** - Red (critical), Orange (warning)
3. **View expiration warnings** - Look for ⚠️ icons
4. **See out-of-service vehicles** - TRK-003
5. **Check HOS violations** - Sarah Johnson's record
6. **Export compliance data** - Audit module
7. **View real-time stats** - Dashboard metrics

---

## 📝 Next Steps After Testing

1. **Customize Mock Data**
   - Edit: `backend/data/mock-data.js`
   - Add more drivers, vehicles, loads

2. **Modify UI Styling**
   - Edit: `frontend/src/styles.css`
   - Customize colors, fonts, layout

3. **Add New Features**
   - Create new components
   - Add new API endpoints
   - Expand functionality

4. **Prepare for Production**
   - Add database (PostgreSQL/MongoDB)
   - Implement authentication
   - Set up deployment

---

## 📚 Documentation Files

- `README.md` - Full project documentation
- `PROJECT_SUMMARY.md` - Complete feature overview
- `API_TESTING.md` - API endpoint testing guide
- `FEATURES_CHECKLIST.md` - All implemented features
- `ARCHITECTURE.md` - System architecture diagrams
- `START_GUIDE.md` - This file

---

## ✅ Verification Checklist

Before you start, verify:

- [ ] Backend running on http://localhost:3000
- [ ] Can access http://localhost:3000/api/health
- [ ] Frontend dependencies installed (`npm install` in frontend/)
- [ ] Frontend server started (`npm start`)
- [ ] Can access http://localhost:4200
- [ ] All navigation links work
- [ ] Data loads from backend
- [ ] No console errors

---

## 🎉 Success Criteria

You'll know it's working when:

✅ Backend shows: "🚛 Goodmen Logistics Backend running"
✅ Frontend shows: "** Angular Live Development Server is listening on localhost:4200 **"
✅ Browser displays the dashboard with 8 stat cards
✅ Navigation works between all 7 modules
✅ Driver table shows 3 drivers
✅ Vehicle table shows 3 vehicles
✅ Compliance alerts appear on dashboard
✅ No red errors in browser console

---

## 🆘 Need Help?

1. **Check terminal output** for error messages
2. **Check browser console** (F12) for JavaScript errors
3. **Verify Node version**: `node --version` (should be v18+)
4. **Verify npm version**: `npm --version` (should be v8+)
5. **Check ports**: Make sure 3000 and 4200 are free

---

## 🚀 You're Ready!

Your Goodmen Logistics application is fully set up and ready to run. 

**Start both servers and enjoy exploring the comprehensive FMCSA compliance platform!** 🚛📊✅

---

**Questions? Check the documentation files or review the code comments!**
