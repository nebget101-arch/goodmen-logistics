# FleetNeuron Documentation Hub

**Welcome to the FleetNeuron development documentation!**

This directory contains all essential documents for the multi-agent development team working on FleetNeuron, an AI-powered fleet management platform.

---

## 🚀 Quick Start for New Agents

### First Time Setup (15 minutes)

1. **Read Core Documents** (in this order):
   - [BACKEND-ANALYSIS-AND-COLLABORATION-STRATEGY.md](./BACKEND-ANALYSIS-AND-COLLABORATION-STRATEGY.md) - Complete system overview
   - [GIT-WORKFLOW-QUICK-REFERENCE.md](./GIT-WORKFLOW-QUICK-REFERENCE.md) - Daily git commands
   - [TEAM-STATUS-DAILY.md](./TEAM-STATUS-DAILY.md) - Where to post updates

2. **Set Up Local Environment:**
   ```bash
   # Clone repo
   git clone https://github.com/[your-org]/FleetNeuronAPP.git
   cd FleetNeuronAPP
   
   # Start backend services
   docker compose up
   
   # In another terminal: Start frontend (if you're UI/UX AI)
   cd frontend && npm install && npm start
   
   # For iOS: Open ios/FleetNeuronDriver.xcodeproj in Xcode
   # For Android: Open android/ in Android Studio
   ```

3. **Create Your First Branch:**
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b <your-prefix>/test-workflow
   # Make a small change, commit, push, create PR
   ```

4. **Update Daily Status:**
   - Open [TEAM-STATUS-DAILY.md](./TEAM-STATUS-DAILY.md)
   - Add your section with today's work

---

## 📚 Documentation Structure

### 🎯 Core Documents (READ THESE FIRST)

| Document | Purpose | When to Read |
|----------|---------|--------------|
| **[BACKEND-ANALYSIS-AND-COLLABORATION-STRATEGY.md](./BACKEND-ANALYSIS-AND-COLLABORATION-STRATEGY.md)** | Complete backend codebase analysis, architecture, microservices breakdown, branching strategy | **Day 1 - Required** |
| **[GIT-WORKFLOW-QUICK-REFERENCE.md](./GIT-WORKFLOW-QUICK-REFERENCE.md)** | Git commands, commit conventions, branch naming, collaboration scenarios | **Day 1 - Required, then daily reference** |
| **[TEAM-STATUS-DAILY.md](./TEAM-STATUS-DAILY.md)** | Daily status update template - each agent updates their section | **Daily** |
| **[TEAM-COLLABORATION-PLAN.md](./TEAM-COLLABORATION-PLAN.md)** | Sprint workflow, release process, success metrics | **Week 1** |

### 🔌 API & Integration

| Document | Purpose | When to Use |
|----------|---------|-------------|
| **[api-contracts/API-CONTRACT-TEMPLATE.md](./api-contracts/API-CONTRACT-TEMPLATE.md)** | Template for defining API contracts between backend and frontend/mobile | **Before starting any API work** |
| **[AI-CHAT-API-CONTRACT.md](./ai-chat-api-contract.md)** | AI chat assistant API specification | Reference for AI service integration |
| **[API-BARCODE-SCAN-PHONE-BRIDGE.md](./API-BARCODE-SCAN-PHONE-BRIDGE.md)** | Barcode scanning integration API | Reference for inventory features |

### 🏗 Architecture & Design

| Document | Purpose | When to Use |
|----------|---------|-------------|
| **[APPLICATION-KNOWLEDGE-FOR-AI.md](./APPLICATION-KNOWLEDGE-FOR-AI.md)** | High-level overview of FleetNeuron features, routes, architecture | Reference when working on new features |
| **[RBAC.md](./RBAC.md)** | Role-Based Access Control system documentation | When implementing auth/permissions |
| **[DOCKER-QUICK-START.md](./DOCKER-QUICK-START.md)** | Docker setup and troubleshooting | When setting up local environment |

### 📋 Feature Specifications

| Document | Purpose | When to Use |
|----------|---------|-------------|
| **[PAYROLL-SETTLEMENT-PHASE1-AUDIT-AND-PROPOSAL.md](./PAYROLL-SETTLEMENT-PHASE1-AUDIT-AND-PROPOSAL.md)** | Payroll settlement system design (Phase 1) | When implementing settlement features |
| **[PAYROLL-SETTLEMENT-UI-REVIEW-AND-CONTRACTS.md](./PAYROLL-SETTLEMENT-UI-REVIEW-AND-CONTRACTS.md)** | Settlement UI specifications | When building settlement frontend |
| **[drivers-technicians-design-and-implementation-plan.md](./drivers-technicians-design-and-implementation-plan.md)** | Driver/technician module design | Reference for driver-related features |
| **[ai-assistant-requirements.md](./ai-assistant-requirements.md)** | AI assistant feature requirements | Reference for AI chat features |

### 🐛 Troubleshooting

| Document | Purpose | When to Use |
|----------|---------|-------------|
| **[ai-failure-diagnosis-playbooks.md](./ai-failure-diagnosis-playbooks.md)** | Common failure scenarios and solutions | When debugging AI service issues |
| **[LOADS-API-EMPTY-RESPONSE.md](./LOADS-API-EMPTY-RESPONSE.md)** | Troubleshooting loads API issues | When loads API returns empty results |

---

## 👥 Agent-Specific Quick Links

### 🖥 Backend AI (Lead Backend Architect)

**Your Primary Documents:**
- [BACKEND-ANALYSIS-AND-COLLABORATION-STRATEGY.md](./BACKEND-ANALYSIS-AND-COLLABORATION-STRATEGY.md) - Your main reference
- [api-contracts/API-CONTRACT-TEMPLATE.md](./api-contracts/API-CONTRACT-TEMPLATE.md) - Use for every new API
- [RBAC.md](./RBAC.md) - Implement permissions correctly

**Your Daily Tasks:**
1. Update [TEAM-STATUS-DAILY.md](./TEAM-STATUS-DAILY.md) with API work, migrations
2. Create API contracts in `/docs/api-contracts/` before implementation
3. Review PRs from other agents (especially database-related)
4. Maintain microservices in `backend/microservices/`

**Key Folders You Own:**
- `backend/` - All microservices
- `backend/packages/goodmen-database/` - Migrations & schema
- `backend/packages/goodmen-shared/` - Shared code
- `docs/api-contracts/` - API specifications

### 🎨 UI/UX AI (Frontend Developer)

**Your Primary Documents:**
- [BACKEND-ANALYSIS-AND-COLLABORATION-STRATEGY.md](./BACKEND-ANALYSIS-AND-COLLABORATION-STRATEGY.md) - Understand backend architecture
- [APPLICATION-KNOWLEDGE-FOR-AI.md](./APPLICATION-KNOWLEDGE-FOR-AI.md) - UI routes and features
- [api-contracts/](./api-contracts/) - Review all API contracts

**Your Daily Tasks:**
1. Update [TEAM-STATUS-DAILY.md](./TEAM-STATUS-DAILY.md) with UI work
2. Review new API contracts and provide feedback
3. Implement Angular components per design
4. Test responsive design (mobile, tablet, desktop)

**Key Folders You Own:**
- `frontend/src/app/` - All Angular code
- `frontend/docs/` - Frontend-specific docs

### 📱 iOS AI (iOS Developer)

**Your Primary Documents:**
- [ios/README.md](../ios/README.md) - iOS app setup
- [ios/XCODE-SETUP-STEPS.md](../ios/XCODE-SETUP-STEPS.md) - Xcode configuration
- [api-contracts/](./api-contracts/) - Review all API contracts

**Your Daily Tasks:**
1. Update [TEAM-STATUS-DAILY.md](./TEAM-STATUS-DAILY.md) with iOS work
2. Review API contracts for mobile needs
3. Test on simulators and real devices
4. Coordinate with Android AI for consistent UX

**Key Folders You Own:**
- `ios/FleetNeuronDriver/` - All Swift/SwiftUI code

### 🤖 Android AI (Android Developer)

**Your Primary Documents:**
- [ios/README.md](../ios/README.md) - Reference iOS implementation
- [api-contracts/](./api-contracts/) - Review all API contracts
- (Create `android/README.md` when project starts)

**Your Daily Tasks:**
1. Update [TEAM-STATUS-DAILY.md](./TEAM-STATUS-DAILY.md) with Android work
2. Review API contracts for mobile needs
3. Ensure feature parity with iOS app
4. Test on emulators and real devices

**Key Folders You Own:**
- `android/` - All Android code (to be created)

---

## 📅 Weekly Workflow

### Monday (Sprint Start)
- [ ] Review sprint goals in [TEAM-STATUS-DAILY.md](./TEAM-STATUS-DAILY.md)
- [ ] Backend AI creates API contracts for the week
- [ ] All agents pull latest `develop` branch

### Tuesday-Thursday (Development)
- [ ] Work on feature branches (`backend/`, `frontend/`, `ios/`, `android/`)
- [ ] Commit and push daily
- [ ] Update status doc daily
- [ ] Review PRs from other agents

### Friday (Integration & Review)
- [ ] Merge ready features to `develop`
- [ ] Test integration on staging
- [ ] Demo completed features
- [ ] Plan next week

---

## 🚦 Common Workflows

### Adding a New API Endpoint

1. **Backend AI:**
   ```bash
   # Create API contract
   cp docs/api-contracts/API-CONTRACT-TEMPLATE.md docs/api-contracts/settlements-api.md
   # Edit contract
   git add docs/api-contracts/settlements-api.md
   git commit -m "docs(api): Add settlements API contract"
   git push origin backend/settlements-api
   # Create PR, tag UI/UX and mobile agents for review
   ```

2. **UI/UX / iOS / Android AI:**
   - Review contract
   - Provide feedback in PR comments
   - Approve when ready

3. **Backend AI:**
   - Implement endpoint after approval
   - Notify team when deployed to dev

4. **UI/UX / iOS / Android AI:**
   - Implement UI/mobile integration

### Adding a Database Migration

1. **Backend AI:**
   ```bash
   cd backend/packages/goodmen-database
   npx knex migrate:make add_new_table
   # Edit migration
   git add migrations/20260308_add_new_table.js
   git commit -m "feat(database): Add new_table migration"
   git push origin shared/new-table-migration
   # Create PR, notify ALL agents
   ```

2. **All Agents:**
   - Review migration (does it affect your queries?)
   - Approve PR

3. **After Merge:**
   ```bash
   # All agents run locally
   cd backend/packages/goodmen-database
   npx knex migrate:latest
   ```

### Resolving Merge Conflicts

```bash
# Pull latest develop
git checkout your-branch
git merge develop
# Conflicts detected

# Edit conflicted files
# Stage resolved files
git add .
git commit -m "merge: Resolve conflicts with develop"
git push origin your-branch
```

---

## 🔍 Finding Information

### "I need to understand the system architecture"
→ Read [BACKEND-ANALYSIS-AND-COLLABORATION-STRATEGY.md](./BACKEND-ANALYSIS-AND-COLLABORATION-STRATEGY.md)

### "I need to know what API endpoints exist"
→ Check [APPLICATION-KNOWLEDGE-FOR-AI.md](./APPLICATION-KNOWLEDGE-FOR-AI.md) Section 5

### "I need to implement a new API"
→ Use [api-contracts/API-CONTRACT-TEMPLATE.md](./api-contracts/API-CONTRACT-TEMPLATE.md)

### "I don't know the git command for X"
→ Check [GIT-WORKFLOW-QUICK-REFERENCE.md](./GIT-WORKFLOW-QUICK-REFERENCE.md)

### "I need to understand permissions/roles"
→ Read [RBAC.md](./RBAC.md)

### "I'm blocked by another agent"
→ Update [TEAM-STATUS-DAILY.md](./TEAM-STATUS-DAILY.md) blocker section immediately

### "Docker isn't working"
→ Check [DOCKER-QUICK-START.md](./DOCKER-QUICK-START.md)

### "I need to understand a specific feature"
→ Search for feature name in `/docs/` (e.g., "settlement", "payroll", "drivers")

---

## 📞 Communication Channels

### Async (Primary - Use These!)
- **[TEAM-STATUS-DAILY.md](./TEAM-STATUS-DAILY.md)** - Daily updates, blockers, questions
- **GitHub PRs** - Code reviews, technical discussions
- **API Contract Docs** - Requirements, feedback, approvals
- **Commit Messages** - What changed and why

### Sync (When Needed)
- **Video Call** - Complex technical discussions
- **Pair Programming** - Stuck on integration
- **Sprint Planning** - Start of sprint
- **Sprint Demo** - End of sprint

---

## ✅ Daily Checklist (All Agents)

- [ ] Pull latest from `develop`
- [ ] Work on feature branch
- [ ] Commit changes with descriptive message
- [ ] Push to remote at least once
- [ ] Update [TEAM-STATUS-DAILY.md](./TEAM-STATUS-DAILY.md)
- [ ] Review any assigned PRs
- [ ] Flag blockers immediately (don't wait!)

---

## 🎯 Success Criteria

### Code Quality
✅ Test coverage > 70%  
✅ Linters pass (no warnings)  
✅ No critical security vulnerabilities

### Collaboration
✅ PRs reviewed within 4 hours  
✅ < 3 merge conflicts per week  
✅ Daily status updates by all agents

### Delivery
✅ Features to staging within 1 week  
✅ Production releases every 2-4 weeks  
✅ < 5 critical bugs per release

---

## 🆘 Need Help?

1. **Check this README first** - Most answers are here
2. **Search `/docs/` folder** - We document everything
3. **Ask in [TEAM-STATUS-DAILY.md](./TEAM-STATUS-DAILY.md)** - Team will respond
4. **Create GitHub Discussion** - For bigger questions

---

## 📈 Document Status

| Document | Status | Last Updated | Maintained By |
|----------|--------|--------------|---------------|
| BACKEND-ANALYSIS-AND-COLLABORATION-STRATEGY.md | ✅ Active | 2026-03-08 | Backend AI |
| GIT-WORKFLOW-QUICK-REFERENCE.md | ✅ Active | 2026-03-08 | All Agents |
| TEAM-STATUS-DAILY.md | ✅ Active | Daily | All Agents |
| API-CONTRACT-TEMPLATE.md | ✅ Active | 2026-03-08 | Backend AI |
| TEAM-COLLABORATION-PLAN.md | ✅ Active | 2026-03-08 | All Agents |

---

**Welcome to the team! Let's build something great together! 🚀**

---

**Document Version:** 1.0  
**Last Updated:** March 8, 2026  
**Maintained By:** All Agents  
**Questions?** Update [TEAM-STATUS-DAILY.md](./TEAM-STATUS-DAILY.md) or create GitHub Discussion
