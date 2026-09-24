# Gigxomi API Engine (`api.gigxomi.com`)

Dedicated, high-performance backend API service and database engine for the Gigxomi Ecosystem.

---

## 🏗️ Architecture & Isolation

- **Port**: `3003`
- **Domain**: `https://api.gigxomi.com` (and reverse proxied from `/api/*` on `app.gigxomi.com` / `gigxomi.com`)
- **VPS Directory**: `/var/www/gigxomi-api` (symlinked as `/var/www/8-gigxomi-api`)
- **PM2 Processes**:
  - `gigxomi-api` (Port 3003) - Dedicated Next.js App Router API engine
  - `gigxomi-meta-conversions` - Offline Meta CAPI event sync worker

---

## 📦 What Lives Here

1. **All API Route Handlers (`src/app/api/`)**:
   - `/api/mobile/` - Dedicated native mobile endpoints (v1 & v2 onboarding, LMS, tasks, chat, team)
   - `/api/conversations/` - Real-time SSE chat streaming and message delivery
   - `/api/meta/` - Meta Instagram and WhatsApp webhooks, data deletion, token lifecycle
   - `/api/payments/` & `/api/subscriptions/` - PhonePe payment gateways and webhooks
   - `/api/tasks/`, `/api/quotes/`, `/api/publishing/`, `/api/billing/`, `/api/super-admin/`
2. **Database Engine & ORM (`prisma/` & `src/lib/prisma.ts`)**:
   - PostgreSQL schema, migrations, connection pools.
3. **Core Services (`src/lib/`)**:
   - Firebase Push notifications, WhatsApp Flow engine, Instagram Graph API, Google OAuth, JWT authentication.

---

## ⚡ Quick Start

```bash
# Install dependencies & generate Prisma client
npm install

# Run development server on port 3003
npm run dev

# Production build (builds in ~10-15 seconds)
npm run build

# Start production server
npm run start
```
