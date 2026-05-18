// config/index.js
// Centralized configuration management.
// Enforces required environment variables and never silently falls back
// to insecure defaults in a production environment.

require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.JWT_SECRET) {
    throw new Error('FATAL: JWT_SECRET environment variable is required in production.');
}

if (isProduction && !process.env.MONGODB_URI) {
    throw new Error('FATAL: MONGODB_URI environment variable is required in production.');
}

// In production these MUST be set. In development, safe defaults are used.
module.exports = {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: parseInt(process.env.PORT, 10) || 3000,
    MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/chat_app_db',
    JWT_SECRET: process.env.JWT_SECRET || 'dev-only-insecure-secret-change-in-production',
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '1h',
    // Allowed CORS origins (comma-separated in env, e.g., "http://localhost:3000,https://yourapp.com")
    CORS_ORIGINS: process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',')
        : ['http://localhost:3000'],
    RATE_LIMIT: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 20,                    // max 20 login attempts per window
    },
};
