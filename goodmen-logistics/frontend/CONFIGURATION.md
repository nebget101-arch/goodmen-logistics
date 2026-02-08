# Frontend Configuration Guide

## API Connection Setup

Your frontend is now configured to connect to the **hosted backend** at:
```
https://safetyapp-ln58.onrender.com/api
```

## Environment Files

### Development (`src/environments/environment.ts`)
```typescript
export const environment = {
  production: false,
  apiUrl: 'https://safetyapp-ln58.onrender.com/api'  // Hosted backend
};
```

### Production (`src/environments/environment.prod.ts`)
```typescript
export const environment = {
  production: true,
  apiUrl: 'https://safetyapp-ln58.onrender.com/api'  // Hosted backend
};
```

## How to Switch Between Backends

### Option 1: Use Hosted Backend (Current Setup)
No changes needed! Just run:
```bash
cd frontend
npm start
```

### Option 2: Use Local Backend
1. Start your local backend server:
   ```bash
   cd backend
   npm start
   ```

2. Update `src/environments/environment.ts`:
   ```typescript
   export const environment = {
     production: false,
     apiUrl: 'http://localhost:3000/api'  // Local backend
   };
   ```

3. Start frontend:
   ```bash
   cd frontend
   npm start
   ```

## Testing the Connection

Once the frontend is running at `http://localhost:4200`, you should see:
- ✅ Dashboard with stats loading from the hosted API
- ✅ Vehicle list populated with data
- ✅ All API endpoints working

### Quick Test
Open your browser console (F12) and check for:
- No CORS errors
- Successful API calls to `https://safetyapp-ln58.onrender.com/api/*`
- Data loading in the UI

## Troubleshooting

### CORS Errors
The hosted backend already has CORS enabled. If you see CORS errors:
1. Check that the backend is running: `https://safetyapp-ln58.onrender.com/api/health`
2. Verify the URL in environment.ts is correct
3. Clear browser cache and reload

### No Data Loading
1. Check browser console for errors
2. Verify backend is running: `https://safetyapp-ln58.onrender.com/api/dashboard/stats`
3. Check Network tab in DevTools

### Build Errors
If you get compilation errors after changes:
1. Stop the dev server (Ctrl+C)
2. Delete `node_modules/.cache`
3. Restart: `npm start`
