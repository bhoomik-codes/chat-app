# KASUGAI 🐦‍⬛

> **Private messages delivered in silence.** A real-time chat platform themed around the Kasugai Crows of Demon Slayer — the birds that carry secret transmissions between Demon Slayers. Built with Node.js, Socket.IO, MongoDB, and Vanilla JS.

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white)](https://expressjs.com)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.x-010101?logo=socket.io&logoColor=white)](https://socket.io)
[![MongoDB](https://img.shields.io/badge/MongoDB-8.x-47A248?logo=mongodb&logoColor=white)](https://www.mongodb.com)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue)](LICENSE)

---

## Table of Contents

- [Features](#-features)
- [Architecture](#-architecture)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [API Reference](#-api-reference)
- [Socket.IO Events](#-socketio-events)
- [Data Models](#-data-models)
- [Security](#-security)
- [Testing Strategy](#-testing-strategy)
- [Contributing](#-contributing)
- [License](#-license)

---

## ✨ Features

> *"The Kasugai Crows are the Demon Slayer Corps' means of communication — private, swift, and untraceable."*

| Feature | Description |
|---|---|
| 🔐 **Authentication** | Separate Register & Login endpoints with JWT sessions |
| 💬 **1:1 & Group Chat** | Real-time messaging powered by Socket.IO |
| 📩 **Message Requests** | Send, accept, decline, or block incoming requests |
| 🌐 **Online Presence** | Live online/offline status updates |
| 😄 **Emoji Picker** | Integrated emoji support in all chats |
| 🔔 **Notifications** | Desktop push notifications for requests and messages |
| 🎨 **Scroll Canvas** | Collaborative real-time drawing rooms with undo/redo, HiDPI support, WebP export, and keyboard shortcuts (Ctrl+Z/Y/S) |
| 🔒 **Rate Limiting** | Brute-force protection on all auth endpoints |
| ✅ **Input Validation** | Server-side schema validation with `express-validator` |
| 🎨 **Demon Slayer Theme** | Full KASUGAI aesthetic — Blood Crimson, Lantern Gold, Deep Night palette |

---

## 🏗️ Architecture

```
┌──────────────┐     HTTP / REST      ┌──────────────────────┐
│              │ ──────────────────►  │   routes/auth.js     │
│   Browser    │                      │   (Register & Login) │
│  (Vanilla JS)│                      └──────────┬───────────┘
│              │    WebSocket (WS)               │
│              │ ──────────────────►  ┌──────────▼───────────┐
└──────────────┘                      │ sockets/chatHandlers │
                                      │  (All real-time IPC) │
                                      └──────────┬───────────┘
                                                 │
                              ┌──────────────────▼──────────────────┐
                              │           services/                  │
                              │  userService.js (N+1 query fix)      │
                              └──────────────────┬──────────────────┘
                                                 │
                              ┌──────────────────▼──────────────────┐
                              │            models/                   │
                              │  User · Chat · Message ·             │
                              │  MessageRequest · Notification       │
                              └──────────────────┬──────────────────┘
                                                 │
                              ┌──────────────────▼──────────────────┐
                              │             MongoDB                  │
                              └─────────────────────────────────────┘
```

---

## 📂 Project Structure

```
chat-app/
├── config/
│   └── index.js            # Centralized env & config (enforces secrets)
├── middleware/
│   └── auth.js             # JWT authentication middleware for HTTP routes
├── models/
│   ├── Chat.js             # Chat schema (DM & group)
│   ├── Message.js          # Message schema with readBy tracking
│   ├── MessageRequest.js   # Pending request schema
│   ├── Notification.js     # Notification schema
│   └── User.js             # User schema (bcrypt, validation)
├── public/
│   ├── canvas.html         # Collaborative drawing app
│   ├── canvas.js           # Drawing canvas logic
│   ├── home.html           # Main chat UI
│   ├── index.html          # Login / Register page
│   ├── index.js            # Chat client-side logic
│   ├── login.js            # Auth client-side handler
│   └── styles/             # CSS stylesheets
├── routes/
│   └── auth.js             # /api/auth/register & /api/auth/login
├── services/
│   └── userService.js      # Reusable business logic (batched queries)
├── sockets/
│   └── chatHandlers.js     # All Socket.IO event handlers
├── .env.example            # Environment variable template
├── .gitignore
├── package.json
└── server.js               # Thin application bootstrap
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) `>= 18.0.0`
- [MongoDB](https://www.mongodb.com/) (local or [Atlas](https://www.mongodb.com/cloud/atlas))

### 1 — Clone the repository

```bash
git clone https://github.com/your-username/chat-app.git
cd chat-app
```

### 2 — Install dependencies

```bash
npm install
```

### 3 — Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in your values (see [Environment Variables](#-environment-variables) below).

### 4 — Start the server

```bash
# Production
npm start

# Development (auto-restarts on file changes)
npm run dev
```

Open **http://localhost:3000** in your browser.

---

## ⚙️ Environment Variables

All variables are documented in [`.env.example`](.env.example).

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | HTTP server port |
| `NODE_ENV` | No | `development` | Set to `production` in deployment |
| `MONGODB_URI` | **Yes (prod)** | `localhost` URI | MongoDB connection string |
| `JWT_SECRET` | **Yes (prod)** | *(dev fallback)* | Secret for signing JWTs — min 64 chars |
| `JWT_EXPIRES_IN` | No | `1h` | JWT expiry duration |
| `CORS_ORIGINS` | No | `http://localhost:3000` | Comma-separated allowed origins |

> **⚠️ In production, `JWT_SECRET` and `MONGODB_URI` are required.** The server will throw a fatal error and refuse to start without them.

---

## 📡 API Reference

### Auth Endpoints

All auth routes are rate-limited to **20 requests per 15 minutes** per IP.

#### `POST /api/auth/register`

Creates a new user account.

**Request Body:**
```json
{
  "username": "alice",
  "password": "SecurePass1"
}
```

**Success Response `201`:**
```json
{
  "success": true,
  "message": "Account created successfully!",
  "username": "alice",
  "token": "<JWT>"
}
```

**Error Responses:** `400` (validation), `409` (username taken), `500` (server error)

---

#### `POST /api/auth/login`

Authenticates an existing user.

**Request Body:**
```json
{
  "username": "alice",
  "password": "SecurePass1"
}
```

**Success Response `200`:**
```json
{
  "success": true,
  "message": "Login successful!",
  "username": "alice",
  "token": "<JWT>"
}
```

**Error Responses:** `400` (validation), `401` (invalid credentials), `500` (server error)

---

## 🔌 Socket.IO Events

Connect by passing the JWT in the auth handshake:

```js
const socket = io({ auth: { token: localStorage.getItem('authToken') } });
```

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `requestInitialData` | *(none)* | Fetches friends, groups, requests, and online users |
| `searchUsers` | `{ searchTerm }` | Searches users and groups by name |
| `loadChatContext` | `{ targetId, isGroup }` | Loads messages or request state for a chat |
| `sendInitialMessage` | `{ targetUserId, messageContent }` | Sends a new message request to a user |
| `acceptRequest` | `{ requestId }` | Accepts a pending message request |
| `deleteRequest` | `{ requestId }` | Deletes a pending request (sender/receiver) |
| `blockRequest` | `{ requestId }` | Blocks a request (receiver only) |
| `sendMessage` | `{ chatId, messageContent }` | Sends a message to an existing chat |

### Server → Client

| Event | Description |
|---|---|
| `initialData` | Full initial state: friends, groups, requests, online users |
| `searchResults` | Search results for users and groups |
| `chatContext` | Chat messages and metadata for a selected conversation |
| `newMessage` | A new real-time message in a chat |
| `newRequestReceived` | Notification that a new message request arrived |
| `requestAccepted` | Fires for both parties when a request is accepted |
| `requestHandled` | Confirms a delete or block action |
| `userStatusUpdate` | Broadcasts a user going online or offline |
| `newNotification` | Desktop notification payload `{ title, body }` |
| `socketError` | Error feedback for a failed socket action |

---

## 🗃️ Data Models

### User
| Field | Type | Notes |
|---|---|---|
| `username` | `String` | Unique, 3–30 chars, alphanumeric + underscore |
| `password` | `String` | bcrypt-hashed, min 8 chars |
| `friends` | `[ObjectId]` | References to User documents |
| `createdAt` | `Date` | Auto-set on creation |

### Chat
| Field | Type | Notes |
|---|---|---|
| `members` | `[ObjectId]` | References to User |
| `isGroupChat` | `Boolean` | Default: `false` |
| `groupName` | `String` | Null for DMs |
| `lastMessage` | `ObjectId` | Reference to Message |

### Message
| Field | Type | Notes |
|---|---|---|
| `sender` | `ObjectId` | Reference to User |
| `chatId` | `ObjectId` | Optional (null for pending requests) |
| `content` | `String` | Required |
| `readBy` | `[ObjectId]` | References to User |

### MessageRequest
| Field | Type | Notes |
|---|---|---|
| `sender` | `ObjectId` | Reference to User |
| `receiver` | `ObjectId` | Reference to User |
| `initialMessage` | `ObjectId` | Reference to Message |
| `status` | `String` | `pending` \| `accepted` \| `rejected` \| `blocked` |

---

## 🔒 Security

This project applies defense-in-depth across all layers:

| Layer | Measure |
|---|---|
| **Authentication** | Separate `/register` and `/login` — no implicit account creation |
| **Passwords** | bcrypt with 12 salt rounds |
| **JWT** | HS256-signed, configurable expiry, verified on every socket connection |
| **Rate Limiting** | `express-rate-limit` on all auth endpoints (20 req / 15 min) |
| **Input Validation** | `express-validator` on all HTTP inputs; type/string checks on all socket payloads |
| **Authorization** | All socket operations verify the acting user is an authorized party |
| **CORS** | Restricted to explicit origin list via `CORS_ORIGINS` env var |
| **Payload Size** | Express JSON body capped at `10kb` |
| **Secrets** | Config module enforces `JWT_SECRET` presence in production |
| **Dependencies** | Zero known vulnerabilities (`npm audit`) |

---

## 🧪 Testing Strategy

The following priority matrix guides test automation efforts:

### Unit Tests (High Priority)
- `User.comparePassword()` — valid and invalid password scenarios
- `UserSchema.pre('save')` — ensures password is always hashed before persistence
- `services/userService.getOnlineUsernames()` — validates single-query batching logic

### Integration Tests (High Priority)
- `POST /api/auth/register` — success, duplicate username, validation errors
- `POST /api/auth/login` — valid credentials, wrong password, non-existent user
- Rate limiter triggers correctly after threshold

### E2E Tests (Medium Priority — recommended tool: Playwright)
- **Happy path:** Register → Login → Search user → Send request → Accept → Send message
- **Multi-session:** Verify online status updates across two browser contexts
- **Request blocking:** Blocked user cannot re-send requests

---

## 🤝 Contributing

Contributions are welcome!

1. **Fork** the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit your changes: `git commit -m 'feat: add your feature'`
4. Push to the branch: `git push origin feat/your-feature`
5. Open a **Pull Request** — please describe the change and reference any related issues

For major changes, please **open an issue first** to discuss the approach.

---

## 📄 License

ISC © [Bhoomik Sevta Jii](https://github.com/bhoomik-codes)

---

<div align="center">
  Made with ☕ and Socket.IO
</div>