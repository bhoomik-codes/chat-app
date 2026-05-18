// sockets/canvasHandlers.js
// Handles all collaborative drawing canvas Socket.IO events.
// Room state is kept in-memory (per process). For multi-process deployments,
// migrate to a Redis-backed store.
//
// Events consumed:  joinRoom, drawing, clearCanvas, undo, redo
// Events emitted:   joinedRoom, userJoined, userLeft, updateUsers,
//                   drawing, clearCanvas, undo, redo

'use strict';

/**
 * In-memory store of active drawing rooms.
 * Structure:
 *   Map<roomId, {
 *     users:   Array<{ username, socketId }>,
 *     history: Array<DrawingAction>,
 *     undone:  Array<DrawingAction>,
 *   }>
 */
const rooms = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────

function getRoom(roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, { users: [], history: [], undone: [] });
    }
    return rooms.get(roomId);
}

function getRoomUsers(roomId) {
    return (rooms.get(roomId)?.users ?? []).map(u => ({ username: u.username }));
}

function removeUserFromRoom(roomId, socketId) {
    const room = rooms.get(roomId);
    if (!room) return;
    room.users = room.users.filter(u => u.socketId !== socketId);
    if (room.users.length === 0) {
        rooms.delete(roomId); // GC empty rooms
    }
}

// ── Registration ──────────────────────────────────────────────────────────

/**
 * Registers all canvas-related Socket.IO event handlers on `io`.
 * Called once from server.js after the chat handlers are registered.
 * @param {import('socket.io').Server} io
 */
function registerCanvasHandlers(io) {

    // We listen on the same default namespace as chat.
    // Canvas events are distinguished by their event names (joinRoom, drawing…).
    io.on('connection', (socket) => {

        // ── joinRoom ─────────────────────────────────────────────────────
        socket.on('joinRoom', ({ username, roomId }) => {
            if (!username || !roomId) return;

            // Leave any previously joined canvas room on this socket
            // (in case the user navigates between rooms without disconnecting)
            if (socket._canvasRoom) {
                leaveRoom(io, socket, socket._canvasRoom);
            }

            socket.join(roomId);
            socket._canvasRoom    = roomId;
            socket._canvasUsername = username;

            const room = getRoom(roomId);
            // Avoid duplicate entries (e.g. reconnect edge cases)
            if (!room.users.find(u => u.socketId === socket.id)) {
                room.users.push({ username, socketId: socket.id });
            }

            // Send full room state to the joining client
            socket.emit('joinedRoom', {
                roomId,
                history: room.history,
                users:   getRoomUsers(roomId),
            });

            // Notify everyone else in the room
            socket.to(roomId).emit('userJoined', {
                username,
                users: getRoomUsers(roomId),
            });

            console.log(`[Canvas] ${username} joined room "${roomId}" (${getRoomUsers(roomId).length} users)`);
        });

        // ── drawing ──────────────────────────────────────────────────────
        socket.on('drawing', (action) => {
            const roomId = socket._canvasRoom;
            if (!roomId) return;

            const room = getRoom(roomId);
            room.history.push(action);
            room.undone = []; // Clear redo stack on new draw

            // Broadcast to all OTHER clients in the room
            socket.to(roomId).emit('drawing', action);
        });

        // ── drawingLive ──────────────────────────────────────────────────
        socket.on('drawingLive', (segment) => {
            const roomId = socket._canvasRoom;
            if (!roomId) return;
            // Broadcast live segment to others for instant feedback
            socket.to(roomId).emit('drawingLive', segment);
        });

        // ── clearCanvas ──────────────────────────────────────────────────
        socket.on('clearCanvas', ({ roomId, username }) => {
            const room = rooms.get(roomId);
            if (!room) return;

            room.history = [];
            room.undone  = [];

            io.to(roomId).emit('clearCanvas', { username });
        });

        // ── undo ─────────────────────────────────────────────────────────
        socket.on('undo', ({ roomId, username }) => {
            const room = rooms.get(roomId);
            if (!room || room.history.length === 0) return;

            const lastAction = room.history.pop();
            room.undone.push(lastAction);

            io.to(roomId).emit('undo', {
                username,
                history: room.history,
                undone:  room.undone,
            });
        });

        // ── redo ─────────────────────────────────────────────────────────
        socket.on('redo', ({ roomId, username }) => {
            const room = rooms.get(roomId);
            if (!room || room.undone.length === 0) return;

            const redoAction = room.undone.pop();
            room.history.push(redoAction);

            io.to(roomId).emit('redo', {
                username,
                history: room.history,
                undone:  room.undone,
            });
        });

        // ── disconnect ───────────────────────────────────────────────────
        socket.on('disconnect', () => {
            const roomId   = socket._canvasRoom;
            const username = socket._canvasUsername;
            if (!roomId || !username) return;

            leaveRoom(io, socket, roomId);
        });
    });
}

/**
 * Removes a socket from a canvas room and notifies remaining members.
 */
function leaveRoom(io, socket, roomId) {
    const username = socket._canvasUsername;
    removeUserFromRoom(roomId, socket.id);
    socket.leave(roomId);

    if (username) {
        io.to(roomId).emit('userLeft', {
            username,
            users: getRoomUsers(roomId),
        });
        console.log(`[Canvas] ${username} left room "${roomId}"`);
    }

    socket._canvasRoom     = null;
    socket._canvasUsername = null;
}

module.exports = { registerCanvasHandlers };
