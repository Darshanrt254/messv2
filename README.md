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
| `POST` | `/api/customer/attendance` | Customer only | Marks attendance (`PRESENT`/`ABSENT`). Enforces immutability. |
| `GET` | `/api/customer/poll/today` | Customer only | Returns today's lunch location poll status and eligibility |
| `POST` | `/api/customer/poll/vote` | Customer only | Casts single immutable vote (`COLLEGE`/`RESTAURANT`) |

### Owner Management Endpoints (`/api/owner`)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/owner/customers` | Owner only | Paginated list of customers (`?page=1&limit=20&search=`) |
| `GET` | `/api/owner/customers/:customerId` | Owner only | Detailed safe profile of a specific customer |
| `POST` | `/api/owner/customers` | Owner only | Transactionally creates User, CustomerProfile, and initial ledger |
| `PATCH` | `/api/owner/customers/:customerId` | Owner only | Updates basic customer info (`name`, `phone`, `profilePictureUrl`) |
| `GET` | `/api/owner/attendance` | Owner only | Operational attendance records with filters (`date`, `customerId`, `mealType`, `status`) |
| `PATCH` | `/api/owner/attendance/:attendanceId` | Owner only | Manually overrides attendance with domain validation & audit log |
| `POST` | `/api/owner/meal-tokens/:attendanceId` | Owner only | Generates meal token and executes exactly-once tiffin deduction |

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

