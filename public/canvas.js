// --- Socket.IO Server URL ---
        // IMPORTANT: Replace 'http://localhost:3000' with the actual URL of your Socket.IO server.
        // You need a separate Node.js server running Socket.IO to enable real-time collaboration.
        const SOCKET_SERVER_URL = 'http://localhost:3000';

        // Get references to the canvas and its 2D rendering context
        const canvas = document.getElementById('drawingCanvas');
        const ctx = canvas.getContext('2d');

        // Get references to control elements
        const colorPicker = document.getElementById('colorPicker');
        const thicknessSlider = document.getElementById('thicknessSlider');
        const thicknessValueSpan = document.getElementById('thicknessValue');
        const eraserBtn = document.getElementById('eraserBtn');
        const clearBtn = document.getElementById('clearBtn');
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        const saveBtn = document.getElementById('saveBtn'); // New save button
        const saveFormatSelect = document.getElementById('saveFormat'); // New save format select
        const closeCanvasBtn = document.getElementById('closeCanvasBtn'); // New close button


        // Room and User Interface elements
        const roomModal = document.getElementById('roomModal');
        const usernameInput = document.getElementById('usernameInput');
        const roomInput = document.getElementById('roomInput');
        const joinRoomBtn = document.getElementById('joinRoomBtn');
        const appContainer = document.getElementById('appContainer');
        const currentRoomIdSpan = document.getElementById('currentRoomId');
        const copyRoomIdBtn = document.getElementById('copyRoomIdBtn');
        const contributorsList = document.getElementById('contributorsList');
        const notificationElem = document.getElementById('notification');

        // Drawing state variables
        let socket;
        let username = '';
        let roomId = '';
        let isDrawing = false;
        let lastX = 0;
        let lastY = 0;
        let currentColor = colorPicker.value; // Initial pen color
        let currentThickness = parseInt(thicknessSlider.value); // Initial pen thickness
        let isErasing = false; // Flag to indicate eraser mode
        let drawingHistory = []; // Stores all drawing actions for undo/redo and synchronization
        let undoneHistory = []; // Stores undone actions for redo functionality

        // --- Helper Functions ---

        // Function to show a temporary notification
        function showNotification(message, type = 'success') {
            notificationElem.textContent = message;
            notificationElem.className = 'notification show'; // Reset classes
            if (type === 'error') {
                notificationElem.classList.add('error');
            } else {
                notificationElem.classList.add('success');
            }
            setTimeout(() => {
                notificationElem.classList.remove('show');
            }, 3000); // Hide after 3 seconds
        }

        // Function to update the undo/redo button states
        function updateUndoRedoButtons() {
            undoBtn.disabled = drawingHistory.length === 0;
            redoBtn.disabled = undoneHistory.length === 0;
        }

        // Function to clear the canvas visually
        function clearCanvasVisual() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            // Optionally, fill with white if canvas background is not pure white
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        // Function to redraw the entire canvas from drawingHistory
        function redrawCanvas() {
            clearCanvasVisual(); // Clear everything first
            drawingHistory.forEach(action => {
                if (action.type === 'draw') {
                    // Temporarily set context properties for drawing this specific action
                    ctx.beginPath();
                    ctx.moveTo(action.x1, action.y1);
                    ctx.lineTo(action.x2, action.y2);
                    ctx.strokeStyle = action.color;
                    ctx.lineWidth = action.thickness;
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';
                    ctx.stroke();
                } else if (action.type === 'clear') {
                    // If a clear action is in history, clear the canvas up to that point
                    clearCanvasVisual();
                }
                // Note: Eraser actions are just drawing with white, so they are handled by 'draw'
            });

            // Restore current drawing settings after redrawing history
            ctx.strokeStyle = isErasing ? '#ffffff' : currentColor;
            ctx.lineWidth = currentThickness;
        }

        // Function to set canvas dimensions based on its parent container
        function setCanvasDimensions() {
            const container = canvas.parentElement;
            const containerWidth = container.offsetWidth;
            canvas.width = containerWidth;
            canvas.height = 500; // Keep a fixed height for the drawing area for consistency

            // Re-apply drawing styles after resizing, as canvas context can be reset
            ctx.strokeStyle = isErasing ? '#ffffff' : currentColor;
            ctx.lineWidth = currentThickness;
            ctx.lineCap = 'round'; // Round line caps for smoother lines
            ctx.lineJoin = 'round'; // Round line joins for smoother corners

            // Redraw existing content after resize to prevent loss
            redrawCanvas();
        }

        // Function to save the canvas drawing
        function saveCanvas() {
            const format = saveFormatSelect.value; // Get selected format (image/png or image/jpeg)
            const quality = format === 'image/jpeg' ? 0.9 : 1.0; // JPEG quality

            // Create a temporary canvas to draw the current state, ensuring a white background
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            tempCanvas.width = canvas.width;
            tempCanvas.height = canvas.height;

            // Fill with white background
            tempCtx.fillStyle = '#ffffff';
            tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

            // Draw the current canvas content onto the temporary canvas
            tempCtx.drawImage(canvas, 0, 0);

            // Get data URL from the temporary canvas
            const dataURL = tempCanvas.toDataURL(format, quality);
            const a = document.createElement('a');
            a.href = dataURL;
            a.download = `drawing_${Date.now()}.${format.split('/')[1]}`; // e.g., drawing_1678888888.png
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            showNotification(`Drawing saved as ${format.split('/')[1].toUpperCase()}!`);
        }

        // Function to close the canvas and return to the chat app
        function closeCanvas() {
            // Optionally, disconnect from the drawing room socket
            if (socket && socket.connected) {
                socket.disconnect();
                showNotification('Disconnected from drawing room.');
            }
            // Redirect back to home.html (or the main chat page)
            window.location.href = 'home.html';
        }

        // --- Core Drawing Functions ---

        function startDrawing(e) {
            if (!socket || !socket.connected) return; // Prevent drawing if not connected
            isDrawing = true;
            const rect = canvas.getBoundingClientRect();
            lastX = e.clientX - rect.left;
            lastY = e.clientY - rect.top;
        }

        function draw(e) {
            if (!isDrawing || !socket || !socket.connected) return;

            const rect = canvas.getBoundingClientRect();
            const currentX = e.clientX - rect.left;
            const currentY = e.clientY - rect.top;

            const action = {
                type: 'draw',
                x1: lastX,
                y1: lastY,
                x2: currentX,
                y2: currentY,
                color: isErasing ? '#ffffff' : currentColor, // Use white for eraser
                thickness: currentThickness,
                isErasing: isErasing // Store eraser state for re-rendering
            };

            // Add action to local history and emit to server
            drawingHistory.push(action);
            undoneHistory = []; // Clear redo history on new drawing
            redrawCanvas(); // Redraw to show the new stroke immediately
            updateUndoRedoButtons();

            socket.emit('drawing', action); // Emit drawing action to the server

            lastX = currentX;
            lastY = currentY;
        }

        function stopDrawing() {
            isDrawing = false;
        }

        // --- Event Listeners ---

        // Initial setup of canvas dimensions and event listeners
        window.addEventListener('load', () => {
            setCanvasDimensions(); // Set dimensions on load
            window.addEventListener('resize', setCanvasDimensions); // Re-adjust dimensions if window is resized

            // Get authentication token from localStorage
            const authToken = localStorage.getItem("authToken");

            // Check URL parameters for room ID and username
            const urlParams = new URLSearchParams(window.location.search);
            const paramRoomId = urlParams.get('roomId');
            const paramUsername = urlParams.get('username');

            if (paramRoomId && paramUsername && authToken) { // Ensure authToken is present
                // If parameters exist, auto-join the room
                username = paramUsername;
                roomId = paramRoomId;
                roomModal.classList.add('hidden'); // Hide modal
                appContainer.classList.remove('hidden'); // Show app

                // Initialize Socket.IO connection with authentication token
                socket = io(SOCKET_SERVER_URL, {
                    auth: {
                        token: authToken
                    }
                });

                // Socket.IO Event Handlers
                socket.on('connect', () => {
                    console.log('Connected to Socket.IO server');
                    socket.emit('joinRoom', { username, roomId });
                    showNotification(`Joining room: ${roomId}`);
                });

                socket.on('connect_error', (err) => {
                    console.error('Socket.IO connection error:', err);
                    showNotification('Could not connect to the drawing server. Please try again later.', 'error');
                    // Redirect to login or home if authentication fails
                    if (err.message.includes('Authentication error')) {
                        setTimeout(() => {
                            window.location.href = 'home.html'; // Or login page
                        }, 1500);
                    }
                });

                socket.on('joinedRoom', (data) => {
                    console.log(`Joined room: ${data.roomId}`);
                    currentRoomIdSpan.textContent = data.roomId;
                    drawingHistory = data.history || []; // Get initial drawing history from server
                    redrawCanvas(); // Redraw canvas with received history
                    updateUndoRedoButtons();
                    showNotification(`Welcome to room "${data.roomId}"!`);
                    updateContributorsList(data.users);
                });

                socket.on('userJoined', (data) => {
                    showNotification(`${data.username} joined the room.`);
                    updateContributorsList(data.users);
                });

                socket.on('userLeft', (data) => {
                    showNotification(`${data.username} left the room.`, 'error');
                    updateContributorsList(data.users);
                });

                socket.on('drawing', (action) => {
                    drawingHistory.push(action);
                    redrawCanvas(); // Redraw to incorporate the new action
                    updateUndoRedoButtons();
                });

                socket.on('undo', (data) => {
                    drawingHistory = data.history; // Server sends updated history after undo
                    undoneHistory = data.undone; // Server sends updated undone history
                    redrawCanvas();
                    updateUndoRedoButtons();
                    showNotification(`${data.username} performed an undo.`);
                });

                socket.on('redo', (data) => {
                    drawingHistory = data.history; // Server sends updated history after redo
                    undoneHistory = data.undone; // Server sends updated undone history
                    redrawCanvas();
                    updateUndoRedoButtons();
                    showNotification(`${data.username} performed a redo.`);
                });

                socket.on('clearCanvas', (data) => {
                    drawingHistory = []; // Clear local history
                    undoneHistory = []; // Clear undone history
                    clearCanvasVisual();
                    updateUndoRedoButtons();
                    showNotification(`${data.username} cleared the canvas.`);
                });

                socket.on('updateUsers', (users) => {
                    updateContributorsList(users);
                });

            } else {
                // If no parameters or no auth token, show the room entry modal
                roomModal.classList.remove('hidden');
                appContainer.classList.add('hidden'); // Hide app until joined
                updateUndoRedoButtons(); // Disable undo/redo initially

                // Event listener for manual join button in modal
                joinRoomBtn.addEventListener('click', () => {
                    username = usernameInput.value.trim();
                    roomId = roomInput.value.trim();

                    if (!username || !roomId) {
                        showNotification('Please enter both your name and a room ID.', 'error');
                        return;
                    }

                    // Initialize Socket.IO connection with authentication token
                    // For manual join, we still need the token if the server requires it
                    const manualAuthToken = localStorage.getItem("authToken");
                    if (!manualAuthToken) {
                        showNotification('Authentication token not found. Please log in to the chat application first.', 'error');
                        return;
                    }

                    socket = io(SOCKET_SERVER_URL, {
                        auth: {
                            token: manualAuthToken
                        }
                    });

                    // Socket.IO Event Handlers (re-attach for manual join)
                    socket.on('connect', () => {
                        console.log('Connected to Socket.IO server');
                        socket.emit('joinRoom', { username, roomId });
                        showNotification(`Joining room: ${roomId}`);
                    });

                    socket.on('connect_error', (err) => {
                        console.error('Socket.IO connection error:', err);
                        showNotification('Could not connect to the drawing server. Please try again later.', 'error');
                        if (err.message.includes('Authentication error')) {
                            setTimeout(() => {
                                window.location.href = 'home.html'; // Or login page
                            }, 1500);
                        }
                    });

                    socket.on('joinedRoom', (data) => {
                        console.log(`Joined room: ${data.roomId}`);
                        roomModal.classList.add('hidden'); // Hide modal
                        appContainer.classList.remove('hidden'); // Show app
                        currentRoomIdSpan.textContent = data.roomId;
                        drawingHistory = data.history || []; // Get initial drawing history from server
                        redrawCanvas(); // Redraw canvas with received history
                        updateUndoRedoButtons();
                        showNotification(`Welcome to room "${data.roomId}"!`);
                        updateContributorsList(data.users);
                    });

                    socket.on('userJoined', (data) => {
                        showNotification(`${data.username} joined the room.`);
                        updateContributorsList(data.users);
                    });

                    socket.on('userLeft', (data) => {
                        showNotification(`${data.username} left the room.`, 'error');
                        updateContributorsList(data.users);
                    });

                    socket.on('drawing', (action) => {
                        drawingHistory.push(action);
                        redrawCanvas(); // Redraw to incorporate the new action
                        updateUndoRedoButtons();
                    });

                    socket.on('undo', (data) => {
                        drawingHistory = data.history; // Server sends updated history after undo
                        undoneHistory = data.undone; // Server sends updated undone history
                        redrawCanvas();
                        updateUndoRedoButtons();
                        showNotification(`${data.username} performed an undo.`);
                    });

                    socket.on('redo', (data) => {
                        drawingHistory = data.history; // Server sends updated history after redo
                        undoneHistory = data.undone; // Server sends updated undone history
                        redrawCanvas();
                        updateUndoRedoButtons();
                        showNotification(`${data.username} performed a redo.`);
                    });

                    socket.on('clearCanvas', (data) => {
                        drawingHistory = []; // Clear local history
                        undoneHistory = []; // Clear undone history
                        clearCanvasVisual();
                        updateUndoRedoButtons();
                        showNotification(`${data.username} cleared the canvas.`);
                    });

                    socket.on('updateUsers', (users) => {
                        updateContributorsList(users);
                    });
                });
            }
        });


        // Function to update the list of active contributors
        function updateContributorsList(users) {
            contributorsList.innerHTML = ''; // Clear current list
            users.forEach(user => {
                const li = document.createElement('li');
                li.textContent = user.username + (user.username === username ? ' (You)' : '');
                contributorsList.appendChild(li);
            });
        }

        // Drawing event listeners (only active after joining a room)
        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDrawing);
        canvas.addEventListener('mouseout', stopDrawing);

        // Touch event listeners for mobile devices
        canvas.addEventListener('touchstart', (e) => {
            if (!socket || !socket.connected) return;
            e.preventDefault(); // Prevent scrolling/zooming
            const touch = e.touches[0];
            startDrawing({ clientX: touch.clientX, clientY: touch.clientY });
        });
        canvas.addEventListener('touchmove', (e) => {
            if (!socket || !socket.connected) return;
            e.preventDefault(); // Prevent scrolling/zooming
            const touch = e.touches[0];
            draw({ clientX: touch.clientX, clientY: touch.clientY });
        });
        canvas.addEventListener('touchend', stopDrawing);
        canvas.addEventListener('touchcancel', stopDrawing);

        // Control Panel Event Listeners
        colorPicker.addEventListener('input', (e) => {
            currentColor = e.target.value;
            isErasing = false; // Turn off eraser mode when a new color is picked
            ctx.strokeStyle = currentColor;
            eraserBtn.classList.remove('btn-primary');
            eraserBtn.classList.add('btn-secondary');
        });

        thicknessSlider.addEventListener('input', (e) => {
            currentThickness = parseInt(e.target.value);
            thicknessValueSpan.textContent = `${currentThickness}px`;
            ctx.lineWidth = currentThickness;
        });

        eraserBtn.addEventListener('click', () => {
            isErasing = !isErasing; // Toggle eraser mode
            if (isErasing) {
                ctx.strokeStyle = '#ffffff'; // Set stroke color to canvas background for erasing
                eraserBtn.classList.remove('btn-secondary');
                eraserBtn.classList.add('btn-primary');
            } else {
                ctx.strokeStyle = currentColor; // Revert to selected pen color
                eraserBtn.classList.remove('btn-primary');
                eraserBtn.classList.add('btn-secondary');
            }
        });

        clearBtn.addEventListener('click', () => {
            if (!socket || !socket.connected) return;
            // Emit clear canvas event to server
            socket.emit('clearCanvas', { roomId, username });
            // Local clear will happen when server broadcasts back
        });

        undoBtn.addEventListener('click', () => {
            if (!socket || !socket.connected) return;
            if (drawingHistory.length > 0) {
                socket.emit('undo', { roomId, username });
            }
        });

        redoBtn.addEventListener('click', () => {
            if (!socket || !socket.connected) return;
            if (undoneHistory.length > 0) {
                socket.emit('redo', { roomId, username });
            }
        });

        copyRoomIdBtn.addEventListener('click', () => {
            if (roomId) {
                // Use document.execCommand('copy') for clipboard operations in iframe
                const tempInput = document.createElement('textarea');
                tempInput.value = roomId;
                document.body.appendChild(tempInput);
                tempInput.select();
                try {
                    const successful = document.execCommand('copy');
                    const msg = successful ? 'Copied!' : 'Failed to copy.';
                    showNotification(`Room ID ${msg}`);
                } catch (err) {
                    showNotification('Failed to copy Room ID.', 'error');
                }
                document.body.removeChild(tempInput);
            }
        });

        // Event listeners for new save and close buttons
        saveBtn.addEventListener('click', saveCanvas);
        closeCanvasBtn.addEventListener('click', closeCanvas);

        // Initial canvas context settings (will be re-applied on resize)
        ctx.strokeStyle = currentColor;
        ctx.lineWidth = currentThickness;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
