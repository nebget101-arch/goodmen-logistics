# Goodmen Logistics - FMCSA Compliance & Operations Platform

A comprehensive logistics management application designed for trucking/carrier companies to operate in compliance with FMCSA/FMCSRs (U.S. Federal Motor Carrier Safety Administration regulations).

## 🚛 Overview

This application provides centralized management for:
- **Driver Qualification Files (DQF)** - Complete digital driver records with compliance tracking
- **Hours of Service (HOS)** - ELD integration and violation monitoring
- **Vehicle Maintenance** - Preventive maintenance tracking and repair records
- **Drug & Alcohol Testing** - Secure record keeping and clearinghouse integration
- **Load Dispatch** - Compliance-aware load assignment and tracking
- **Audit Readiness** - Export capabilities and compliance reporting

## 🏗️ Architecture

### Backend (Node.js + Express)
- RESTful API with mock data
- Located in `/backend` directory
- Port: 3000

### Frontend (Angular)
- Modern Angular application
- Located in `/frontend` directory
- Port: 4200 (default)

## 📋 Prerequisites

- **Node.js**: v18.x or higher (v20+ recommended for Angular 17)
- **npm**: v8.x or higher

## 🚀 Getting Started

### 1. Install Backend Dependencies

```bash
cd backend
npm install
```

### 2. Install Frontend Dependencies

```bash
cd frontend
npm install
```

### 3. Start the Backend Server

```bash
cd backend
npm start
```

The API will be available at `http://localhost:3000`

Test the API: `http://localhost:3000/api/health`

### 4. Start the Frontend Application

```bash
cd frontend
npm start
```

The application will be available at `http://localhost:4200`

**Note**: The frontend is configured to connect to the hosted backend API at `https://safetyapp-ln58.onrender.com/api`. To use a local backend instead, update `src/environments/environment.ts` with `apiUrl: 'http://localhost:3000/api'`.

## 🔧 Configuration

### Frontend API Configuration

The frontend uses environment files to configure the backend API URL:

- **Development**: `src/environments/environment.ts`
  - Default: `https://safetyapp-ln58.onrender.com/api` (hosted backend)
  - For local backend: Change to `http://localhost:3000/api`

- **Production**: `src/environments/environment.prod.ts`
  - Points to: `https://safetyapp-ln58.onrender.com/api`

To switch between local and hosted backend, edit the `apiUrl` in the environment file.

## 📚 API Endpoints

### Dashboard
- `GET /api/dashboard/stats` - Dashboard statistics
- `GET /api/dashboard/alerts` - Compliance alerts

### Drivers
- `GET /api/drivers` - List all drivers
- `GET /api/drivers/:id` - Get driver by ID
- `POST /api/drivers` - Create new driver
- `PUT /api/drivers/:id` - Update driver
- `DELETE /api/drivers/:id` - Delete driver
- `GET /api/drivers/compliance/issues` - Get drivers with compliance issues

### Vehicles
- `GET /api/vehicles` - List all vehicles
- `GET /api/vehicles/:id` - Get vehicle by ID
- `POST /api/vehicles` - Create new vehicle
- `PUT /api/vehicles/:id` - Update vehicle
- `DELETE /api/vehicles/:id` - Delete vehicle
- `GET /api/vehicles/maintenance/needed` - Get vehicles needing maintenance

### Hours of Service (HOS)
- `GET /api/hos` - List all HOS records
- `GET /api/hos/driver/:driverId` - Get HOS records by driver
- `GET /api/hos/date/:date` - Get HOS records by date
- `GET /api/hos/violations` - Get HOS violations
- `POST /api/hos` - Create HOS record

### Maintenance
- `GET /api/maintenance` - List all maintenance records
- `GET /api/maintenance/vehicle/:vehicleId` - Get maintenance by vehicle
- `GET /api/maintenance/status/pending` - Get pending maintenance
- `POST /api/maintenance` - Create maintenance record
- `PUT /api/maintenance/:id` - Update maintenance record

### Drug & Alcohol
- `GET /api/drug-alcohol` - List all records (restricted)
- `GET /api/drug-alcohol/driver/:driverId` - Get records by driver
- `GET /api/drug-alcohol/summary` - Get anonymized summary
- `POST /api/drug-alcohol` - Create test record

### Loads
- `GET /api/loads` - List all loads
- `GET /api/loads/:id` - Get load by ID
- `GET /api/loads/status/:status` - Get loads by status
- `GET /api/loads/driver/:driverId` - Get loads by driver
- `POST /api/loads` - Create new load
- `PUT /api/loads/:id` - Update load
- `DELETE /api/loads/:id` - Delete load

### Audit
- `GET /api/audit/trail` - Get audit trail
- `GET /api/audit/compliance-summary` - Get compliance summary report
- `GET /api/audit/export/:category` - Export data by category

## 🎯 Key Features

### Driver Qualification File (DQF) Management
- Digital driver profiles with CDL tracking
- Medical certificate expiration alerts
- DQF completeness scoring
- Retention: Employment + 3 years (49 CFR 391.51)

### Hours of Service (HOS) Compliance
- ELD integration ready
- Violation detection and warnings
- 6-month retention (49 CFR 395.8)
- Driver 7-day log availability

### Vehicle Maintenance
- Preventive maintenance scheduling
- Out-of-service status tracking
- DVIR (Driver Vehicle Inspection Report) support
- 1-year + 6-month post-disposal retention (49 CFR 396.3)

### Drug & Alcohol Testing
- Secure, role-based access
- Clearinghouse query tracking
- Test record management
- Retention per 49 CFR 382.401

### Audit-Ready Reporting
- Compliance summary reports
- Data export by category (DQF, HOS, Maintenance, Drug/Alcohol)
- Immutable audit trail
- Real-time compliance alerts

## 📊 Mock Data

The application includes comprehensive mock data:
- 3 drivers with varying compliance statuses
- 3 vehicles (including 1 out-of-service)
- HOS records with violations and warnings
- Maintenance records (completed and pending)
- Drug/alcohol testing records
- Active and pending loads

## 🔐 Security Considerations

**Important**: This is a demo application with mock data. For production use:

1. Implement proper authentication (OAuth 2.0, JWT)
2. Add role-based access control (RBAC)
3. Encrypt sensitive data at rest and in transit
4. Implement audit logging for all changes
5. Secure drug/alcohol records with restricted access
6. Add rate limiting and input validation
7. Use HTTPS in production
8. Implement data backup and disaster recovery

## 🏛️ FMCSA Compliance

This application is designed to support compliance with:
- **49 CFR Part 391** - Driver Qualification
- **49 CFR Part 395** - Hours of Service
- **49 CFR Part 396** - Vehicle Maintenance
- **49 CFR Part 382** - Drug & Alcohol Testing
- **49 CFR Part 390** - Record Retention

**Disclaimer**: This software is a tool to assist with compliance but does not guarantee FMCSA compliance. Consult with legal and compliance professionals for your specific requirements.

## 🛠️ Development

### Backend Development
```bash
cd backend
npm run dev  # Uses nodemon for auto-restart
```

### Frontend Development
```bash
cd frontend
npm start  # Angular dev server with live reload
```

## 📝 Next Steps for Production

1. **Database Integration**
   - Replace mock data with PostgreSQL/MongoDB
   - Implement proper data models and migrations
   
2. **Authentication & Authorization**
   - Add user authentication
   - Implement RBAC for different roles
   
3. **ELD Integration**
   - Connect to registered ELD providers
   - Implement real-time HOS monitoring
   
4. **Document Management**
   - Add file upload capabilities
   - Implement document versioning
   - Add e-signature support
   
5. **Notifications**
   - Email/SMS alerts for expirations
   - Push notifications for violations
   
6. **Advanced Reporting**
   - PDF report generation
   - Custom report builder
   - Data analytics dashboard

## 📄 License

This project is for demonstration purposes.

## 👥 Support

For questions or support, please contact your development team.

---

**Built with ❤️ for the trucking industry**
