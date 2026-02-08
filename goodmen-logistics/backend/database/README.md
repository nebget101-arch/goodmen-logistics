# Goodmen Logistics - Database Setup Guide

## PostgreSQL Database Configuration

This guide will help you set up the PostgreSQL database for the Goodmen Logistics application.

## Prerequisites

- PostgreSQL 12 or higher installed on your system
- Node.js and npm installed

### Installing PostgreSQL

#### macOS
```bash
# Using Homebrew
brew install postgresql@15
brew services start postgresql@15
```

#### Ubuntu/Debian
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

#### Windows
Download and install from: https://www.postgresql.org/download/windows/

## Quick Start

### 1. Configure Environment Variables

Copy the example environment file and update with your PostgreSQL credentials:

```bash
cp .env.example .env
```

Edit `.env` and update these values:
```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=goodmen_logistics
DB_USER=postgres
DB_PASSWORD=your_password_here
```

### 2. Initialize Database

Run the initialization script to create the database, schema, and seed data:

```bash
npm run db:init
```

This will:
- Create the `goodmen_logistics` database
- Set up all tables with proper relationships
- Insert sample data (drivers, vehicles, HOS records, etc.)

### 3. Verify Installation

Check that the database was created successfully:

```bash
npm run db:status
```

Or connect directly with psql:
```bash
psql -U postgres -d goodmen_logistics
```

## Database Schema

### Tables

1. **drivers** - Driver information and compliance data
2. **vehicles** - Vehicle fleet management
3. **hos_records** - Hours of Service daily records
4. **hos_logs** - Detailed HOS log entries
5. **maintenance_records** - Vehicle maintenance history
6. **drug_alcohol_tests** - Drug and alcohol testing records
7. **loads** - Load/dispatch information
8. **audit_logs** - System audit trail

### Key Features

- UUID primary keys for all tables
- Foreign key relationships with CASCADE options
- Automatic `updated_at` timestamp triggers
- Indexed columns for optimal query performance
- JSONB support for flexible audit logging
- Array data types for endorsements and violations

## Available NPM Scripts

```bash
# Initialize database (create + schema + seed)
npm run db:init

# Reset database (drop and recreate everything)
npm run db:reset

# Run schema only (no seed data)
npm run db:schema

# Run seed data only
npm run db:seed

# Check database status
npm run db:status
```

## Sample Data

The seed script includes:
- 5 Drivers with various compliance statuses
- 5 Vehicles with different service statuses
- HOS records with detailed logs
- Maintenance records (completed and pending)
- Drug & Alcohol test results
- Active and pending loads

## Connecting to the Database

### Using psql CLI
```bash
psql -U postgres -d goodmen_logistics
```

### Using pgAdmin
1. Open pgAdmin
2. Create new server connection
3. Use credentials from `.env` file

### Using Node.js (in the application)
```javascript
const { query } = require('./config/database');

// Example query
const result = await query('SELECT * FROM drivers WHERE status = $1', ['active']);
```

## Troubleshooting

### Error: "password authentication failed"
- Verify PostgreSQL user password
- Update `.env` with correct credentials
- Check `pg_hba.conf` for authentication settings

### Error: "database does not exist"
- Run `npm run db:init` to create the database
- Ensure PostgreSQL service is running

### Error: "connection refused"
- Check if PostgreSQL is running: `brew services list` (macOS)
- Verify port 5432 is not blocked by firewall
- Check DB_HOST in `.env` is correct

## Database Maintenance

### Backup Database
```bash
pg_dump -U postgres goodmen_logistics > backup.sql
```

### Restore Database
```bash
psql -U postgres goodmen_logistics < backup.sql
```

### View Table Sizes
```sql
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

## Security Notes

- Never commit `.env` file to version control
- Use strong passwords for production databases
- Implement connection pooling for production (already configured)
- Enable SSL for production database connections
- Regular backup schedule recommended

## Production Considerations

For production deployment:
1. Use managed PostgreSQL service (AWS RDS, Azure Database, etc.)
2. Enable SSL/TLS connections
3. Set up automated backups
4. Implement proper access controls
5. Use connection pooling (already configured)
6. Monitor query performance
7. Set up read replicas for scaling

## Additional Resources

- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [node-postgres (pg) Documentation](https://node-postgres.com/)
- [SQL Best Practices](https://www.postgresql.org/docs/current/sql.html)
