// quaryfuns.js
const db = require('../config/db');

/**
 * 1. Fetches ALL contacts for a given user without loading messages.
 * Fetch messages on demand when a user clicks on a contact.
 */
async function fetchAllContacts(userId) {
  const query = `
SELECT 
  c.id AS contact_id,
  c.status,
  c.initiated_by,
  c.unread,
  c.created_at AS contact_created_at,
  -- Pick your rank depending on which side of the relationship you sit on
  CASE 
    WHEN c.user_low = $1 THEN c.user_low_rank 
    ELSE c.user_high_rank 
  END AS rank,
  
  -- Package the friend's profile into a single JSON object
  jsonb_build_object(
    'id', u.id,
    'name', u.name,
    'email', u.email,
    'avatar_url', u.avatar_url
  ) AS contact

FROM contacts c

-- STEP 1: Identify which ID belongs to your friend
CROSS JOIN LATERAL (
  SELECT CASE 
    WHEN c.user_low = $1 THEN c.user_high 
    ELSE c.user_low 
  END AS friend_id
) f

-- STEP 2: Join the users table directly using that friend_id
JOIN users u ON u.id = f.friend_id

WHERE c.user_low = $1 OR c.user_high = $1
ORDER BY rank ASC;
  `;

  try {
    const { rows } = await db.query(query, [userId]);
    return rows;
  } catch (err) {
    console.error('Error fetching all contacts:', err);
    throw err;
  }
}

/**
 * 2. Fetch user profile details by ID
 */
async function getUserById(userId) {
  try {
    const { rows } = await db.query(
      `SELECT id, email, name, avatar_url FROM users WHERE id = $1;`,
      [userId]
    );
    return rows[0] || null;
  } catch (err) {
    console.error('Error in getUserById:', err);
    throw err;
  }
}

/**
 * 3. Delete ONLY message history and move contact to bottom (with rank re-indexing)
 */
async function deleteMessagesBetweenUsers(userId1, userId2) {
  try {
    // Execute SQL query to delete all messages exchanged between userId1 and userId2
    const result = await db.query(
      `DELETE FROM messages 
       WHERE (sender_id = $1 AND receiver_id = $2)
          OR (sender_id = $2 AND receiver_id = $1);`,
      [userId1, userId2]
    );

    // Return success along with the count of deleted messages
    return { 
      success: true, 
      deletedCount: result.rowCount 
    };

  } catch (error) {
    console.error('Error deleting messages:', error);
    throw error;
  }
}
/**
 * 4. Remove contact AND messages (re-indexes remaining ranks so no rank gap is left)
 */
async function removeContactTransaction(userId, targetId) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // 1. Delete all chat messages between the two users
    await client.query(
      `DELETE FROM messages 
       WHERE (sender_id = $1 AND receiver_id = $2)
          OR (sender_id = $2 AND receiver_id = $1);`,
      [userId, targetId]
    );

    // 2. Delete the contact relationship row
    await client.query(
      `DELETE FROM contacts 
       WHERE (user_low = $1 AND user_high = $2)
          OR (user_low = $2 AND user_high = $1);`,
      [userId, targetId]
    );

    await client.query('COMMIT');
    return { success: true };

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error in removeContactTransaction:', err);
    throw err;
  } finally {
    client.release();
  }
}
async function getMessagesBetweenUsers(userId1, userId2) {
  try {
    const { rows } = await db.query(
      `SELECT id, sender_id, receiver_id, content, status, created_at 
       FROM messages 
       WHERE (sender_id = $1 AND receiver_id = $2) 
          OR (sender_id = $2 AND receiver_id = $1)
       ORDER BY created_at ASC;`,
      [userId1, userId2]
    );
    return rows;
  } catch (err) {
    console.error('Error in getMessagesBetweenUsers:', err);
    throw err;
  }
}

async function deleteContactBetweenUsers(userId1, userId2) {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM contacts 
       WHERE user_low = LEAST($1::uuid, $2::uuid) 
         AND user_high = GREATEST($1::uuid, $2::uuid);`,
      [userId1, userId2]
    );

    return {
      success: true,
      deleted: rowCount > 0
    };
  } catch (err) {
    console.error('Error in deleteContactBetweenUsers:', err);
    return {
      success: false,
      error: err.message
    };
  }
}

async function createPendingContact(userId1, userId2) {
  try {
    // Ordering UUIDs lexically to satisfy user_low < user_high constraint
    const isSenderLow = String(userId1) < String(userId2);
    const userLow = isSenderLow ? userId1 : userId2;
    const userHigh = isSenderLow ? userId2 : userId1;

    const query = `
      WITH inserted AS (
        INSERT INTO contacts (
          user_low, 
          user_high, 
          status, 
          initiated_by, 
          user_low_rank, 
          user_high_rank, 
          unread
        )
        VALUES (
          $1::uuid, 
          $2::uuid, 
          'pending'::varchar, 
          $3::uuid, 
          0, 
          0, 
          0
        )
        ON CONFLICT (user_low, user_high) DO NOTHING
        RETURNING 
          id AS contact_id, 
          created_at AS contact_created_at, 
          status, 
          initiated_by,
          unread,
          user_low, 
          user_high, 
          user_low_rank, 
          user_high_rank
      )
      SELECT 
        i.contact_id,
        i.status,
        i.initiated_by,
        i.unread,
        i.contact_created_at,
        CASE 
          WHEN i.user_low = $3::uuid THEN i.user_low_rank 
          ELSE i.user_high_rank 
        END AS rank,
        jsonb_build_object(
          'id', u.id,
          'name', u.name,
          'email', u.email,
          'avatar_url', u.avatar_url
        ) AS contact
      FROM inserted i
      JOIN users u ON u.id = $4::uuid;
    `;

    const { rows } = await db.query(query, [userLow, userHigh, userId1, userId2]);
    return rows[0] || null;
  } catch (err) {
    console.error('Error in createPendingContact:', err);
    throw err;
  }
}
module.exports = {
  createPendingContact,
  fetchAllContacts,
  getMessagesBetweenUsers,
  getUserById,
  deleteMessagesBetweenUsers,
  removeContactTransaction,
  deleteContactBetweenUsers,
};