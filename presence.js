const { createClient } = require('redis');

// Initialize Redis Client safely for Upstash Cloud TLS
const redisClient = createClient({
  url: process.env.REDIS_URL,
  socket: {
    tls: true,
    rejectUnauthorized: false
  }
});

redisClient.on('error', (err) => console.error('❌ Redis Presence Error:', err));

/**
 * Connects to Redis (Call this during server boot or before execution)
 */
async function connectPresence() {
  if (!process.env.REDIS_URL) {
    console.error('❌ REDIS_URL environment variable is missing in Vercel settings!');
    return;
  }

  if (!redisClient.isOpen) {
    await redisClient.connect();
    console.log('⚡ Redis Presence Manager Connected');
  }
}

/**
 * Saves user session to Redis on connection.
 * Key existence = User is Online.
 */
async function addUserRadis(userId, socketId, serverId, selectedId = null) {
  if (!userId) return;
  await connectPresence(); // Ensure connected before query
  const key = `user:${userId}:presence`;

  await redisClient.hSet(key, {
    socketId: String(socketId),
    serverId: String(serverId),
    selectedId: selectedId ? String(selectedId) : '' // Stores active contact_id or empty string
  });
}

async function updateUserSelectedChat(userId, selectedId = null) {
  if (!userId) return;
  await connectPresence();
  const key = `user:${userId}:presence`;

  await redisClient.hSet(key, 'selectedId', selectedId ? String(selectedId) : '');
}

/**
 * Removes user key completely from Redis on disconnection.
 */
async function removeUserRadis(userId) {
  if (!userId) return;
  await connectPresence();
  const key = `user:${userId}:presence`;
  await redisClient.del(key);
}

/**
 * Fetches user metadata from Redis ($O(1)$ Hash Get).
 * Returns null if key does not exist (User Offline).
 */
async function getUserRadis(userId) {
  if (!userId) return null;
  await connectPresence();
  const key = `user:${userId}:presence`;
  const data = await redisClient.hGetAll(key);

  if (!data || Object.keys(data).length === 0) {
    return null; // Key does not exist -> User is Offline
  }
  return data; // Key exists -> User is Online
}

module.exports = {
  connectPresence,
  addUserRadis,
  updateUserSelectedChat,
  removeUserRadis,
  getUserRadis,
};