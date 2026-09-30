# Swayamsiddha Backend

Backend API service for the **Swayamsiddha Tiffin Management System**. Built with Node.js, Express, Prisma ORM, and PostgreSQL.

---

## 1. Installation

Ensure Node.js (v20+ recommended, v22 LTS tested) and npm are installed:

```bash
# Clone the repository and navigate to backend directory
cd swayamsiddha-backend

# Install dependencies
npm install
```

---

## 2. Environment Variables

Create a `.env` file in the root directory by copying `.env.example`:

```bash
cp .env.example .env
```

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `PORT` | Express server port | `5000` |
| `NODE_ENV` | Application environment (`development`, `production`, `test`) | `development` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/swayamsiddha_dev?schema=public` |
| `SESSION_SECRET` | Secret key for session management | `your_secure_secret_here` |
| `SESSION_COOKIE_NAME` | Name of the authentication cookie | `swayamsiddha_session` |
| `SESSION_MAX_AGE_DAYS` | Session validity duration in days | `7` |
| `FRONTEND_ORIGIN` | Allowed client origin for CORS with credentials | `http://localhost:5173` |
| `SEED_OWNER_PASSWORD` | Optional password for development seed OWNER | `dev_owner_password_123` |
| `SEED_CUSTOMER_PASSWORD` | Optional password for development seed CUSTOMER | `dev_customer_password_123` |

> ⚠️ **Security Notice**: Never commit `.env` or production credentials to version control.

---

## 3. Running PostgreSQL Locally

You can use a local PostgreSQL server or Docker container for development:

```bash
# Using Docker (optional quick local setup)
docker run --name swayamsiddha-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=swayamsiddha_dev -p 5432:5432 -d postgres:15
```

Ensure your `DATABASE_URL` in `.env` matches your database host, port, username, password, and database name.

---

## 4. Prisma Setup & Migrations

```bash
# Validate Prisma schema
npm run prisma:validate

# Format Prisma schema
npm run prisma:format

# Generate Prisma Client
npm run prisma:generate

# Apply migrations to development database
npm run prisma:migrate:dev

# Run development seed script
npm run db:seed
```

---

## 5. Starting the Express Server

```bash
# Start in production mode
npm start

# Start in development mode with automatic reload
npm run dev
```

The server will start listening at `http://localhost:5000`.

---

## 6. API Endpoints

### Authentication Endpoints (`/api/auth`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/login` | Public | Authenticates credentials and sets session cookie |
| `POST` | `/api/auth/logout` | Authenticated | Revokes server-side session and clears cookie |
| `GET` | `/api/auth/me` | Authenticated | Returns current authenticated user profile |
| `GET` | `/api/test/owner` | Owner only | Temporary development route for verifying role enforcement |
| `GET` | `/api/test/customer`| Customer only| Temporary development route for verifying role enforcement |

### Customer Profile & Meal Endpoints (`/api/customer`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/customer/me` | Customer only | Returns authenticated customer's own profile (`req.user.id`) |
| `GET` | `/api/customer/meals/today` | Customer only | Returns today's meal, attendance, and poll status in IST |
| `POST` | `/api/customer/attendance` | Customer only | Marks attendance (`PRESENT`/`ABSENT`). Enforces immutability & suspension checks. |
| `GET` | `/api/customer/poll/today` | Customer only | Returns today's lunch location poll status and eligibility |
| `POST` | `/api/customer/poll/vote` | Customer only | Casts single immutable vote (`COLLEGE`/`RESTAURANT`) |
| `POST` | `/api/customer/messages` | Customer only | Sends query/complaint/request message to owner |
| `GET` | `/api/customer/messages` | Customer only | Returns authenticated customer's own message history |

### Owner Management Endpoints (`/api/owner`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/owner/customers` | Owner only | Paginated list of customers (`?page=1&limit=20&search=`) |
| `GET` | `/api/owner/customers/:customerId` | Owner only | Detailed safe profile of a specific customer |
| `POST` | `/api/owner/customers` | Owner only | Transactionally creates User, CustomerProfile, and initial ledger |
| `PATCH` | `/api/owner/customers/:customerId` | Owner only | Updates basic customer info (`name`, `phone`, `profilePictureUrl`) |
| `POST` | `/api/owner/customers/:customerId/suspension` | Owner only | Suspends customer service for inclusive date range |
| `GET` | `/api/owner/customers/:customerId/suspension` | Owner only | Retrieves customer's service suspension history |
| `PATCH` | `/api/owner/customers/:customerId/suspension/:suspensionId/unsuspend` | Owner only | Ends active service suspension early |
| `POST` | `/api/owner/customers/:customerId/recharge` | Owner only | Executes atomic cash recharge for tiffin balance |
| `GET` | `/api/owner/attendance` | Owner only | Operational attendance records with filters (`date`, `customerId`, `mealType`, `status`) |
| `PATCH` | `/api/owner/attendance/:attendanceId` | Owner only | Manually overrides attendance with domain validation & audit log |
| `POST` | `/api/owner/meal-tokens/:attendanceId` | Owner only | Generates meal token and executes exactly-once tiffin deduction |
| `GET` | `/api/owner/messages` | Owner only | Lists customer messages with filtering options |
| `PATCH` | `/api/owner/messages/:messageId` | Owner only | Updates message status (`READ` or `RESOLVED`) |
| `POST` | `/api/owner/automation/finalize-lunch` | Owner only | Manually triggers 4:00 PM IST Lunch finalization (testing/dev) |
| `POST` | `/api/owner/automation/finalize-dinner` | Owner only | Manually triggers 11:00 PM IST Dinner finalization (testing/dev) |
| `GET` | `/api/owner/automation/status` | Owner only | Inspects daily scheduler status and configured jobs |

### Owner Analytics Endpoints (`/api/owner/analytics`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/owner/analytics/overview` | Owner only | High-level operational summary across subsystems (`?from=&to=`) |
| `GET` | `/api/owner/analytics/attendance` | Owner only | Daily attendance breakdown (`present`, `absent`, `unmarked`) (`?from=&to=`) |
| `GET` | `/api/owner/analytics/locations` | Owner only | Authoritative location distribution from attendance (`?from=&to=`) |
| `GET` | `/api/owner/analytics/meals` | Owner only | Authoritative tokenized meal consumption (`?from=&to=`) |
| `GET` | `/api/owner/analytics/tiffins` | Owner only | Authoritative tiffin ledger analytics (`?from=&to=`) |
| `GET` | `/api/owner/analytics/balances` | Owner only | Customer balance distribution and low-balance thresholds |
| `GET` | `/api/owner/analytics/customer-status` | Owner only | Snapshot of active, service-suspended, and payment-suspended customers |
| `GET` | `/api/owner/analytics/suspensions` | Owner only | Service suspension counts, affected customers, and active state (`?from=&to=`) |
| `GET` | `/api/owner/analytics/polls` | Owner only | Weekday lunch poll totals and voting distribution (`?from=&to=`) |
| `GET` | `/api/owner/analytics/messages` | Owner only | Message status counts (`UNREAD`, `READ`, `RESOLVED`) (`?from=&to=`) |
| `GET` | `/api/owner/analytics/tokens` | Owner only | Authoritative token counts by meal, location, and date (`?from=&to=`) |
| `GET` | `/api/owner/analytics/daily` | Owner only | Comprehensive operational snapshot for a single date (`?date=`) |

---

## 7. Request / Response Examples

### A. Login (`POST /api/auth/login`)

**Request:**
```http
POST /api/auth/login HTTP/1.1
Content-Type: application/json

{
  "loginIdentifier": "owner@swayamsiddha.local",
  "password": "your_password"
}
```

**Success Response (`200 OK`):**
```json
{
  "message": "Login successful",
  "user": {
    "id": "18f9bc8e-28b3-4f93-b67e-405cb67643b1",
    "loginIdentifier": "owner@swayamsiddha.local",
    "role": "OWNER",
    "customerProfile": null
  }
}
```
*Note: Header `Set-Cookie: swayamsiddha_session=<token>; HttpOnly; Path=/; SameSite=Lax` is returned.*

**Failure Response (`401 Unauthorized`):**
```json
{
  "error": "Invalid login identifier or password"
}
```
*(Generic error message prevents username/email enumeration).*

---

### B. Current User (`GET /api/auth/me`)

**Request:**
```http
GET /api/auth/me HTTP/1.1
Cookie: swayamsiddha_session=<token>
```

**Success Response (`200 OK`):**
```json
{
  "user": {
    "id": "18f9bc8e-28b3-4f93-b67e-405cb67643b1",
    "loginIdentifier": "owner@swayamsiddha.local",
    "role": "OWNER",
    "customerProfile": null
  }
}
```

**Failure Response (`401 Unauthorized`):**
```json
{
  "error": "Authentication required. Please log in."
}
```

---

### C. Logout (`POST /api/auth/logout`)

**Request:**
```http
POST /api/auth/logout HTTP/1.1
Cookie: swayamsiddha_session=<token>
```

**Success Response (`200 OK`):**
```json
{
  "message": "Logged out successfully"
}
```
*Note: Cookie is cleared with `Expires=Thu, 01 Jan 1970 00:00:00 GMT`.*

---

## 8. How Authentication Cookies Work

1. **HttpOnly**: JavaScript running in the browser cannot read or access the cookie, mitigating cross-site scripting (XSS) credential theft.
2. **Server-Side Session**: Only an unguessable 256-bit random cryptographic token is sent in the cookie. User profile, roles, and expiration are verified on the server against the database.
3. **SameSite**: Set to `Lax` in development and `Strict` in production to prevent Cross-Site Request Forgery (CSRF).
4. **Secure**: Sent only over HTTPS in production environments.
5. **No LocalStorage**: Tokens are never stored in browser `localStorage` or `sessionStorage`.

---

## 9. How OWNER / CUSTOMER Authorization Works

Authorization is strictly enforced by the backend middleware chain:

1. **`requireAuth`**: Reads the session cookie, queries PostgreSQL for an active unexpired session, and attaches the authoritative user object to `req.user`.
2. **`requireRole('OWNER')` / `requireRole('CUSTOMER')`**:
   - Inspects `req.user.role` derived from the database.
   - If the user has the required role, the request proceeds to the handler.
   - If the user does not have the required role, the middleware rejects the request with **HTTP 403 Forbidden** (`Access denied. Insufficient permissions.`).
   - If unauthenticated, rejects with **HTTP 401 Unauthorized**.
3. **No Client Trust**: Client-supplied role claims (e.g., in request body or headers) are completely ignored.

---

## 10. Running the Automated Tests

Automated tests verify all authentication flows and role enforcement scenarios without external test runner bloat:

```bash
npm test
```

### Phase 2: Authentication Test Suite (`tests/auth.test.js`)
- **Test A**: `POST /api/auth/login` (OWNER) $\rightarrow$ Returns 200, sets HTTP-only cookie, returns OWNER.
- **Test B**: `POST /api/auth/login` (CUSTOMER) $\rightarrow$ Returns 200, sets cookie, returns CUSTOMER profile with remaining tiffins.
- **Test C**: `POST /api/auth/login` (Invalid credentials) $\rightarrow$ Returns 401 with generic error, no cookie set.
- **Test D**: `GET /api/auth/me` (Authenticated) $\rightarrow$ Returns 200 with authenticated identity.
- **Test E**: `GET /api/auth/me` (Unauthenticated) $\rightarrow$ Returns 401 Unauthorized.
- **Test F**: `POST /api/auth/logout` $\rightarrow$ Returns 200, clears cookie, invalidates session (subsequent `/me` returns 401).
- **Test G**: Role protection on `/api/test/owner` $\rightarrow$ Allows OWNER (200), forbids CUSTOMER (403), rejects unauthenticated (401).

### Phase 3: Customer Management Test Suite (`tests/customer.test.js`)
- **Test A**: `GET /api/customer/me` $\rightarrow$ Returns 200 with authenticated customer's own safe profile.
- **Test B**: `GET /api/owner/customers` $\rightarrow$ Returns 200 with paginated customer list.
- **Test C**: `GET /api/owner/customers/:customerId` $\rightarrow$ Returns 200 with customer detail.
- **Test D**: CUSTOMER accessing `GET /api/owner/customers` $\rightarrow$ Returns 403 Forbidden.
- **Test E**: CUSTOMER accessing `GET /api/owner/customers/:customerId` $\rightarrow$ Returns 403 Forbidden.
- **Test F**: CUSTOMER accessing `POST /api/owner/customers` $\rightarrow$ Returns 403 Forbidden.
- **Test G**: OWNER creating customer `POST /api/owner/customers` $\rightarrow$ Transactionally creates User, Profile, INITIAL_BALANCE transaction, AuditLog and returns 201.
- **Test H**: Duplicate `loginIdentifier` $\rightarrow$ Returns 409 Conflict.
- **Test I**: Duplicate `phone` $\rightarrow$ Returns 409 Conflict.
- **Test J**: Invalid initial balance (negative) $\rightarrow$ Returns 400 Bad Request.
- **Test K**: OWNER updating customer profile `PATCH /api/owner/customers/:customerId` $\rightarrow$ Returns 200 with updated fields; ignores restricted balance/status fields.
- **Test L**: CUSTOMER attempting `PATCH /api/owner/customers/:customerId` $\rightarrow$ Returns 403 Forbidden.
- **Test M**: OWNER requesting non-existent customer `GET /api/owner/customers/:id` $\rightarrow$ Returns 404 Not Found.
- **Test N**: Ledger consistency $\rightarrow$ Newly created customer ledger sum strictly equals `remainingTiffins`.

### Phase 4: Attendance & Lunch Poll Test Suite (`tests/attendance.test.js`)
- **Test A**: Weekday lunch `PRESENT` $\rightarrow$ Status `PRESENT`, location `null`, poll remains available.
- **Test B**: Weekday lunch `ABSENT` $\rightarrow$ Status `ABSENT`, location `null`, poll becomes unavailable.
- **Test C**: Attendance immutability $\rightarrow$ `PRESENT` $\rightarrow$ `ABSENT` rejected with 409 Conflict.
- **Test D**: Vote `COLLEGE` after `PRESENT` $\rightarrow$ Updates attendance location to `COLLEGE`.
- **Test E**: Vote `RESTAURANT` without prior attendance $\rightarrow$ Transactionally creates PollVote and Attendance `PRESENT` + `RESTAURANT`.
- **Test F**: Vote after Lunch `ABSENT` $\rightarrow$ Rejected (400), zero PollVotes created.
- **Test G**: Second vote $\rightarrow$ `COLLEGE` $\rightarrow$ `RESTAURANT` rejected with 409 Conflict, original vote preserved.
- **Test H**: Vote before 06:00 IST $\rightarrow$ Rejected (400).
- **Test I**: Vote after 11:30 IST $\rightarrow$ Rejected (400).
- **Test J**: Saturday poll $\rightarrow$ Returns `pollExists: false` (reason: `WEEKEND`).
- **Test K**: Saturday Lunch `PRESENT` $\rightarrow$ Automatically sets location to `RESTAURANT`.
- **Test L**: Saturday Dinner `PRESENT` $\rightarrow$ Automatically sets location to `RESTAURANT`.
- **Test M**: Sunday Lunch `PRESENT` $\rightarrow$ Sets location to `RESTAURANT`.
- **Test N**: Sunday dinner marking $\rightarrow$ Rejected (400), `dinner.serviceAvailable = false`.
- **Test O**: Dinner `COLLEGE` $\rightarrow$ Rejected by domain rules.
- **Test P**: CUSTOMER accessing `GET /api/owner/attendance` $\rightarrow$ Returns 403 Forbidden.
- **Test Q**: OWNER accessing `GET /api/owner/attendance` $\rightarrow$ Returns 200 with operational records.
- **Test R**: OWNER `PATCH /api/owner/attendance/:id` $\rightarrow$ Overrides attendance, creates `AuditLog`.
- **Test S**: CUSTOMER accessing `PATCH /api/owner/attendance/:id` $\rightarrow$ Returns 403 Forbidden.
- **Test T**: Zero MealTokens created by Phase 4 operations.
- **Test U**: Customer `remainingTiffins` balance unchanged by Phase 4 operations.
- **Test V**: Zero `MEAL_TOKEN` transactions created by Phase 4 operations.
- **Test W**: Poll uniqueness $\rightarrow$ Repeated/concurrent poll retrieval creates exactly one poll record.
- **Test X**: Customer isolation $\rightarrow$ Customer retrieves only their own meal and attendance state.

### Phase 5: Meal Token & Tiffin Deduction Test Suite (`tests/mealToken.test.js`)
- **Test A**: Lunch Restaurant token $\rightarrow$ Generates `DD-MM-LU-R-001` for `PRESENT` + `RESTAURANT`.
- **Test B**: Lunch College token $\rightarrow$ Generates `DD-MM-LU-C-001` for `PRESENT` + `COLLEGE`.
- **Test C**: Dinner Restaurant token $\rightarrow$ Generates `DD-MM-DN-R-001` for `PRESENT` + `RESTAURANT`.
- **Test D**: Invalid `ABSENT` attendance $\rightarrow$ Rejected (400 Bad Request).
- **Test E**: Invalid `UNMARKED` attendance $\rightarrow$ Rejected (400 Bad Request).
- **Test F**: `PRESENT` with `null` location $\rightarrow$ Rejected (400 Bad Request).
- **Test G**: Sunday dinner $\rightarrow$ Strictly rejected (400 Bad Request).
- **Test H**: Zero balance customer $\rightarrow$ Rejected with 409 Conflict; no token, counter, or transaction created.
- **Test I**: Balance deduction $\rightarrow$ Decrements customer `remainingTiffins` by exactly 1.
- **Test J**: Ledger transaction $\rightarrow$ Creates exactly one `MEAL_TOKEN` transaction with `quantity: -1`.
- **Test K**: Ledger consistency $\rightarrow$ $\sum \text{quantity} == \text{remainingTiffins}$ strictly holds.
- **Test L**: Repeated same attendance $\rightarrow$ Returns identical token without duplicate deductions or counters.
- **Test M**: Concurrent requests on same attendance $\rightarrow$ Exactly one token and one deduction created.
- **Test N**: Two attendances with balance = 1 $\rightarrow$ Exactly one succeeds, one fails (409), balance reaches 0 (never negative).
- **Test O**: Counter sequencing $\rightarrow$ Same date/meal/location yields sequential numbers (`001`, `002`, `003`).
- **Test P**: Counter separation $\rightarrow$ Independent counters per `(date, mealType, location)` start at `001`.
- **Test Q**: Counter rollback $\rightarrow$ Failed transaction rolls back counter, preserving sequential numbering.
- **Test R**: Token uniqueness $\rightarrow$ Zero duplicate token values across the system.
- **Test S**: CUSTOMER invoking owner token endpoint $\rightarrow$ 403 Forbidden.
- **Test T**: Unauthenticated request $\rightarrow$ 401 Unauthorized.
- **Test U**: OWNER invoking token endpoint $\rightarrow$ 200/201 Success.
- **Test V**: Owner attendance edit after token $\rightarrow$ Altering status/location rejected with 409 Conflict.
- **Test W**: Customer meal state retrieval $\rightarrow$ Exposes safe `mealToken` metadata (`token`, `tokenId`, `generatedAt`).
- **Test X**: No automatic finalization $\rightarrow$ Clocks reaching 16:00 / 23:00 do not create tokens.
- **Test Y**: No duplicate transactions $\rightarrow$ Repeated calls never produce duplicate `MEAL_TOKEN` rows.
- **Test Z**: Token format validation $\rightarrow$ Strict regex `DD-MM-LU/DN-R/C-SSS`, never `01`/`02` for meal code.

### Phase 6: Service & Payment Suspension Test Suite (`tests/suspension.test.js`)
- **Test 1**: Owner can suspend customer for inclusive date range.
- **Test 2**: Customer cannot create suspension (403 Forbidden).
- **Test 3**: Active suspension blocks customer attendance marking (400 Bad Request).
- **Test 4**: Active suspension sets lunch poll eligibility to false with reason `SERVICE_SUSPENDED`.
- **Test 5**: Active suspension blocks voting in lunch poll (400 Bad Request).
- **Test 6**: Active suspension blocks token generation (400 Bad Request).
- **Test 7**: Suspension does not deduct tiffins and does not create meal token.
- **Test 8**: Suspension action creates `OWNER_SERVICE_SUSPENDED` audit log.
- **Test 9**: Owner can list customer suspensions.
- **Test 10**: Owner can unsuspend customer early (truncating endDate or removing future suspension) and creates `OWNER_SERVICE_UNSUSPENDED` audit log.
- **Test 11**: After unsuspension, customer can mark attendance normally for future dates.
- **Test 12**: Customer with balance 0 is payment suspended; can login and view profile, but blocked from attendance and poll (409 Conflict).

### Phase 6: Owner Cash Recharge & Integration Test Suite (`tests/recharge.test.js`)
- **Test 1**: Customer cannot invoke owner recharge endpoint (403 Forbidden).
- **Test 2**: Non-positive or non-integer recharge amount is rejected (400 Bad Request).
- **Test 3**: Full Integration Sequence:
  - Initial balance 1 $\rightarrow$ Meal token generation succeeds $\rightarrow$ Balance becomes 0.
  - Exactly one `-1` `MEAL_TOKEN` transaction logged.
  - Customer enters `PAYMENT_SUSPENDED` $\rightarrow$ Further attendance marking blocked.
  - Owner executes `+30` cash recharge $\rightarrow$ Balance becomes 30.
  - Exactly one `+30` `CASH_RECHARGE` ledger transaction logged.
  - Ledger sum strictly equals `remainingTiffins`.
  - Payment suspension automatically clears $\rightarrow$ Customer can mark attendance normally again.
  - Audit log `OWNER_CASH_RECHARGE` verified.

### Phase 6: Customer & Owner Message Workflow Test Suite (`tests/messages.test.js`)
- **Test 1**: Customer can send a message/query to owner (`POST /api/customer/messages`).
- **Test 2**: Empty message or invalid payload is rejected (400 Bad Request).
- **Test 3**: Customer can retrieve their own messages (`GET /api/customer/messages`).
- **Test 4**: Owner can list all customer messages with customer profile details (`GET /api/owner/messages`).
- **Test 5**: Customer cannot access owner message list (403 Forbidden).
- **Test 6**: Owner marks message status as `READ` (`PATCH /api/owner/messages/:messageId`) with `readAt` timestamp.
- **Test 7**: Customer cannot resolve or update message (403 Forbidden).
- **Test 8**: Owner resolves message and sets `resolvedAt` timestamp.
- **Test 9**: Attempting to modify an already `RESOLVED` message is rejected (400 Bad Request).

### Phase 7: Automatic Daily Meal Finalization & Scheduler Test Suite (`tests/dailyFinalization.test.js`)
- **Tests 1-6**: Unmarked weekday lunch becomes `PRESENT` + `RESTAURANT` + `AUTO` with exactly one token generated, exactly one `-1` ledger entry, and balance decremented by 1.
- **Test 7**: Existing `PRESENT` + `COLLEGE` lunch is untouched (location preserved, no duplicate token).
- **Test 8**: Existing `PRESENT` + `RESTAURANT` with token is untouched.
- **Test 9**: Existing `PRESENT` + `RESTAURANT` without token gets exactly one token generated.
- **Test 10**: Existing `ABSENT` lunch is untouched (no token, no deduction).
- **Test 11**: Service-suspended customer is not given a token and marked `ABSENT` with source `SUSPENSION`.
- **Tests 12 & 13**: Payment-suspended customer (balance 0) is skipped without token; balance never becomes negative.
- **Test 14**: Poll vote is not created by automatic finalization.
- **Test 15**: Running lunch finalization twice produces no duplicate token or deduction (Idempotency).
- **Tests 16-20**: Unmarked dinner becomes `PRESENT` + `RESTAURANT` + `AUTO` with token and `-1` deduction.
- **Test 21**: Existing `ABSENT` dinner is untouched.
- **Test 22**: Existing `PRESENT` dinner is not duplicated.
- **Tests 23 & 24**: Payment-suspended and service-suspended customers are skipped for dinner.
- **Test 25**: Sunday dinner is strictly excluded (no attendance, no token, no deduction).
- **Test 26**: Saturday lunch finalization operates as restaurant service.
- **Tests 27 & 28**: Saturday dinner operates as restaurant service with no poll created.
- **Tests 29 & 30**: Concurrent simultaneous finalizations cannot create duplicate tokens or double deduct.
- **Test 31**: Balance = 1 race condition results in exactly one successful token; balance reaches 0 (never negative).
- **Tests 32-34**: Token generation failure reverts attendance safely and reports failed count.
- **Test 35**: Rerunning after a partial failure safely completes remaining work.
- **Test 36**: 4:00 PM IST boundary handled correctly (rejected before 16:00 IST when `enforceTimeWindow=true`).
- **Test 37**: 11:00 PM IST boundary handled correctly (rejected before 23:00 IST when `enforceTimeWindow=true`).
- **Test 38**: IST business date is used correctly across timezone offsets.
- **Test 39**: Owner can manually trigger lunch finalization via `POST /api/owner/automation/finalize-lunch`.
- **Test 40**: Customer cannot access owner automation endpoints (403 Forbidden).
- **Test 41**: Owner can inspect scheduler status via `GET /api/owner/automation/status`.

---

## 11. Phase 5 Architecture: Meal Token & Exactly-Once Tiffin Deduction

### 1. Token Format
The human-readable meal token string follows the strict specification:
```
DD-MM-MEAL-LOCATION-SSS
```
Where:
- `DD`: 2-digit calendar day in Asia/Kolkata (IST)
- `MM`: 2-digit calendar month in Asia/Kolkata (IST)
- `MEAL`:
  - `LU` = `LUNCH`
  - `DN` = `DINNER` *(Do NOT use `01`/`02`)*
- `LOCATION`:
  - `R` = `RESTAURANT`
  - `C` = `COLLEGE`
- `SSS`: 3-digit sequential serial number (`001`, `002`, `003`, ...)

#### Examples:
- `30-09-LU-R-001` (30 Sep Lunch Restaurant, 1st token)
- `30-09-LU-C-001` (30 Sep Lunch College, 1st token)
- `30-09-DN-R-001` (30 Sep Dinner Restaurant, 1st token)

### 2. Component Mapping
| Domain Enum | Code | Notes |
| :--- | :--- | :--- |
| `MealType.LUNCH` | `LU` | Valid for `RESTAURANT` & `COLLEGE` (weekday); `RESTAURANT` only (weekends) |
| `MealType.DINNER` | `DN` | Valid for `RESTAURANT` only (Monday-Saturday); Sunday dinner prohibited |
| `MealLocation.RESTAURANT` | `R` | Allowed for Lunch and Dinner |
| `MealLocation.COLLEGE` | `C` | Allowed for Lunch only. Invalid for Dinner. |

### 3. Counter Rules & Independence
Counters are stored in the `MealCounter` table and scoped by the composite unique key:
```prisma
@@unique([date, mealType, location])
```
Because each combination is tracked independently:
- `30-09-LU-R` starts at `001`
- `30-09-LU-C` starts at `001`
- `30-09-DN-R` starts at `001`

### 4. Counter Concurrency & PostgreSQL Rollback
- Counters are incremented within an atomic PostgreSQL transaction using `tx.mealCounter.upsert`.
- If any subsequent step in the transaction fails (such as token constraint violation or insufficient balance), PostgreSQL rolls back the transaction. The counter update is reverted, ensuring no serial numbers are wasted or skipped on failure.

### 5. Exactly-Once Tiffin Deduction Rule
- Attendance marking, poll voting, and owner attendance edits **NEVER** deduct tiffins.
- A tiffin is deducted **EXACTLY ONCE** if and only if a `MealToken` is successfully created.
- Each successful token creation records a `TiffinTransaction` with `quantity = -1` and `type = "MEAL_TOKEN"`.
- Ledger invariant:
  $$\sum \text{TiffinTransaction.quantity} == \text{CustomerProfile.remainingTiffins}$$

### 6. Atomic Conditional Balance Decrement
- Balance pre-check requires `remainingTiffins > 0`. If `0`, rejects immediately with `409 Conflict`.
- Inside the transaction, balance is decremented using an atomic conditional update:
  ```javascript
  await tx.customerProfile.updateMany({
    where: { id: customerId, remainingTiffins: { gt: 0 } },
    data: { remainingTiffins: { decrement: 1 } }
  });
  ```
- If two requests race for a customer with `balance = 1`, exactly one will match `count = 1`. The second receives `count = 0` and rolls back with `409 Conflict`.
- Balance can **never** become negative.

### 7. Idempotency Guarantees
- The `MealToken` table enforces `@@unique([attendanceId])`.
- If an attendance already has an issued token, `generateMealToken` returns the existing token immediately with `isNew: false`.
- No new counter is allocated, no duplicate `MealToken` is written, no duplicate ledger entry is logged, and no additional balance is deducted.

### 8. Protected Attendance Records
- If an attendance record has an associated `MealToken`, owner updates via `PATCH /api/owner/attendance/:id` that attempt to alter its `status` or `location` are rejected with `409 Conflict`.
- Prevents invalidating meals that have already had tokens issued or tiffins deducted.

---

## 12. Phase 6 Architecture: Suspensions, Recharge & Messages

### 1. Centralized Eligibility Architecture (`customerEligibilityService.js`)
Service and payment statuses are evaluated cleanly and deterministically:
```javascript
getCustomerServiceStatus(customerId, date)
```
- **Service Suspension**: Checks `ServiceSuspension` table for any active record where `startDate <= requestedDate <= endDate`.
- **Payment Suspension**: Derived dynamically from `remainingTiffins <= 0`. Never uses redundant boolean flags that could drift from ledger reality.
- **Combined State**: Both states are independent and neither destroys the other:
  - If service is suspended and balance == 0: `serviceStatus = "SERVICE_SUSPENDED"` (primary operational status), with both `isServiceSuspended = true` and `isPaymentSuspended = true` explicitly flagged.

### 2. Service Suspension Behavior
- Configured by OWNER for an inclusive date range (`startDate` to `endDate`) with optional reason.
- **Enforcement**:
  - `POST /api/customer/attendance`: Rejected with 400 Bad Request if service is suspended for that date.
  - `POST /api/customer/poll/vote`: Rejected with 400 Bad Request.
  - `GET /api/customer/poll/today`: Marks `eligible = false` with `reason: "SERVICE_SUSPENDED"`.
  - `POST /api/owner/meal-tokens/:attendanceId`: Strictly rejected; no meal token, no counter increment, no balance deduction.
- **Zero Tiffin Consumption**: Suspensions **never** consume tiffins or create transactions.
- **Early Unsuspension**: OWNER can terminate a suspension early via `PATCH .../unsuspend`.
  - If the suspension starts in the future, it is removed.
  - If currently active, `endDate` is truncated to yesterday, leaving future dates open.
  - Past attendance records marked `ABSENT` remain unchanged.
- **Auditing**: Every suspension and unsuspension action creates an `AuditLog` entry (`OWNER_SERVICE_SUSPENDED`, `OWNER_SERVICE_UNSUSPENDED`).

### 3. Payment Suspension Behavior
- Automatically active whenever `CustomerProfile.remainingTiffins <= 0`.
- **Allowed Operations**:
  - Customer can login, fetch profile (`GET /api/customer/me`), view remaining tiffins (0), and send messages/queries to the owner.
- **Blocked Operations**:
  - Customer cannot mark attendance (`POST /api/customer/attendance` returns 409 Conflict).
  - Customer cannot vote in the lunch poll (`POST /api/customer/poll/vote` returns 409 Conflict).
  - Meal token generation is blocked (`409 Conflict`).
- **Non-Negative Balance Invariant**: Tiffins can never decrement below 0.

### 4. Owner Cash Recharge
- OWNER adds a positive integer quantity of tiffins (`POST /api/owner/customers/:customerId/recharge`).
- **Atomic Transaction**:
  1. Increment `CustomerProfile.remainingTiffins` by `+amount`.
  2. Create immutable `TiffinTransaction` with `quantity = +amount` and `type = "CASH_RECHARGE"`.
  3. Create `AuditLog` entry with `action = "OWNER_CASH_RECHARGE"`.
- **Automatic Unblocking**: The customer's balance is now `> 0`, immediately and automatically lifting payment suspension without requiring manual state sync.
- **Ledger Invariant**:
  $$\sum \text{TiffinTransaction.quantity} == \text{CustomerProfile.remainingTiffins}$$

### 5. Customer & Owner Messages
- Implemented on the existing `Message` model (`UNREAD`, `READ`, `RESOLVED`).
- **Customer**: Can create queries/complaints/requests (`POST /api/customer/messages`) and view their own message history (`GET /api/customer/messages`). Customers cannot view other customers' messages or mark messages as resolved.
- **Owner**: Can list messages (`GET /api/owner/messages`), mark as `READ` (`PATCH ...`), and mark as `RESOLVED` (`PATCH ...`), capturing `readAt` and `resolvedAt` timestamps.

---

## 13. Phase 7 Architecture: Automatic Daily Meal Finalization & Scheduler

### 1. Single Authoritative Token & Deduction Path
Automation **never** manipulates tiffin balance directly (`remainingTiffins -= 1`), creates `MealToken` records directly, or inserts ledger entries independently.
Instead, the automated workflow operates strictly as:
```
dailyFinalizationService
    ↓
find eligible customer / prepare attendance (status: PRESENT, location: RESTAURANT, source: AUTO)
    ↓
mealTokenService.generateMealToken(attendance.id)
    ↓
Phase 5 atomic transaction (MealCounter allocation, MealToken creation, -1 ledger entry, conditional balance decrement, audit log)
```

### 2. Business Time & Calendar Enforcement
- All decisions operate strictly in **India Standard Time (`Asia/Kolkata`: UTC+5:30)** via `businessTime.js`.
- Eliminates server timezone discrepancies and ensures deterministic daily boundaries.

### 3. 4:00 PM IST Lunch Finalization Rules
- Executes Monday through Saturday at 16:00 IST:
  - **UNMARKED Lunch**: Converted to `PRESENT`, `location: RESTAURANT`, `source: AUTO`, followed by meal token generation and `-1` tiffin deduction.
  - **Existing PRESENT + COLLEGE**: Retained as `COLLEGE`; no modification, no duplicate token.
  - **Existing PRESENT + RESTAURANT**: If token already exists, do nothing (`alreadyFinalized`). If missing token, generate missing token.
  - **Existing ABSENT**: Untouched; no token, no deduction (`skippedAbsent`).
  - **Service Suspended**: Marked `ABSENT` with source `SUSPENSION`; no token, no deduction (`skippedSuspended`).
  - **Payment Suspended (`remainingTiffins <= 0`)**: Skipped; not converted to paid meal (`skippedPaymentSuspended`).
  - **Poll Votes**: Automation never creates poll votes.

### 4. 11:00 PM IST Dinner Finalization Rules
- Executes Monday through Saturday at 23:00 IST:
  - **UNMARKED Dinner**: Converted to `PRESENT`, `location: RESTAURANT`, `source: AUTO`, followed by meal token generation and `-1` tiffin deduction.
  - **Existing PRESENT**: If token exists, do nothing (`alreadyFinalized`). If missing, token is generated.
  - **Existing ABSENT**: Untouched (`skippedAbsent`).
  - **Sunday Dinner Rule**: Strictly excluded! Sunday has no dinner service. The service aborts immediately with 0 processed records.

### 5. Saturday & Weekend Rules
- Saturday Lunch operates as restaurant service (no poll).
- Saturday Dinner operates as restaurant service.
- Sunday Lunch operates as restaurant service (no poll).
- Sunday Dinner is completely unavailable.

### 6. Idempotency & Concurrency Safety
- **Rerunnability**: Running finalization 1 time or 10 times yields identical state. Existing tokens return `isNew: false` and are counted as `alreadyFinalized`.
- **Database-Level Protection**:
  - `Attendance` enforces `@@unique([customerId, date, mealType])`.
  - `MealToken` enforces `@unique([attendanceId])`.
  - Concurrent executions are safely serialized; duplicate tokens and double deductions are impossible.
- **Balance = 1 Race Condition**: If a customer has 1 tiffin remaining and two processes compete, the atomic conditional update `where: { remainingTiffins: { gt: 0 } }` ensures exactly one succeeds. Balance reaches 0 and never goes negative.

### 7. Scheduler Implementation (`dailyScheduler.js`)
- Uses `node-cron` with explicit `timezone: "Asia/Kolkata"`.
- Schedules:
  - `0 16 * * *` (4:00 PM IST Lunch)
  - `0 23 * * *` (11:00 PM IST Dinner)
- Initialized on server start in `server.js`, stopped gracefully on `SIGTERM` / `SIGINT`.
- Isolated from unit test execution (tests run through `app.js`).

### 8. Manual Testing Mechanism
- Owner-only HTTP endpoints enable deterministic testing without waiting for 16:00 or 23:00 IST:
  - `POST /api/owner/automation/finalize-lunch`
  - `POST /api/owner/automation/finalize-dinner`
  - `GET /api/owner/automation/status`

---

---

## 14. Phase 8 Architecture: Owner Analytics & Operational Summary APIs

### 1. Architectural Principles
- **Strict Read-Only Guarantee**: Analytics endpoints perform **zero** mutations. They never create tokens, never deduct tiffins, never modify attendance, never alter messages, and never alter customer balances or suspensions.
- **Authoritative Data Sources**: All statistics are calculated directly from transactional tables in PostgreSQL:
  - `Attendance`: Authoritative for physical presence/absence and meal locations.
  - `MealToken`: Authoritative for consumed meals and issued meal tokens. (`PRESENT` attendance without a `MealToken` is never counted as a consumed tiffin).
  - `TiffinTransaction`: Authoritative double-entry ledger for historical tiffin flow (`INITIAL_BALANCE`, `CASH_RECHARGE`, `MEAL_TOKEN`, `ADJUSTMENT`).
  - `CustomerProfile`: Authoritative for current point-in-time balance snapshot (`remainingTiffins`).
  - `ServiceSuspension`: Authoritative for suspension records and affected customer metrics.
  - `Poll` & `PollVote`: Authoritative for lunch location voting.
  - `Message`: Authoritative for communication status (`UNREAD`, `READ`, `RESOLVED`).

### 2. Role-Based Access Control
- All 12 analytics endpoints require `requireAuth` + `requireRole("OWNER")`.
- Authenticated `CUSTOMER` users receive `403 Forbidden`.
- Unauthenticated requests receive `401 Unauthorized`.

### 3. Date & Timezone Semantics (Asia/Kolkata)
- All date queries represent business calendar dates in **Asia/Kolkata (`UTC+5:30`)**.
- Validated with strict `YYYY-MM-DD` calendar parsing; malformed dates, impossible dates (e.g. `2026-02-30`), and inverted ranges (`from > to`) return `400 Bad Request`.
- **Default Range**: When `from` and `to` are omitted, both default to the current business date in IST (`getISTComponents(getNow()).dateString`).
- **Timestamp Filtering**: For timestamped models (`TiffinTransaction.createdAt`, `Message.createdAt`), calendar ranges `[from, to]` are translated into IST day boundaries:
  $$\text{fromTimestamp} = \text{IST midnight of } from, \quad \text{toTimestampExclusive} = \text{IST midnight of } (to + 1 \text{ day})$$

### 4. Endpoints & Metrics Summary
| Endpoint | Query Params | Key Metrics Returned |
| :--- | :--- | :--- |
| `GET /api/owner/analytics/overview` | `from`, `to` | High-level operational summary across customers, attendance, meals, locations, tiffins, polls, messages. |
| `GET /api/owner/analytics/attendance` | `from`, `to` | Daily breakdown of lunch/dinner attendance (`present`, `absent`, `unmarked`) and summary totals. |
| `GET /api/owner/analytics/locations` | `from`, `to` | Authoritative location breakdown (`RESTAURANT` vs `COLLEGE`) based exclusively on `Attendance.location`. |
| `GET /api/owner/analytics/meals` | `from`, `to` | Consumed meals counted exclusively from issued `MealToken` records (lunch, dinner, total, daily breakdown). |
| `GET /api/owner/analytics/tiffins` | `from`, `to` | Authoritative tiffin quantities by transaction type (`initialBalance`, `cashRecharge`, `mealConsumption`, `adjustments`), net change, and transaction counts. |
| `GET /api/owner/analytics/balances` | *None* | Point-in-time balance distribution: `totalCustomers`, `totalRemainingTiffins`, `averageTiffins`, `lowBalance` ($\le 10$), `veryLowBalance` ($\le 5$), `paymentPending` ($= 0$). |
| `GET /api/owner/analytics/customer-status`| `date` | Snapshot of customer states: `total`, `active`, `serviceSuspended` (evaluated on specified date), `paymentSuspended` (`remainingTiffins <= 0`). |
| `GET /api/owner/analytics/suspensions` | `from`, `to` | Total suspension records, distinct customers affected, currently active suspensions, and completed suspensions. |
| `GET /api/owner/analytics/polls` | `from`, `to` | Total weekday lunch polls, total votes cast, and choice breakdown (`COLLEGE` vs `RESTAURANT`). Saturdays and Sundays excluded. |
| `GET /api/owner/analytics/messages` | `from`, `to` | Total customer queries received and breakdown by state: `unread`, `read`, `resolved`. |
| `GET /api/owner/analytics/tokens` | `from`, `to` | Authoritative meal token counts by meal type (`LUNCH`, `DINNER`), location (`RESTAURANT`, `COLLEGE`), and daily breakdown. |
| `GET /api/owner/analytics/daily` | `date` | Comprehensive operational snapshot for a specific day: lunch/dinner attendance, token counts, tiffins consumed, and poll availability (Sunday dinner unavailable: `available: false`; Saturday poll unavailable: `available: false`). |

### 5. Query & Performance Strategy
- **Zero N+1 Query Loops**: No per-customer database round trips in loops.
- **Database-Level Aggregation**: Leverages Prisma `count`, `groupBy`, and `aggregate` (`_sum`) to push aggregation computations down to PostgreSQL.
- **Bounded Scans**: All queries are strictly bounded by indexed business date ranges (`date >= fromDate AND date <= toDate`) or timestamp intervals.

---

## 15. Features Deferred to Future Phases

The following capabilities are deliberately **NOT** implemented in Phase 8:
- ❌ XLSX / Excel report export (Scheduled for Phase 9)
- ❌ Railway cloud deployment & production hosting
- ❌ Frontend client integration (swayamsiddha-frontend)



