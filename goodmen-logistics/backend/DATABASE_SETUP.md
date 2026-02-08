# PostgreSQL Database Setup - Quick Start Guide

## 🚀 Quick Setup (5 minutes)

### Step 1: Install PostgreSQL

**macOS:**
```bash
brew install postgresql@15
brew services start postgresql@15
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

**Windows:**
Download from: https://www.postgresql.org/download/windows/

### Step 2: Configure Database Connection

The `.env` file has already been created with default PostgreSQL credentials:

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=goodmen_logistics
DB_USER=postgres
DB_PASSWORD=postgres
```

**⚠️ IMPORTANT:** If your PostgreSQL password is different, update the `DB_PASSWORD` in `.env`

### Step 3: Initialize Database

Run this single command to create database, schema, and insert sample data:

```bash
npm run db:init
```

You should see output like:
```
📡 Connected to PostgreSQL server
✅ Database 'goodmen_logistics' created successfully
✅ Database schema created successfully
✅ Sample data inserted successfully

📊 Database Statistics:
   Drivers: 5
   Vehicles: 5
   HOS Records: 3
   Maintenance Records: 3
   Drug/Alcohol Tests: 3
   Loads: 3
```

### Step 4: Start the Backend Server

```bash
npm start
```

You should see:
```
✅ Database connected successfully
✅ Connected to PostgreSQL database
🚛 Goodmen Logistics Backend running on http://localhost:3000
```

### Step 5: Test the Database Connection

Open your browser or use curl:

```bash
# Get all drivers from database
curl http://localhost:3000/api/db-example/drivers

# Get dashboard statistics
curl http://localhost:3000/api/db-example/dashboard

# Get all loads with driver info
curl http://localhost:3000/api/db-example/loads
```

## ✅ Verification

Check database status anytime:
```bash
npm run db:status
```

## 📚 Database Management Commands

```bash
# Initialize database (first time setup)
npm run db:init

# Check database status
npm run db:status

# Reset database (WARNING: deletes all data)
npm run db:reset

# Run schema only
npm run db:schema

# Run seed data only
npm run db:seed
```

## 🗂️ Database Schema Overview

### Tables Created:
- **drivers** - Driver information and compliance
- **vehicles** - Fleet management
- **hos_records** - Hours of Service daily records
- **hos_logs** - Detailed HOS log entries
- **maintenance_records** - Maintenance history
- **drug_alcohol_tests** - Testing records
- **loads** - Dispatch/load management
- **audit_logs** - System audit trail

### Sample Data Included:
- 5 Drivers (John Smith, Sarah Johnson, Michael Davis, Emily Wilson, Robert Brown)
- 5 Vehicles (TRK-001 through TRK-005)
- 3 HOS Records with detailed logs
- 3 Maintenance Records
- 3 Drug/Alcohol Test Results
- 3 Loads (2 in-transit, 1 pending)

## 🔧 Database Connection in Your Code

The database connection is already configured. Use it in your routes:

```javascript
const { query } = require('../config/database');

// Example: Get all drivers
const result = await query('SELECT * FROM drivers WHERE status = $1', ['active']);
console.log(result.rows);
```

### Example Routes Available:

- `GET /api/db-example/drivers` - Get all drivers
- `GET /api/db-example/drivers/:id` - Get single driver
- `GET /api/db-example/vehicles` - Get all vehicles
- `GET /api/db-example/loads` - Get loads with driver/vehicle info
- `GET /api/db-example/dashboard` - Get dashboard statistics
- `POST /api/db-example/drivers` - Create new driver
- `PUT /api/db-example/drivers/:id` - Update driver
- `DELETE /api/db-example/drivers/:id` - Delete driver

## 🐛 Troubleshooting

### Error: "password authentication failed"
**Solution:** Update `DB_PASSWORD` in `.env` with your PostgreSQL password

### Error: "database does not exist"
**Solution:** Run `npm run db:init`

### Error: "connection refused"
**Solution:** 
- Check if PostgreSQL is running: `brew services list` (macOS)
- Start PostgreSQL: `brew services start postgresql@15`

### Can't connect to PostgreSQL
**Check PostgreSQL is running:**
```bash
# macOS
brew services list

# Linux
sudo systemctl status postgresql
```

## 🔐 Security Notes

- The `.env` file is already in `.gitignore` (your credentials are safe)
- Change default password for production
- Never commit `.env` to version control
- Use environment variables in production

## 📊 Accessing the Database

### Using psql (PostgreSQL CLI):
```bash
psql -U postgres -d goodmen_logistics
```

Common commands:
```sql
\dt          -- List all tables
\d drivers   -- Describe drivers table
SELECT * FROM drivers LIMIT 5;
\q           -- Quit
```

### Using pgAdmin (GUI):
1. Download from: https://www.pgadmin.org/
2. Create new server connection
3. Use credentials from `.env`

## 🎯 Next Steps

1. ✅ Database is set up and running
2. ✅ Sample data is loaded
3. ✅ Example routes are available

**Now you can:**
- Modify existing routes to use the database
- Create new tables as needed
- Build your API endpoints
- Connect your frontend to the database-backed API

## 📖 Additional Resources

- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [node-postgres Documentation](https://node-postgres.com/)
- [Database README](./database/README.md) - Detailed documentation

---

**🎉 Database setup complete! Your PostgreSQL database is ready to use.**
