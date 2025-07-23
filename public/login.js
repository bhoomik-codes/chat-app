document.addEventListener('DOMContentLoaded', () => {
    const loginButton = document.getElementById("submitPass");
    if (loginButton) {
        loginButton.addEventListener('click', handleLogin);
    }
});

/**
 * Displays a temporary message box with a given message and type.
 * @param {string} message The message to display.
 * @param {string} type The type of message ('success' or 'error').
 */
function showMessage(message, type = 'error') {
  const messageBox = document.getElementById("messageBox");
  if (!messageBox) return;

  messageBox.textContent = message;
  messageBox.className = `message-box ${type}`; // Apply CSS class for styling
  messageBox.style.display = "block"; // Show the message box

  setTimeout(() => {
    messageBox.style.display = "none"; // Hide after 3 seconds
  }, 3000);
}

/**
 * Handles the login attempt when the submit button is clicked.
 * Fetches username and password, sends them to the server, and handles the response.
 */
async function handleLogin() {
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");

  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();

  if (!username || !password) {
    showMessage("Please enter both username and password.", "error");
    return;
  }

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });

    const data = await response.json();

    if (data.success) {
      showMessage(data.message, "success");
      // Store authenticated username AND the JWT token in localStorage
      localStorage.setItem("authenticatedUsername", data.username);
      localStorage.setItem("authToken", data.token); // Store the JWT

      // Redirect to home page after a short delay
      setTimeout(() => {
        location.href = "/home.html";
      }, 1000);
    } else {
      showMessage(data.message, "error");
    }
  } catch (error) {
    console.error('Login API call failed:', error);
    showMessage('An error occurred during login. Please try again.', 'error');
  }
}
