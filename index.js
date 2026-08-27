const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const contacts = require('./routes/contacts');
const registerSocketHandlers = require('./sockets/socketHandler');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');

const { connectPresence } = require('./presence');
const REDIS_URL = process.env.REDIS_URL ;
const app = express();
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5010';

// Middleware
app.use(
  cors({
    origin: [FRONTEND_URL, 'http://localhost:3000'],
    credentials: true,
  })
);
app.use(express.json());

// API Routes

app.use('/api/auth', authRoutes);
app.use('/api/contacts',contacts);

// HTTP & Socket Server Setup
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [FRONTEND_URL, 'http://localhost:3000'],
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Register Sockets
registerSocketHandlers(io);

const startServer = async () => {
  try {
    // 1. Connect Redis Presence Client
    await connectPresence();

    // 2. Setup Redis Pub/Sub Adapter for Socket.io
    const pubClient = createClient({ url: REDIS_URL });
    const subClient = pubClient.duplicate();

    pubClient.on('error', (err) => console.error('❌ Redis Pub Client Error:', err));
    subClient.on('error', (err) => console.error('❌ Redis Sub Client Error:', err));

    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    console.log('⚡ Socket.io Redis Adapter Attached Successfully!');

    // 3. Listen on HTTP Port
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`CORS allowed for frontend at ${FRONTEND_URL}`);
    });
  } catch (err) {
    console.error('❌ Server startup failed:', err);
    process.exit(1);
  }
};

startServer();