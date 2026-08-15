const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const contacts = require('./routes/contacts');
const registerSocketHandlers = require('./sockets/socketHandler');

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

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`CORS allowed for frontend at ${FRONTEND_URL}`);
});