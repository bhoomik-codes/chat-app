// models/MessageRequest.js
const mongoose = require('mongoose');

const messageRequestSchema = new mongoose.Schema({
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    receiver: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    // This field is crucial for the chat request flow
    initialMessage: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message'
    },
    status: {
        type: String,
        enum: ['pending', 'accepted', 'rejected', 'blocked'],
        default: 'pending'
    }
}, { timestamps: true });

// Ensure a user can't send multiple pending requests to the same receiver
messageRequestSchema.index({ sender: 1, receiver: 1, status: 1 }, {
    unique: true,
    partialFilterExpression: { status: 'pending' }
});

const MessageRequest = mongoose.model('MessageRequest', messageRequestSchema);

module.exports = MessageRequest;
