/**
 * Attaches a rate limiter to a specific socket connection
 */
function applySocketThrottling(socket) {
  let eventTimestamps = [];
  const TIME_WINDOW_MS = 1000; // 1 sec
  const MAX_EVENTS_PER_SEC = 5;

  // Middleware that runs on EVERY incoming socket event
  socket.use(([eventName, ...args], next) => {
    const now = Date.now();

    // Clean up timestamps older than 1 second
    eventTimestamps = eventTimestamps.filter((ts) => now - ts < TIME_WINDOW_MS);
    eventTimestamps.push(now);

    if (eventTimestamps.length > MAX_EVENTS_PER_SEC) {
      console.warn(`⚠️ Socket [${socket.id}] exceeded 18 events/sec limit! Delaying processing...`);
      
      // Delay event execution by 1.5 seconds instead of dropping
      setTimeout(() => {
        next();
      }, 1500);
    } else {
      next(); // Process normally
    }
  });
}

module.exports = { applySocketThrottling };