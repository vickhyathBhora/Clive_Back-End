// quaryfuns.js
const db = require('../config/db');

/**
 * 1. Fetches ALL contacts for a given user without loading messages.
 * Fetch messages on demand when a user clicks on a contact.
 */
async function fetchAllContacts(userId) {
  const query = `SELECT 
  c.id AS contact_id,
  c.status,
  c.initiated_by,
  c.created_at AS contact_created_at,

  -- Pick unseen count for your side
  CASE 
    WHEN c.user_low = $1 THEN c.user_low_unseen 
    ELSE c.user_high_unseen 
  END AS unseen,

  -- Pick your rank depending on which side you sit on
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

-- Identify which ID belongs to your friend for each row
CROSS JOIN LATERAL (
  SELECT CASE 
    WHEN c.user_low = $1 THEN c.user_high 
    ELSE c.user_low 
  END AS friend_id
) f

-- Join the users table using that friend_id
JOIN users u ON u.id = f.friend_id

WHERE c.user_low = $1 OR c.user_high = $1
ORDER BY rank ASC`;

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
async function deleteMessagesByContactId(contactId) {
  try {
    const result = await db.query(
      `DELETE FROM messages WHERE contact_id = $1;`,
      [contactId]
    );

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
async function removeContact(contactId) {
  try {
    const result = await db.query(
      `DELETE FROM contacts WHERE id = $1 RETURNING *;`,
      [contactId]
    );

    return {
      success: true,
      data: result.rows[0],
    };
  } catch (err) {
    console.error('Error in removeContact:', err);
    return {
      success: false,
      message: err.message
    };
  }
}
async function getMessagesByContactId(contactId, limit = 10) {
  try {
    const { rows } = await db.query(
      `SELECT id, contact_id, sender_id, receiver_id, content, created_at 
       FROM messages 
       WHERE contact_id = $1
       ORDER BY created_at ASC
       LIMIT $2;`,
      [contactId, limit]
    );
    return rows;
  } catch (err) {
    console.error('Error in getMessagesByContactId:', err);
    throw err;
  }
}
/*async function deleteContactBetweenUsers(userId1, userId2) {
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
}*/

async function createPendingContact(senderId, receiverId) {
  try {
    const isSenderLow = String(senderId) < String(receiverId);
    const userLow = isSenderLow ? senderId : receiverId;
    const userHigh = isSenderLow ? receiverId : senderId;

    const query = `
      WITH inserted AS (
        INSERT INTO contacts (
          user_low, 
          user_high, 
          status, 
          initiated_by, 
          user_low_unseen, 
          user_high_unseen, 
          user_low_time, 
          user_high_time
        )
        VALUES (
          $1::uuid, 
          $2::uuid, 
          'pending', 
          $3::uuid, 
          0, 
          0, 
          NOW(), 
          NOW()
        )
        ON CONFLICT (user_low, user_high) DO NOTHING
        RETURNING *
      )
      SELECT 
        i.id AS contact_id,
        i.status,
        i.initiated_by,
        i.created_at AS contact_created_at,

        -- Unseen count specific to target_user
        CASE 
          WHEN i.user_low = target_user.id THEN i.user_low_unseen 
          ELSE i.user_high_unseen 
        END AS unseen,

        -- Rank specific to target_user
        CASE 
          WHEN i.user_low = target_user.id THEN i.user_low_rank 
          ELSE i.user_high_rank 
        END AS rank,

        -- Profile of the OPPOSITE contact for this recipient
        jsonb_build_object(
          'id', partner_user.id,
          'name', partner_user.name,
          'email', partner_user.email,
          'avatar_url', partner_user.avatar_url
        ) AS contact

      FROM inserted i
      -- Match both involved users so we get exactly 2 rows
      JOIN users target_user ON target_user.id IN (i.user_low, i.user_high)
      -- Match the opposite user for the nested profile payload
      JOIN users partner_user ON partner_user.id = CASE 
        WHEN target_user.id = i.user_low THEN i.user_high 
        ELSE i.user_low 
      END
      -- Guarantees rows[0] is Sender and rows[1] is Receiver
      ORDER BY CASE WHEN target_user.id = $3::uuid THEN 0 ELSE 1 END;
    `;

    // Execute query with only 3 params since $4 is no longer required in SQL
    const { rows } = await db.query(query, [userLow, userHigh, senderId]);

    // Conflict triggered -> ON CONFLICT DO NOTHING produced 0 rows -> exit immediately
    if (!rows || rows.length === 0) {
      return { success: false, message: 'Contact already exists.' };
    }

    const senderData = rows[0];   // Index 0: Formatted for sender with receiver's profile
    const receiverData = rows[1]; // Index 1: Formatted for receiver with sender's profile

    return { 
      success: true, 
      senderData: senderData,       // Main data returned for API response to sender
      receiverData: receiverData // Payload to emit via Socket.io / Push notification to receiver
    };
  } catch (err) {
    console.error('Error in createPendingContact:', err);
    throw err;
  }
}

async function acceptContact(currentUserId, targetUserId) {
  try {
    // 1. Sort UUIDs for the target contact row
    const isUser1Low = String(currentUserId) < String(targetUserId);
    const userLow = isUser1Low ? currentUserId : targetUserId;
    const userHigh = isUser1Low ? targetUserId : currentUserId;

    const query = `
      WITH shift_ranks AS (
        -- Shift existing accepted contacts down by +1 for both users
        UPDATE contacts
        SET 
          user_low_rank = CASE 
            WHEN user_low = $1::uuid OR user_low = $2::uuid THEN user_low_rank + 1 
            ELSE user_low_rank 
          END,
          user_high_rank = CASE 
            WHEN user_high = $1::uuid OR user_high = $2::uuid THEN user_high_rank + 1 
            ELSE user_high_rank 
          END
        WHERE (user_low IN ($1::uuid, $2::uuid) OR user_high IN ($1::uuid, $2::uuid))
          AND status = 'accepted'
          AND NOT (user_low = $3::uuid AND user_high = $4::uuid)
        RETURNING id
      ),
      updated_contact AS (
        -- Set the accepted request to status 'accepted' and rank 1 for both
        UPDATE contacts
        SET 
          status = 'accepted',
          user_low_rank = 1,
          user_high_rank = 1,
          user_low_unseen = 0,
          user_high_unseen = 0
        WHERE user_low = $3::uuid 
          AND user_high = $4::uuid
          AND status = 'pending'
          -- FORCES execution order: wait for shift_ranks to complete
          AND (SELECT count(*) FROM shift_ranks) >= 0
        RETURNING *
      )
      SELECT 
        c.id AS contact_id,
        c.status,
        c.initiated_by,
        c.created_at AS contact_created_at,

        CASE 
          WHEN c.user_low = $1::uuid THEN c.user_low_rank 
          ELSE c.user_high_rank 
        END AS rank,

        CASE 
          WHEN c.user_low = $1::uuid THEN c.user_low_unseen 
          ELSE c.user_high_unseen 
        END AS unseen,

        jsonb_build_object(
          'id', u.id,
          'name', u.name,
          'email', u.email,
          'avatar_url', u.avatar_url
        ) AS contact
      FROM updated_contact c
      JOIN users u ON u.id = $2::uuid;
    `;

    const { rows } = await db.query(query, [
      currentUserId, // $1
      targetUserId,  // $2
      userLow,       // $3
      userHigh       // $4
    ]);

    if (rows.length === 0) {
      return { success: false, message: 'Pending contact request not found' };
    }

    return { success: true, contact: rows[0] };
  } catch (err) {
    console.error('Error in acceptContact:', err);
    throw err;
  }
}
module.exports = {
  createPendingContact,
  fetchAllContacts,
  getMessagesByContactId,
  getUserById,
  deleteMessagesByContactId,
  removeContact,
  acceptContact,
};
