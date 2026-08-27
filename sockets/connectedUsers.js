/**
 * Binary search to find the index of a userId in a sorted array of users.
 * Uses standard string comparison suitable for UUIDs.
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

  // 'low' points to the exact sorted position where the UUID should be inserted
  return { found: false, index: low };
}

// Global sorted array: Array<{ userId: string, socketId: string }>
const connectedUsers = [];

/**
 * Inserts or updates a user in the sorted array while maintaining strict order.
 */
function addConnectedUser(userId, socketId, selectedChat = null) {
  if (!userId || !socketId) return;

  const { found, index } = binarySearch(connectedUsers, userId);

  if (found) {
    // User reconnecting/refreshing -> update socketId & maintain/set selectedChat
    connectedUsers[index].socketId = socketId;
    connectedUsers[index].selectedChat = selectedChat ? String(selectedChat) : null;
  } else {
    // Insert new user entry in sorted order
    connectedUsers.splice(index, 0, {
      userId,
      socketId,
      selectedChat: selectedChat ? String(selectedChat) : null,
    });
  }
}

function updateUserSelectedChatLocal(userId, contactId = null) {
  if (!userId) return;

  const { found, index } = binarySearch(connectedUsers, userId);
  if (found) {
    connectedUsers[index].selectedChat = contactId ? String(contactId) : null;
  }
}
/**
 * Removes a user by userId using O(log N) binary search lookup.
 */
function removeConnectedUser(userId) {
  if (!userId) return;

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
  if (!userId) return null;

  const { found, index } = binarySearch(connectedUsers, userId);
  return found ?connectedUsers[index] : null;
}

module.exports = {
  connectedUsers,
  addConnectedUser,
  updateUserSelectedChatLocal,
  removeConnectedUser,
  getSocketIdByUserId,
};