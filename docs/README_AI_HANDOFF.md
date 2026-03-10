# FleetNeuron AI Handoff Documentation (for ChatGPT)

This folder now includes structured handoff docs you can paste into ChatGPT when asking for new feature requirements.

## Files

1. **Frontend structure, pages, popups, and logic**  
   See [README_FRONTEND_FOR_CHATGPT.md](README_FRONTEND_FOR_CHATGPT.md)

2. **APIs and microservices architecture**  
   See [README_APIS_MICROSERVICES_FOR_CHATGPT.md](README_APIS_MICROSERVICES_FOR_CHATGPT.md)

3. **Database schema and domain model**  
   See [README_DATABASE_SCHEMA_FOR_CHATGPT.md](README_DATABASE_SCHEMA_FOR_CHATGPT.md)

---

## How to use with ChatGPT

Copy these three files and provide them as context with a prompt like:

> "Use the attached FleetNeuron frontend, API, and database docs as the source of truth. Propose implementation requirements for [feature], including UI changes, API contracts, DB migration plan, RBAC impact, rollout plan, and test plan."

---

## Recommended prompt template

Use this template for better feature specs:

1. **Goal:** what business outcome you need.
2. **Actors:** roles impacted (`dispatch`, `accounting`, `admin`, etc.).
3. **Scope:** frontend pages, API domains, DB tables likely touched.
4. **Constraints:** deadline, backward compatibility, compliance/security constraints.
5. **Output needed:**
   - user stories + acceptance criteria
   - API changes (request/response)
   - DB migration steps
   - rollout strategy
   - testing checklist

---

## Notes

- API gateway entrypoint: [backend/gateway/index.js](../backend/gateway/index.js)
- Frontend routes: [frontend/src/app/app-routing.module.ts](../frontend/src/app/app-routing.module.ts)
- DB migrations: [backend/packages/goodmen-database/migrations](../backend/packages/goodmen-database/migrations)
