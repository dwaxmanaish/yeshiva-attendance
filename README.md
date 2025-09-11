## Yeshiva Attendance Backend

Node.js + Express server with JSforce to connect to Salesforce.

### Prerequisites
- Node.js 18+
- A Salesforce Connected App (for OAuth) or API-enabled user (for username/password)

### Setup
1. Copy environment file:
   ```bash
   cp .env.example .env
   ```
2. Fill in the Salesforce values in `.env`:
   - `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, `SF_CALLBACK_URL` for OAuth
   - Optionally `SF_USERNAME`, `SF_PASSWORD`, `SF_SECURITY_TOKEN` for username/password login
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start in development mode:
   ```bash
   npm run dev
   ```

### Endpoints
- `GET /health` — health check
- OAuth flow:
  - `GET /api/auth/login` — redirect to Salesforce login
  - `GET /api/auth/callback` — OAuth callback; returns `userInfo`
- Username/Password flow (for dev/testing):
  - `POST /api/auth/login-password` — logs in with env credentials
- Session helpers:
  - `POST /api/auth/logout` — clears session
  - `GET /api/sfdc/whoami` — current user identity using session tokens
  - `GET /api/sfdc/query?soql=...` — run a SOQL query

### Configuration Notes
- Set `CORS_ORIGIN` to a comma-separated list of allowed origins if you are calling from a browser app.
- In production, set `SESSION_SECRET` and use HTTPS; `secure` cookies are enabled when `NODE_ENV=production`.
- To use a Sandbox, set `SF_LOGIN_URL=https://test.salesforce.com`.
- You can pin `SF_API_VERSION` (default is in `.env.example`).

### Scripts
- `npm start` – run server
- `npm run dev` – run with nodemon reloading

### Project Structure
```
src/
  index.js                # Express app
  routes/
    salesforce.js         # Auth + basic SF endpoints
  utils/
    salesforce.js         # JSforce helpers (OAuth, identity, query)
```

### Next Steps
- Add persistence for sessions (e.g., Redis) for multi-instance deployments
- Implement domain routes for attendance features
- Add request validation and error handling strategy
