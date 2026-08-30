const { createClient } = require('redis');

const redisUrl = process.env.REDIS_URL;

// Only enable TLS if the URL starts with "rediss://" (used by cloud Redis, not local)
const isTls = redisUrl.startsWith('rediss://');

const redisClient = createClient({
  url: redisUrl,
  ...(isTls && { socket: { tls: true, rejectUnauthorized: false } })
});

redisClient.on('error', (err) => console.error('❌ Redis Presence Error:', err));

async function connectPresence() {
  if (!redisClient.isOpen) {
    await redisClient.connect();
    console.log('⚡ Redis Presence Manager Connected');
  }
}
/**
 * Saves user session to Redis on connection.
 * Key existence = User is Online.
 */
async function addUserRadis(userId, socketId) {
  if (!userId) return;
  await connectPresence(); // Ensure connected before query
  const key = `user:${userId}:presence`;

  await redisClient.hSet(key, {
    socketId: String(socketId),
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