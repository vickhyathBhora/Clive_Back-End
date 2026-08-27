const os = require('os');
const { connectedUsers } = require('../sockets/connectedUsers');

const MAX_CONNECTIONS = process.env.MAX_CONNECTIONS;// Hard cap for this node
const NEXT_SERVER_URL = process.env.NEXT_SERVER_URL || 'http://localhost:5001';

/**
 * Gets real-time heap/RAM usage in Megabytes
 */
function getMemoryUsageMB() {
  const memory = process.memoryUsage();
  return {
    heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024),
  };
}

/**
 * Socket Middleware: Rejects connection if Server RAM/Connections are full
 */
function socketConnectionGuard(socket, next) {
  const { heapUsedMB } = getMemoryUsageMB();
  const currentCapacity = connectedUsers.length;

  // 1. Check Connection Cap
  if (currentCapacity >= MAX_CONNECTIONS) {
    console.warn(`🛑 Server full (${currentCapacity}/${MAX_CONNECTIONS}). Redirecting to next server.`);
    const err = new Error('SERVER_FULL');
    err.data = { redirectUrl: NEXT_SERVER_URL };
    return next(err);
  }

  // 2. Check Memory Cap (Safe limit for 512MB RAM instance is ~400MB)
  if (heapUsedMB > 400) {
    console.warn(`🛑 High RAM usage (${heapUsedMB} MB). Refusing new connection.`);
    const err = new Error('SERVER_HIGH_LOAD');
    err.data = { redirectUrl: NEXT_SERVER_URL };
    return next(err);
  }

  next();
}

module.exports = {
  socketConnectionGuard,
  getMemoryUsageMB,
};