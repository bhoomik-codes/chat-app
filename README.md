# 💬 ChatApp v2

A modern, real-time chat application built with **Node.js**, **Express**, **Socket.IO**, **MongoDB**, and **Vanilla JS**. Includes a collaborative drawing canvas, friend system, message requests, group chats, and a beautiful, responsive UI.

---

## ✨ Features

### 🔒 Authentication & User System
- **Sign up / Login** with username and password.
- Passwords are securely hashed using **bcrypt**.
- JWT-based authentication for secure, stateless sessions.

### 🗨️ Real-Time Chat
- **1:1 and Group Chats**: Instantly message friends or groups.
- **Message Requests**: Send/accept/decline requests before chatting with new users.
- **Online Status**: See who’s online in real time.
- **Emoji Support**: Express yourself with emoji picker in chat.
- **Desktop Notifications**: Get notified of new messages and requests, even when away.

### 🖌️ Collaborative Drawing Canvas
- **Real-time collaborative drawing** with multiple users in a room.
- **Pen color & thickness**, eraser, undo/redo, and clear screen.
- **Save drawings** as PNG or JPEG.
- **Room-based**: Join by room ID, see active contributors.

### 🧑‍🤝‍🧑 Friend & Group Management
- **Friend system**: Add, accept, or block users.
- **Group chats**: Create and chat in groups with multiple users.

### 🎨 Beautiful, Responsive UI
- Modern, clean design with **responsive layouts** for desktop and mobile.
- **Dark/light backgrounds** and smooth animations.
- Built with custom CSS and [Tailwind](https://tailwindcss.com/) for the canvas.

---

## 📂 Project Structure

```
chat-app/
  models/           # Mongoose models (User, Chat, Message, MessageRequest, Notification)
  public/           # Frontend static files (HTML, JS, CSS)
    canvas.html     # Collaborative drawing app
    home.html       # Main chat UI
    index.html      # Login page
    styles/         # CSS styles
  server.js         # Express + Socket.IO backend
  package.json      # Project metadata and dependencies
```

---

## 🚀 Getting Started

### 1. **Clone the repository**
```bash
git clone <your-repo-url>
cd chat-app
```

### 2. **Install dependencies**
```bash
npm install
```

### 3. **Set up environment variables**
Create a `.env` file in `chat-app/` (optional, defaults provided):
```
MONGODB_URI=mongodb://localhost:27017/chat_app_db
JWT_SECRET=your_jwt_secret
```

### 4. **Start the server**
```bash
npm start
```
The app runs by default on [http://localhost:3000](http://localhost:3000).

---

## 🖥️ Usage

### **Login / Register**
- Open the app in your browser.
- Enter a username and password to log in or register.

### **Chat**
- See a list of users and groups.
- Click a user to send a message request.
- Accept/decline requests in the chat interface.
- Start chatting instantly with friends or groups.
- Use the emoji picker and enjoy real-time updates.

### **Collaborative Drawing**
- Open `canvas.html` for the drawing app.
- Enter your name and a room ID to join or create a drawing room.
- Draw together, undo/redo, clear, and save your artwork.

---

## 🛠️ Tech Stack

- **Backend:** Node.js, Express, Socket.IO, MongoDB, Mongoose, JWT, bcrypt
- **Frontend:** Vanilla JS, HTML5, CSS3, Tailwind CSS (for canvas)
- **Real-time:** Socket.IO for chat and drawing
- **Authentication:** JWT, bcrypt
- **Notifications:** Browser desktop notifications

---

## 📦 NPM Scripts

- `npm start` — Start the server with nodemon for auto-reload.

---

## 🗃️ Models Overview

- **User:** Username, password (hashed), friends list, createdAt
- **Chat:** Members, isGroupChat, groupName, lastMessage
- **Message:** Sender, content, chatId, readBy, timestamps
- **MessageRequest:** Sender, receiver, initialMessage, status (pending/accepted/etc)
- **Notification:** User, type, message, isRead, related entity

---

## 🎨 UI/UX Highlights

- **Login:** Clean, modern card with splash text.
- **Chat:** Sidebar for users/groups, main chat area, emoji picker, message requests, online status.
- **Drawing:** Responsive canvas, color/thickness controls, contributors list, save/export, undo/redo.

---

## 🤝 Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.

---

## 📄 License

ISC © Bhoomik Sevta Jii

---

## 🙏 Acknowledgements

- [Socket.IO](https://socket.io/)
- [Express](https://expressjs.com/)
- [MongoDB](https://www.mongodb.com/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Font Awesome](https://fontawesome.com/)
- [Emoji Picker Element](https://github.com/nolanlawson/emoji-picker-element)

---

**Enjoy chatting and collaborating!** 