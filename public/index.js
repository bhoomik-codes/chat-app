document.addEventListener('DOMContentLoaded', () => {
    const authToken = localStorage.getItem("authToken");
    if (!authToken) {
        location.href = "/";
        return;
    }

    const socket = io({ auth: { token: authToken } });

    // --- Global Variables ---
    let myUsername = localStorage.getItem("authenticatedUsername") || "";
    let currentChatContext = {};
    let friendsList = {};
    let onlineUsers = new Set();

    // --- Element Selectors ---
    const chatBox = document.getElementById("chatBox");
    const messageInput = document.getElementById("m");
    const userList = document.getElementById("userList");
    const userSearchInput = document.getElementById('userSearch');
    const chatWithHeader = document.getElementById("chat-with-header");
    const logoutButton = document.getElementById("logoutButton");
    const loggedInUsernameDisplay = document.getElementById('loggedInUsernameDisplay');
    const messageInputContainer = document.getElementById('messageInputContainer');
    const messageRequestBar = document.getElementById('messageRequestBar');
    const emojiButton = document.getElementById('emojiButton');
    const emojiPicker = document.querySelector('emoji-picker');

    // --- Audio Context for Notification Sound ---
    let audioCtx;
    function playNotificationSound() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(600, audioCtx.currentTime);
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);

        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.2);
    }

    // --- Notification Permission ---
    function requestNotificationPermission() {
        if ('Notification' in window) {
            if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
                Notification.requestPermission().then(permission => {
                    if (permission === 'granted') {
                        console.log('Notification permission granted.');
                    }
                });
            }
        }
    }
    requestNotificationPermission();

    // --- Initial Setup ---
    if (myUsername) {
        loggedInUsernameDisplay.textContent = `Logged in as: ${myUsername}`;
        socket.emit("requestInitialData");
    } else {
        location.href = "/";
    }

    // --- Core Event Listeners ---
    document.getElementById("send").addEventListener("click", sendMessage);
    messageInput.addEventListener("keypress", (e) => { if (e.key === "Enter") sendMessage(); });
    logoutButton.addEventListener('click', () => {
        localStorage.clear();
        socket.disconnect();
        location.href = "/";
    });

    userList.addEventListener("click", (e) => {
        const listItem = e.target.closest('li.user-item');
        if (listItem) {
            document.querySelectorAll('#userList .user-item.active').forEach(item => item.classList.remove('active'));
            listItem.classList.add('active');
            const targetId = listItem.dataset.id;
            const isGroup = listItem.dataset.isgroup === 'true';
            socket.emit('loadChatContext', { targetId, isGroup });
        }
    });

    userSearchInput.addEventListener('input', () => {
        const searchTerm = userSearchInput.value.trim();
        if (searchTerm === '') {
            populateUserList(friendsList);
        } else {
            socket.emit('searchUsers', { searchTerm });
        }
    });

    userSearchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const firstUserItem = userList.querySelector('.user-item');
            if (firstUserItem) {
                firstUserItem.click();
            }
        }
    });

    // --- Emoji Picker Listeners ---
    emojiButton.addEventListener('click', (e) => {
        e.stopPropagation();
        emojiPicker.classList.toggle('hidden');
    });
    emojiPicker.addEventListener('emoji-click', event => messageInput.value += event.detail.unicode);
    document.body.addEventListener('click', () => emojiPicker.classList.add('hidden'));

    // --- Socket Event Handlers ---
    socket.on('initialData', ({ friends, groups, sentRequests, receivedRequests, onlineUsers: onlineUserList }) => {
        onlineUsers = new Set(onlineUserList);
        const partners = {};

        friends.forEach(u => partners[u.username] = { type: 'user', status: 'friend', online: onlineUsers.has(u.username), _id: u._id });
        groups.forEach(g => partners[g.groupName] = { type: 'group', status: 'group', memberCount: g.members.length, _id: g._id });
        sentRequests.forEach(req => partners[req.receiver.username] = { type: 'user', status: 'requestSent', online: onlineUsers.has(req.receiver.username), _id: req.receiver._id });
        receivedRequests.forEach(req => partners[req.sender.username] = { type: 'user', status: 'requestReceived', online: onlineUsers.has(req.sender.username), _id: req.sender._id });

        friendsList = partners;
        populateUserList(partners);
    });

    socket.on('searchResults', ({ results }) => {
        const searchResultPartners = {};
        results.forEach(res => {
            if (res.type === 'user') {
                searchResultPartners[res.username] = { type: 'user', status: 'new', online: onlineUsers.has(res.username), _id: res._id };
            } else if (res.type === 'group') {
                searchResultPartners[res.groupName] = { type: 'group', status: 'group', memberCount: res.members.length, _id: res._id };
            }
        });
        populateUserList(searchResultPartners);
    });

    socket.on('userStatusUpdate', ({ username, online }) => {
        if (online) onlineUsers.add(username);
        else onlineUsers.delete(username);
        const userItemDot = document.querySelector(`li[data-username="${username}"] .status-dot`);
        if (userItemDot) userItemDot.className = `status-dot ${online ? 'online' : 'offline'}`;
    });

    socket.on('chatContext', (context) => {
        currentChatContext = context;
        chatBox.innerHTML = "";
        switch (context.type) {
            case 'existingChat':
                const chatName = context.chat.isGroupChat ? context.chat.groupName : context.chat.members.find(m => m.username !== myUsername).username;
                chatWithHeader.textContent = `Chat with ${chatName}`;
                context.messages.forEach(msg => appendMessage(msg));
                showRequestBar(false);
                showChatInput(true);
                break;
            case 'requestSent':
                chatWithHeader.textContent = `Request to ${context.request.receiver.username}`;
                appendSystemMessage("You sent a request. Awaiting response.");
                if(context.request.initialMessage) appendMessage(context.request.initialMessage);
                showRequestBar(false);
                showChatInput(false);
                break;
            case 'requestReceived':
                chatWithHeader.textContent = `Request from ${context.request.sender.username}`;
                if(context.request.initialMessage) appendMessage(context.request.initialMessage);
                showRequestBar(true, context.request);
                showChatInput(false);
                break;
            case 'new':
                chatWithHeader.textContent = `Start chat with ${context.partner.username}`;
                appendSystemMessage(`Send a message to connect with ${context.partner.username}.`);
                showRequestBar(false);
                showChatInput(true);
                break;
        }
    });

    socket.on('newMessage', ({ message }) => {
        if (currentChatContext.type === 'existingChat' && currentChatContext.chat._id === message.chatId) {
            appendMessage(message);
        }
        if (document.hidden && Notification.permission === 'granted' && message.sender.username !== myUsername) {
            new Notification(`New message from ${message.sender.username}`, {
                body: message.content,
                icon: 'https://placehold.co/40x40/6a5af9/FFFFFF?text=💬'
            });
            playNotificationSound();
        }
    });

    socket.on('newNotification', (data) => {
        if (document.hidden && Notification.permission === 'granted') {
            new Notification(data.title, {
                body: data.body,
                icon: 'https://placehold.co/40x40/6a5af9/FFFFFF?text=🔔'
            });
            playNotificationSound();
        }
    });

    const refreshAndLoadChat = (chat) => {
        userSearchInput.value = '';
        socket.emit("requestInitialData");

        setTimeout(() => {
            let targetId;
            if (chat.isGroupChat) {
                targetId = chat._id;
            } else {
                const partner = chat.members.find(member => member.username !== myUsername);
                if (partner) targetId = partner._id;
            }
            if (targetId) {
                const userItem = document.querySelector(`li[data-id="${targetId}"]`);
                if (userItem) userItem.click();
            }
        }, 150);
    };

    socket.on('requestAccepted', ({ chat }) => refreshAndLoadChat(chat));
    socket.on('initialMessageSent', () => socket.emit("requestInitialData"));
    socket.on('newRequestReceived', () => socket.emit("requestInitialData"));

    socket.on('requestHandled', () => {
        socket.emit("requestInitialData");
        chatWithHeader.textContent = "Select a user to start chatting";
        chatBox.innerHTML = "";
        showRequestBar(false);
        showChatInput(false);
    });

    function populateUserList(partners) {
        userList.innerHTML = "";
        Object.entries(partners).forEach(([name, data]) => {
            const li = document.createElement("li");
            li.className = "user-item";
            li.dataset.id = data._id;

            if (data.type === 'group') {
                li.dataset.isgroup = 'true';
                li.innerHTML = `
                    <img class="avatar" src="https://placehold.co/40x40/6a5af9/FFFFFF?text=G" alt="Group Avatar">
                    <span class="username">${name}</span>
                    <span class="status-label group">${data.memberCount} members</span>`;
            } else {
                li.dataset.isgroup = 'false';
                li.dataset.username = name;
                let statusLabel = '';
                if (data.status === 'requestSent') statusLabel = '<span class="status-label sent">Sent</span>';
                if (data.status === 'requestReceived') statusLabel = '<span class="status-label received">Request</span>';
                li.innerHTML = `
                    <img class="avatar" src="https://placehold.co/40x40/4f586a/E0E0E0?text=${name.charAt(0).toUpperCase()}" alt="Avatar">
                    <span class="username">${name}</span>
                    ${statusLabel}
                    <span class="status-dot ${data.online ? 'online' : 'offline'}"></span>`;
            }
            userList.appendChild(li);
        });
    }

    function appendMessage(msg) {
        if (!msg || !msg.sender) return;
        const isSelf = msg.sender.username === myUsername;
        const msgDiv = document.createElement("div");
        msgDiv.className = `message ${isSelf ? 'self' : 'other'}`;
        const date = new Date(msg.createdAt || Date.now());
        msgDiv.innerHTML = `
            <div class="message-content">
                <strong>${isSelf ? 'You' : msg.sender.username}</strong>
                <p>${msg.content}</p>
                <span class="timestamp">${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>`;
        chatBox.appendChild(msgDiv);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    function appendSystemMessage(text) {
        const systemDiv = document.createElement("div");
        systemDiv.className = "system-message";
        systemDiv.textContent = text;
        chatBox.appendChild(systemDiv);
    }

    function showChatInput(show) {
        messageInputContainer.classList.toggle('hidden', !show);
    }

    function showRequestBar(show, request = null) {
        messageRequestBar.classList.toggle('hidden', !show);
        if (show && request) {
            document.getElementById('requestSenderName').textContent = request.sender.username;
            document.getElementById('acceptRequestBtn').onclick = () => socket.emit('acceptRequest', { requestId: request._id });
            document.getElementById('deleteRequestBtn').onclick = () => socket.emit('deleteRequest', { requestId: request._id });
            document.getElementById('blockRequestBtn').onclick = () => socket.emit('blockRequest', { requestId: request._id });
        }
    }

    function sendMessage() {
        const content = messageInput.value.trim();
        if (!content) return;

        if (currentChatContext.type === 'existingChat') {
            socket.emit('sendMessage', { chatId: currentChatContext.chat._id, messageContent: content });
        } else if (currentChatContext.type === 'new') {
            socket.emit('sendInitialMessage', { targetUserId: currentChatContext.partner._id, messageContent: content });
        }

        messageInput.value = "";
    }
});
