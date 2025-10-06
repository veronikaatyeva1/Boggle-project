const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const Database = require('better-sqlite3');

const app = express();

// Enhanced CORS configuration
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}));

app.use(express.json());

const PORT = 5000;

// Database setup with error handling
let db;
try {
  db = new Database('boggle.db');
  console.log('✅ Database connected successfully');
} catch (error) {
  console.error('❌ Database connection failed:', error);
  process.exit(1);
}

// Initialize database tables
try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password TEXT,
      friends TEXT DEFAULT '[]',
      friend_requests TEXT DEFAULT '{"sent": [], "received": []}',
      online INTEGER DEFAULT 0
    )
  `).run();
  console.log('✅ Database tables initialized');
} catch (error) {
  console.error('❌ Database initialization failed:', error);
}

// Test endpoint
app.get('/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Server is working!', 
    timestamp: new Date().toISOString() 
  });
});

// Get all users (for debugging)
app.get('/all-users', (req, res) => {
  try {
    const users = db.prepare('SELECT username, online FROM users').all();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Register endpoint
app.post('/register', (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }

    // Check if user exists
    const existingUser = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Create new user
    db.prepare(`
      INSERT INTO users (username, password, friends, friend_requests, online) 
      VALUES (?, ?, '[]', '{"sent": [], "received": []}', 0)
    `).run(username, password);

    res.json({ success: true, message: 'User registered successfully' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login endpoint
app.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

    if (!user) {
      return res.status(400).json({ error: 'User does not exist' });
    }

    if (user.password !== password) {
      return res.status(400).json({ error: 'Incorrect password' });
    }

    // Update online status
    db.prepare('UPDATE users SET online = 1 WHERE username = ?').run(username);

    res.json({ success: true, message: 'Login successful' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Send friend request endpoint
app.post('/send-friend-request', (req, res) => {
  try {
    const { username, targetUsername } = req.body;
    
    if (!username || !targetUsername) {
      return res.status(400).json({ error: 'Username and target username required' });
    }

    if (username === targetUsername) {
      return res.status(400).json({ error: 'Cannot add yourself as friend' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    const targetUser = db.prepare('SELECT * FROM users WHERE username = ?').get(targetUsername);

    if (!user || !targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if already friends
    const userFriends = JSON.parse(user.friends || '[]');
    if (userFriends.includes(targetUsername)) {
      return res.status(400).json({ error: 'Already friends' });
    }

    // Parse current requests
    const userRequests = JSON.parse(user.friend_requests || '{"sent": [], "received": []}');
    const targetRequests = JSON.parse(targetUser.friend_requests || '{"sent": [], "received": []}');

    // Check if request already exists
    if (userRequests.sent.includes(targetUsername)) {
      return res.status(400).json({ error: 'Friend request already sent' });
    }

    if (targetRequests.received.includes(username)) {
      return res.status(400).json({ error: 'Friend request already pending' });
    }

    // Update requests
    userRequests.sent.push(targetUsername);
    targetRequests.received.push(username);

    // Update database
    db.prepare('UPDATE users SET friend_requests = ? WHERE username = ?')
      .run(JSON.stringify(userRequests), username);
    db.prepare('UPDATE users SET friend_requests = ? WHERE username = ?')
      .run(JSON.stringify(targetRequests), targetUsername);

    res.json({ success: true, message: 'Friend request sent successfully' });

  } catch (error) {
    console.error('Send friend request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Accept friend request endpoint
app.post('/accept-friend-request', (req, res) => {
  try {
    const { username, requesterUsername } = req.body;
    
    if (!username || !requesterUsername) {
      return res.status(400).json({ error: 'Username and requester username required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    const requester = db.prepare('SELECT * FROM users WHERE username = ?').get(requesterUsername);

    if (!user || !requester) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Parse current data
    const userRequests = JSON.parse(user.friend_requests || '{"sent": [], "received": []}');
    const requesterRequests = JSON.parse(requester.friend_requests || '{"sent": [], "received": []}');

    // Check if request exists
    if (!userRequests.received.includes(requesterUsername)) {
      return res.status(400).json({ error: 'No pending friend request' });
    }

    // Remove from requests
    userRequests.received = userRequests.received.filter(u => u !== requesterUsername);
    requesterRequests.sent = requesterRequests.sent.filter(u => u !== username);

    // Add to friends
    const userFriends = JSON.parse(user.friends || '[]');
    const requesterFriends = JSON.parse(requester.friends || '[]');
    
    if (!userFriends.includes(requesterUsername)) {
      userFriends.push(requesterUsername);
    }
    
    if (!requesterFriends.includes(username)) {
      requesterFriends.push(username);
    }

    // Update database
    db.prepare('UPDATE users SET friend_requests = ?, friends = ? WHERE username = ?')
      .run(JSON.stringify(userRequests), JSON.stringify(userFriends), username);
    db.prepare('UPDATE users SET friend_requests = ?, friends = ? WHERE username = ?')
      .run(JSON.stringify(requesterRequests), JSON.stringify(requesterFriends), requesterUsername);

    res.json({ success: true, message: 'Friend request accepted' });

  } catch (error) {
    console.error('Accept friend request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Decline friend request endpoint
app.post('/decline-friend-request', (req, res) => {
  try {
    const { username, requesterUsername } = req.body;
    
    if (!username || !requesterUsername) {
      return res.status(400).json({ error: 'Username and requester username required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    const requester = db.prepare('SELECT * FROM users WHERE username = ?').get(requesterUsername);

    if (!user || !requester) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Parse current data
    const userRequests = JSON.parse(user.friend_requests || '{"sent": [], "received": []}');
    const requesterRequests = JSON.parse(requester.friend_requests || '{"sent": [], "received": []}');

    // Remove from requests
    userRequests.received = userRequests.received.filter(u => u !== requesterUsername);
    requesterRequests.sent = requesterRequests.sent.filter(u => u !== username);

    // Update database
    db.prepare('UPDATE users SET friend_requests = ? WHERE username = ?')
      .run(JSON.stringify(userRequests), username);
    db.prepare('UPDATE users SET friend_requests = ? WHERE username = ?')
      .run(JSON.stringify(requesterRequests), requesterUsername);

    res.json({ success: true, message: 'Friend request declined' });

  } catch (error) {
    console.error('Decline friend request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Cancel friend request endpoint
app.post('/cancel-friend-request', (req, res) => {
  try {
    const { username, targetUsername } = req.body;
    
    if (!username || !targetUsername) {
      return res.status(400).json({ error: 'Username and target username required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    const targetUser = db.prepare('SELECT * FROM users WHERE username = ?').get(targetUsername);

    if (!user || !targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Parse current data
    const userRequests = JSON.parse(user.friend_requests || '{"sent": [], "received": []}');
    const targetRequests = JSON.parse(targetUser.friend_requests || '{"sent": [], "received": []}');

    // Remove from requests
    userRequests.sent = userRequests.sent.filter(u => u !== targetUsername);
    targetRequests.received = targetRequests.received.filter(u => u !== username);

    // Update database
    db.prepare('UPDATE users SET friend_requests = ? WHERE username = ?')
      .run(JSON.stringify(userRequests), username);
    db.prepare('UPDATE users SET friend_requests = ? WHERE username = ?')
      .run(JSON.stringify(targetRequests), targetUsername);

    res.json({ success: true, message: 'Friend request cancelled' });

  } catch (error) {
    console.error('Cancel friend request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove friend endpoint
app.post('/remove-friend', (req, res) => {
  try {
    const { username, friendUsername } = req.body;
    
    if (!username || !friendUsername) {
      return res.status(400).json({ error: 'Username and friend username required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    const friendUser = db.prepare('SELECT * FROM users WHERE username = ?').get(friendUsername);

    if (!user || !friendUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Remove from friends lists
    const userFriends = JSON.parse(user.friends || '[]').filter(f => f !== friendUsername);
    const friendFriends = JSON.parse(friendUser.friends || '[]').filter(f => f !== username);

    // Update database
    db.prepare('UPDATE users SET friends = ? WHERE username = ?')
      .run(JSON.stringify(userFriends), username);
    db.prepare('UPDATE users SET friends = ? WHERE username = ?')
      .run(JSON.stringify(friendFriends), friendUsername);

    res.json({ success: true, message: 'Friend removed successfully' });

  } catch (error) {
    console.error('Remove friend error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get friends data endpoint
app.get('/friends-data/:username', (req, res) => {
  try {
    const { username } = req.params;
    
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Parse friends and requests
    const friends = JSON.parse(user.friends || '[]');
    const friendRequests = JSON.parse(user.friend_requests || '{"sent": [], "received": []}');

    // Get online status for each friend
    const friendsWithStatus = friends.map(friendUsername => {
      const friendUser = db.prepare('SELECT * FROM users WHERE username = ?').get(friendUsername);
      return {
        username: friendUsername,
        online: friendUser ? friendUser.online === 1 : false
      };
    });

    res.json({
      success: true,
      friends: friendsWithStatus,
      friendRequests: friendRequests
    });

  } catch (error) {
    console.error('Friends data error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Lobby endpoints
app.post('/create-lobby', (req, res) => {
  try {
    const { players } = req.body;
    const lobbyId = Math.random().toString(36).substring(2, 8);
    
    res.json({ success: true, lobbyId: lobbyId });
  } catch (error) {
    console.error('Create lobby error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout endpoint
app.post('/logout', (req, res) => {
  try {
    const { username } = req.body;
    
    if (username) {
      db.prepare('UPDATE users SET online = 0 WHERE username = ?').run(username);
    }
    
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start HTTP server
const server = app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`✅ Test endpoint: http://localhost:${PORT}/test`);
});

// WebSocket server for real-time features
const wss = new WebSocketServer({ server });
const lobbies = new Map();
const wsConnections = new Map();
const pendingInvitations = new Map();

// GAME STATE MANAGEMENT
const gameStates = new Map();
const gameTimers = new Map();

function getGameState(lobbyId) {
  if (!gameStates.has(lobbyId)) {
    gameStates.set(lobbyId, {
      timer: 180,
      foundWords: [],
      grid: null,
      startTime: null,
      isRunning: false
    });
  }
  return gameStates.get(lobbyId);
}

function updateGameState(lobbyId, updates) {
  const gameState = getGameState(lobbyId);
  Object.assign(gameState, updates);
  gameStates.set(lobbyId, gameState);
  return gameState;
}

function startGameTimer(lobbyId) {
  if (gameTimers.has(lobbyId)) {
    clearInterval(gameTimers.get(lobbyId));
  }

  const timer = setInterval(() => {
    const gameState = getGameState(lobbyId);
    if (gameState.isRunning && gameState.timer > 0) {
      gameState.timer--;
      updateGameState(lobbyId, { timer: gameState.timer });
      
      // Broadcast timer update to all players
      broadcastToLobby(lobbyId, {
        action: 'timerSync',
        lobbyId: lobbyId,
        timer: gameState.timer
      });

      // End game when timer reaches 0
      if (gameState.timer <= 0) {
        endGame(lobbyId);
      }
    }
  }, 1000);

  gameTimers.set(lobbyId, timer);
}

function endGame(lobbyId) {
  const gameState = getGameState(lobbyId);
  gameState.isRunning = false;
  
  if (gameTimers.has(lobbyId)) {
    clearInterval(gameTimers.get(lobbyId));
    gameTimers.delete(lobbyId);
  }

  broadcastToLobby(lobbyId, {
    action: 'gameEnded',
    lobbyId: lobbyId,
    foundWords: gameState.foundWords
  });

  console.log(`🎯 Game ended for lobby ${lobbyId}`);
}

wss.on('connection', (ws) => {
  console.log('🔌 New WebSocket connection');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('📨 WebSocket message:', data);

      switch (data.action) {
        case 'userOnline':
          if (data.username) {
            ws.username = data.username;
            wsConnections.set(data.username, ws);
            db.prepare('UPDATE users SET online = 1 WHERE username = ?').run(data.username);
            console.log(`✅ User online: ${data.username}`);
          }
          break;

        case 'sendInvitation':
          handleSendInvitation(data, ws);
          break;

        case 'acceptInvitation':
          handleAcceptInvitation(data, ws);
          break;

        case 'declineInvitation':
          handleDeclineInvitation(data, ws);
          break;

        case 'joinLobby':
          if (data.lobbyId && data.username) {
            if (!lobbies.has(data.lobbyId)) {
              lobbies.set(data.lobbyId, new Set());
            }
            lobbies.get(data.lobbyId).add(data.username);
            ws.lobbyId = data.lobbyId;
            
            broadcastToLobby(data.lobbyId, {
              action: 'updateLobby',
              lobbyId: data.lobbyId,
              players: Array.from(lobbies.get(data.lobbyId))
            });

            if (pendingInvitations.has(data.lobbyId)) {
              pendingInvitations.delete(data.lobbyId);
            }
          }
          break;

        case 'startGame':
          if (data.lobbyId && lobbies.has(data.lobbyId)) {
            console.log(`🎮 Starting game for lobby: ${data.lobbyId}`);
            const grid = generateBoggleGrid();
            const gameState = updateGameState(data.lobbyId, {
              grid: grid,
              timer: 180,
              foundWords: [],
              
              startTime: Date.now(),
              isRunning: true
            });

            // Start the server-side timer
            startGameTimer(data.lobbyId);

            broadcastToLobby(data.lobbyId, {
              action: 'gameStarted',
              lobbyId: data.lobbyId,
              grid: grid,
              timer: 180,
              foundWords: [],
              players: players
            });

            console.log(`✅ Game started for lobby ${data.lobbyId}`);
          }
          break;

        case 'joinGame':
          if (data.lobbyId && data.username) {
            ws.lobbyId = data.lobbyId;
            const gameState = getGameState(data.lobbyId);
            
            console.log(`🎮 ${data.username} joined game room for lobby ${data.lobbyId}`);
            
            // Send current game state to the joining player
            if (gameState.grid) {
              ws.send(JSON.stringify({
                action: 'gameStateSync',
                lobbyId: data.lobbyId,
                grid: gameState.grid,
                timer: gameState.timer,
                foundWords: gameState.foundWords,
                isRunning: gameState.isRunning
              }));
            }
          }
          break;

        case 'timerSync':
          // Client can still send sync requests, but server is now authoritative
          if (data.lobbyId && data.timer !== undefined) {
            console.log(`⏰ Client timer sync for lobby ${data.lobbyId}: ${data.timer} seconds`);
          }
          break;

        case 'wordFound':
          if (data.lobbyId && data.word) {
            const gameState = getGameState(data.lobbyId);
            if (gameState && !gameState.foundWords.includes(data.word)) {
              gameState.foundWords.push(data.word);
              updateGameState(data.lobbyId, { foundWords: gameState.foundWords });
              
              console.log(`📝 Word found in lobby ${data.lobbyId}: ${data.word}`);
              
              // Broadcast new word to all players
              broadcastToLobby(data.lobbyId, {
                action: 'wordFound',
                lobbyId: data.lobbyId,
                word: data.word,
                allWords: gameState.foundWords
              });
            }
          }
          break;

        case 'gameEnded':
          if (data.lobbyId) {
            endGame(data.lobbyId);
          }
          break;

        case 'leaveLobby':
          if (data.lobbyId && data.username) {
            handleLeaveLobby(data.lobbyId, data.username);
          }
          break;

        default:
          console.log('❓ Unknown action:', data.action);
      }
    } catch (error) {
      console.error('❌ WebSocket message error:', error);
    }
  });

  ws.on('close', () => {
    if (ws.username) {
      wsConnections.delete(ws.username);
      db.prepare('UPDATE users SET online = 0 WHERE username = ?').run(ws.username);
      console.log(`❌ User offline: ${ws.username}`);
    }

    if (ws.lobbyId) {
      handleLeaveLobby(ws.lobbyId, ws.username);
    }
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
  });
});

// Invitation handling functions
function handleSendInvitation(data, ws) {
  const { from, to, lobbyId } = data;
  
  if (!from || !to || !lobbyId) {
    console.error('Invalid invitation data');
    return;
  }

  // Check if target user is online
  const targetWs = wsConnections.get(to);
  if (!targetWs) {
    // Target user is offline
    ws.send(JSON.stringify({
      action: 'invitationFailed',
      reason: 'User is offline',
      to: to
    }));
    return;
  }

  // Store the invitation
  const invitation = {
    from: from,
    to: to,
    lobbyId: lobbyId,
    timestamp: new Date().toISOString(),
    status: 'pending'
  };
  
  pendingInvitations.set(lobbyId, invitation);

  // Send invitation to target user
  targetWs.send(JSON.stringify({
    action: 'gameInvitation',
    from: from,
    lobbyId: lobbyId,
    timestamp: invitation.timestamp
  }));

  // Set timeout for invitation (5 minutes)
  setTimeout(() => {
    if (pendingInvitations.has(lobbyId)) {
      const expiredInvitation = pendingInvitations.get(lobbyId);
      if (expiredInvitation.status === 'pending') {
        pendingInvitations.delete(lobbyId);
        
        // Notify both users
        const inviterWs = wsConnections.get(from);
        const inviteeWs = wsConnections.get(to);
        
        if (inviterWs) {
          inviterWs.send(JSON.stringify({
            action: 'invitationTimeout',
            lobbyId: lobbyId,
            to: to
          }));
        }
        
        if (inviteeWs) {
          inviteeWs.send(JSON.stringify({
            action: 'invitationTimeout',
            lobbyId: lobbyId,
            from: from
          }));
        }
      }
    }
  }, 5 * 60 * 1000); // 5 minutes

  console.log(`✅ Invitation sent from ${from} to ${to} for lobby ${lobbyId}`);
}

function handleAcceptInvitation(data, ws) {
  const { lobbyId, username, from } = data;
  
  if (!lobbyId || !username) {
    console.error('Invalid acceptance data');
    return;
  }

  const invitation = pendingInvitations.get(lobbyId);
  if (!invitation || invitation.to !== username) {
    ws.send(JSON.stringify({
      action: 'invitationError',
      reason: 'Invalid or expired invitation'
    }));
    return;
  }

  // Update invitation status
  invitation.status = 'accepted';
  
  // Notify the inviter
  const inviterWs = wsConnections.get(from);
  if (inviterWs) {
    inviterWs.send(JSON.stringify({
      action: 'invitationAccepted',
      lobbyId: lobbyId,
      by: username
    }));
  }

  // Auto-join the lobby
  if (!lobbies.has(lobbyId)) {
    lobbies.set(lobbyId, new Set());
  }
  lobbies.get(lobbyId).add(username);
  ws.lobbyId = lobbyId;

  // Add inviter to lobby if not already there
  if (!lobbies.get(lobbyId).has(from)) {
    lobbies.get(lobbyId).add(from);
    if (inviterWs) {
      inviterWs.lobbyId = lobbyId;
    }
  }

  // Broadcast updated lobby state
  broadcastToLobby(lobbyId, {
    action: 'updateLobby',
    lobbyId: lobbyId,
    players: Array.from(lobbies.get(lobbyId))
  });

  // Clean up invitation
  pendingInvitations.delete(lobbyId);

  console.log(`✅ ${username} accepted invitation to lobby ${lobbyId}`);
}

function handleDeclineInvitation(data, ws) {
  const { lobbyId, username } = data;
  
  if (!lobbyId || !username) {
    console.error('Invalid decline data');
    return;
  }

  const invitation = pendingInvitations.get(lobbyId);
  if (!invitation || invitation.to !== username) {
    return;
  }

  // Notify the inviter
  const inviterWs = wsConnections.get(invitation.from);
  if (inviterWs) {
    inviterWs.send(JSON.stringify({
      action: 'friendDeclined',
      lobbyId: lobbyId,
      by: username
    }));
  }

  // Clean up invitation
  pendingInvitations.delete(lobbyId);

  console.log(`❌ ${username} declined invitation to lobby ${lobbyId}`);
}

function handleLeaveLobby(lobbyId, username) {
  if (lobbyId && lobbies.has(lobbyId)) {
    lobbies.get(lobbyId).delete(username);
    
    if (lobbies.get(lobbyId).size === 0) {
      // Clean up game state when no players left
      if (gameStates.has(lobbyId)) {
        gameStates.delete(lobbyId);
      }
      if (gameTimers.has(lobbyId)) {
        clearInterval(gameTimers.get(lobbyId));
        gameTimers.delete(lobbyId);
      }
      lobbies.delete(lobbyId);
      console.log(`🗑️ Lobby ${lobbyId} cleaned up (no players left)`);
    } else {
      broadcastToLobby(lobbyId, {
        action: 'updateLobby',
        lobbyId: lobbyId,
        players: Array.from(lobbies.get(lobbyId))
      });
    }
    
    console.log(`🚪 ${username} left lobby ${lobbyId}`);
  }
}

function broadcastToLobby(lobbyId, message) {
  if (lobbies.has(lobbyId)) {
    const players = lobbies.get(lobbyId);
    let sentCount = 0;
    
    players.forEach(username => {
      const playerWs = wsConnections.get(username);
      if (playerWs && playerWs.readyState === 1) {
        playerWs.send(JSON.stringify(message));
        sentCount++;
      }
    });
    
    console.log(`📢 Broadcast to lobby ${lobbyId}: ${sentCount}/${players.size} players`);
  }
}

function generateBoggleGrid(size = 4) {
  const dice = [
    ['A', 'A', 'E', 'E', 'G', 'N'],
    ['E', 'L', 'R', 'T', 'T', 'Y'],
    ['A', 'O', 'O', 'T', 'T', 'W'],
    ['A', 'B', 'B', 'J', 'O', 'O'],
    ['E', 'H', 'R', 'T', 'V', 'W'],
    ['C', 'I', 'M', 'O', 'T', 'U'],
    ['D', 'I', 'S', 'T', 'T', 'Y'],
    ['E', 'I', 'O', 'S', 'S', 'T'],
    ['D', 'E', 'L', 'R', 'V', 'Y'],
    ['A', 'C', 'H', 'O', 'P', 'S'],
    ['H', 'I', 'M', 'N', 'Q', 'U'],
    ['E', 'E', 'I', 'N', 'S', 'U'],
    ['E', 'E', 'G', 'H', 'N', 'W'],
    ['A', 'F', 'F', 'K', 'P', 'S'],
    ['H', 'L', 'N', 'N', 'R', 'Z'],
    ['D', 'E', 'I', 'L', 'R', 'X']
  ];
  
  const grid = [];
  const shuffledDice = [...dice].sort(() => Math.random() - 0.5);
  
  for (let i = 0; i < size; i++) {
    const row = [];
    for (let j = 0; j < size; j++) {
      const die = shuffledDice[i * size + j];
      const letter = die[Math.floor(Math.random() * die.length)];
      row.push(letter);
    }
    grid.push(row);
  }
  
  console.log('🎲 Generated Boggle grid:', grid);
  return grid;
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('🔄 Shutting down server gracefully...');
  // Clear all game timers
  gameTimers.forEach((timer, lobbyId) => {
    clearInterval(timer);
  });
  // Set all users to offline
  db.prepare('UPDATE users SET online = 0').run();
  server.close(() => {
    console.log('✅ Server shut down successfully');
    process.exit(0);
  });
});