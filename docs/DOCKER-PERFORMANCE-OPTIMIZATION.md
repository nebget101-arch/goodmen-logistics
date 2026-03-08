# Docker Performance Optimization Guide

**Problem:** Docker Compose taking forever to start (5-10+ minutes)

---

## 🔴 Root Causes Identified

### 1. **Inefficient Dockerfile** (PRIMARY ISSUE)
- Every service copies entire `backend/` folder
- Each service runs `npm install` independently
- **10 services × npm install = 10× slower**
- No layer caching between services

### 2. **Sequential Dependencies**
- Gateway waits for ALL 7 services
- Services start one after another (sequential)
- No health checks to verify readiness

### 3. **Large Volume Mounts**
- Mounting entire `./backend` to every container
- On macOS, volume mounts have performance overhead
- `node_modules` syncing is slow

---

## ✅ Solutions Provided

### **Option 1: Use Optimized Docker Compose (RECOMMENDED)**

**File created:** `docker-compose.fast.yml`

**Improvements:**
- ✅ Removed sequential dependencies (parallel startup)
- ✅ Added health checks
- ✅ Optimized volume mounts (only mount what's needed)
- ✅ Auto-restart on failure

**Usage:**
```bash
# Stop current containers
docker compose down

# Start with optimized config
docker compose -f docker-compose.fast.yml up

# Or use the helper script
./docker-quick-start.sh
# Choose option 2 (Fast)
```

**Expected speedup:** 2-3x faster (2-3 minutes instead of 10)

---

### **Option 2: Start Only Backend Services**

**Skip frontend** if you're only testing APIs:

```bash
./docker-quick-start.sh
# Choose option 3 (Minimal)
```

Or manually:
```bash
docker compose up -d \
    gateway \
    reporting-service \
    auth-users-service \
    drivers-compliance-service \
    vehicles-maintenance-service \
    logistics-service \
    inventory-service \
    ai-service
```

**Expected speedup:** 50% faster (skip frontend build)

---

### **Option 3: Start Single Service**

**For development** on one service:

```bash
./docker-quick-start.sh
# Choose option 4 (Single Service)
# Enter service name, e.g., "logistics-service"
```

Or manually:
```bash
docker compose up logistics-service
```

**Expected speedup:** 90% faster (only builds/starts one service)

---

### **Option 4: Optimize Dockerfile (LONG-TERM FIX)**

**File created:** `backend/Dockerfile.service.optimized`

**To use:**
1. Backup current Dockerfile:
   ```bash
   mv backend/Dockerfile.service backend/Dockerfile.service.old
   mv backend/Dockerfile.service.optimized backend/Dockerfile.service
   ```

2. Rebuild:
   ```bash
   docker compose build
   ```

**Improvements:**
- ✅ Better layer caching (packages installed first)
- ✅ Separate layers for shared packages
- ✅ Only copy code after dependencies installed

**Expected speedup:** 3-5x faster builds (1-2 minutes instead of 5-10)

---

## 🚀 Quick Commands

### Use the Helper Script (EASIEST)
```bash
./docker-quick-start.sh
```

Options:
1. **Current** - Original slow setup
2. **Fast** - Optimized with parallel startup ⭐ RECOMMENDED
3. **Minimal** - Backend only (no frontend)
4. **Single Service** - One service for testing
5. **Clean & Rebuild** - Fresh start
6. **Stop All**

### Manual Commands

**Stop everything:**
```bash
docker compose down
```

**Fast startup (optimized):**
```bash
docker compose -f docker-compose.fast.yml up
```

**Backend only:**
```bash
docker compose up -d gateway reporting-service auth-users-service drivers-compliance-service vehicles-maintenance-service logistics-service inventory-service ai-service
```

**Single service (replace SERVICE_NAME):**
```bash
docker compose up SERVICE_NAME
```

**Clean everything and rebuild:**
```bash
docker compose down -v --rmi all
docker system prune -f
docker compose build
```

---

## 🐛 Troubleshooting

### Issue: "Service is unhealthy"
**Cause:** Health check failing (service not responding)

**Fix:**
```bash
# Check logs for the failing service
docker compose logs SERVICE_NAME

# Common issues:
# - Database not accessible (check PG_HOST=host.docker.internal)
# - Environment variables missing (check .env file)
# - Port already in use (change port in docker-compose.yml)
```

### Issue: "npm install" taking forever
**Cause:** Installing dependencies for every service

**Fix:**
1. Use `docker-compose.fast.yml` (better volume mounts)
2. Or use optimized Dockerfile (caches dependencies)
3. Or use host network mode (faster on macOS):
   ```yaml
   network_mode: "host"
   ```

### Issue: "Cannot connect to host.docker.internal"
**Cause:** Database running on host not accessible

**Fix:**
```bash
# On macOS, ensure PostgreSQL is running
brew services list

# Or change PG_HOST to your machine's IP
PG_HOST=192.168.1.X
```

### Issue: Build cache not working
**Cause:** Changing files before npm install breaks cache

**Fix:**
1. Use optimized Dockerfile (copies package.json first)
2. Or run with `--no-cache` occasionally:
   ```bash
   docker compose build --no-cache
   ```

---

## 📊 Performance Comparison

| Method | Startup Time | Use Case |
|--------|--------------|----------|
| **Original** | 8-12 min | Full system test |
| **Optimized (fast.yml)** | 3-5 min | Daily development ⭐ |
| **Minimal (backend only)** | 2-3 min | API testing |
| **Single service** | 30-60 sec | Focused development |
| **No Docker (npm run dev)** | 5-10 sec | Single service dev |

---

## 🎯 Recommended Workflow

### For Daily Development
```bash
# Start optimized setup once
./docker-quick-start.sh
# Choose option 2 (Fast)

# Leave running, code changes auto-reload via volume mounts
# Gateway: http://localhost:4000
# Frontend: http://localhost:4200
```

### For Backend-Only Work
```bash
# Start minimal backend
./docker-quick-start.sh
# Choose option 3 (Minimal)

# Test APIs with Postman/Insomnia
# No frontend = faster
```

### For Single Service Development
```bash
# Start just the service you're working on
./docker-quick-start.sh
# Choose option 4 (Single Service)

# Or run directly on host (fastest):
cd backend/microservices/logistics-service
npm install
npm run dev
```

---

## 📝 Additional Optimizations (Future)

### 1. Multi-stage Dockerfile
```dockerfile
FROM node:20-alpine AS builder
# Build stage

FROM node:20-alpine AS runtime
# Runtime stage (smaller image)
```

### 2. Use Docker BuildKit
```bash
export DOCKER_BUILDKIT=1
docker compose build
```

### 3. Use docker-compose.override.yml
Create `docker-compose.override.yml` for local dev overrides:
```yaml
version: "3.9"
services:
  gateway:
    command: ["npm", "run", "dev"]  # Use nodemon
```

### 4. Reduce Volume Mount Scope
Instead of mounting entire `./backend`, mount only:
- Service directory
- Shared packages

---

## 🆘 Still Slow? Check These

1. **Docker Desktop Settings:**
   - Increase CPU: 4+ cores
   - Increase Memory: 8+ GB
   - Enable VirtioFS (macOS)

2. **Disk Space:**
   ```bash
   docker system df  # Check usage
   docker system prune -a  # Clean up
   ```

3. **Network:**
   - Slow npm registry? Use a mirror
   - VPN causing issues? Disable temporarily

4. **macOS Specific:**
   - Use Colima instead of Docker Desktop (faster)
   - Or run services directly on host (no Docker)

---

## 📚 Resources

- [Docker Compose Reference](https://docs.docker.com/compose/)
- [Dockerfile Best Practices](https://docs.docker.com/develop/develop-images/dockerfile_best-practices/)
- [Docker on macOS Performance](https://docs.docker.com/desktop/mac/)

---

**Created:** March 8, 2026  
**For Questions:** See [DOCKER-QUICK-START.md](./DOCKER-QUICK-START.md)
