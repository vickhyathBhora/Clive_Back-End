/**
 * Binary search to find the index of a userId in a sorted array of users.
 * Returns { found: boolean, index: number }
 */
function binarySearch(users, userId) {
  let low = 0;
  let high = users.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midId = users[mid].userId;

    if (midId === userId) {
      return { found: true, index: mid };
    } else if (midId < userId) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return { found: false, index: low }; // 'low' is the correct insertion index
}

// Global sorted array: Array<{ userId: string, socketId: string }>
const connectedUsers = [];

/**
 * Inserts or updates a user in the sorted array.
 */
function addConnectedUser(userId, socketId) {
  const { found, index } = binarySearch(connectedUsers, userId);

  if (found) {
    // Update socketId if user reconnected with a new socket
    connectedUsers[index].socketId = socketId;
  } else {
    // Insert at the exact sorted position
    connectedUsers.splice(index, 0, { userId, socketId });
  }
}

/**
 * Removes a user by userId using binary search.
 */
function removeConnectedUser(userId) {
  const { found, index } = binarySearch(connectedUsers, userId);
  if (found) {
    connectedUsers.splice(index, 1);
  }
}

/**
 * Finds a user's socketId by userId in O(log N) time.
 * Returns socketId string or null.
 */
function getSocketIdByUserId(userId) {
  const { found, index } = binarySearch(connectedUsers, userId);
  return found ? connectedUsers[index].socketId : null;
}

module.exports = {
  connectedUsers,
  addConnectedUser,
  removeConnectedUser,
  getSocketIdByUserId,
};