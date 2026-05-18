// server.js — Application bootstrap
// This file is intentionally thin. All business logic lives in:
//   config/      — Environment & configuration
//   routes/      — HTTP route handlers
//   sockets/     — Socket.IO event handlers
//   services/    — Reusable business logic
//   models/      — Mongoose data models

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');

const config = require('./config');
const authRouter = require('./routes/auth');
const { registerChatHandlers } = require('./sockets/chatHandlers');
const { registerCanvasHandlers } = require('./sockets/canvasHandlers');

const app = express();
const server = http.createServer(app);

// ──────────────────────────────────────────────
// Socket.IO — Restricted CORS
// Fixes: Overly permissive origin: "*" (MEDIUM)
// ──────────────────────────────────────────────
const io = new Server(server, {
    cors: {
        origin: config.CORS_ORIGINS,
        methods: ['GET', 'POST'],
    },
});

// ──────────────────────────────────────────────
// Database Connection
// ──────────────────────────────────────────────
mongoose
    .connect(config.MONGODB_URI)
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => {
        console.error('❌ MongoDB connection failed:', err.message);
        process.exit(1); // Fatal — cannot run without DB
    });

// ──────────────────────────────────────────────
// Express Middleware
// ──────────────────────────────────────────────
app.use(express.json({ limit: '10kb' })); // Payload size limit to mitigate DoS
app.use(express.static(path.join(__dirname, 'public')));

// ──────────────────────────────────────────────
// HTTP Routes
// ──────────────────────────────────────────────
app.use('/api/auth', authRouter);

// Legacy alias for backwards compatibility with existing client code
// Points /api/login -> /api/auth/login
// NOTE: Clients should be updated to use /api/auth/* endpoints.
app.post('/api/login', (req, res) => res.redirect(307, '/api/auth/login'));

// SPA fallback routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/home.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'home.html')));

// ──────────────────────────────────────────────
// Socket.IO Event Handlers
// ──────────────────────────────────────────────
registerChatHandlers(io);
registerCanvasHandlers(io); // Collaborative drawing canvas rooms

// ──────────────────────────────────────────────
// Server Start
// ──────────────────────────────────────────────
server.listen(config.PORT, () => {
    console.log(`🚀 Server running at http://localhost:${config.PORT} [${config.NODE_ENV}]`);
});
