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

const REDIS_URL = process.env.REDIS_URL;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

const app = express();

// Whitelist allowed origins strictly
const allowedOrigins = [
  FRONTEND_URL.replace(/\/$/, ''),
  'http://localhost:5010',
  'http://localhost:3000'
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow non-browser requests (e.g. Server-to-Server, Postman)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error('Blocked by CORS policy'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// 1. Apply CORS & Body Parser
app.use(cors(corsOptions));
app.use(express.json());

// 2. API Routes
app.use('/api/auth', authRoutes);
app.use('/api/contacts', contacts);

// 3. HTTP & Socket Server Setup
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Register Socket handlers
registerSocketHandlers(io);

// 4. Server Initialization & Redis Adapter Setup
const startServer = async () => {
  try {
    await connectPresence();

    const pubClient = createClient({ url: REDIS_URL });
    const subClient = pubClient.duplicate();

    pubClient.on('error', (err) => console.error('❌ Redis Pub Client Error:', err));
    subClient.on('error', (err) => console.error('❌ Redis Sub Client Error:', err));

    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    console.log('⚡ Socket.io Redis Adapter Attached Successfully!');

    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🔒 CORS strictly allowed for origins:`, allowedOrigins);
    });
  } catch (err) {
    console.error('❌ Server startup failed:', err);
    process.exit(1);
  }
};

startServer();