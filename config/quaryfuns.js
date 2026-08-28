// quaryfuns.js
const db = require('../config/db');

/**
 * 1. Fetches ALL contacts for a given user without loading messages.
 * Fetch messages on demand when a user clicks on a contact.
 */
async function fetchAllContacts(userId) {
  try {
    const query = `
      SELECT 
        c.id AS contact_id,
        c.status,
        c.initiated_by,
        c.created_at AS contact_created_at,

        -- Pick unseen count for your side
        CASE 
          WHEN c.user_low = $1::uuid THEN c.user_low_unseen 
          ELSE c.user_high_unseen 
        END AS unseen,

        -- Pick your rank depending on which side you sit on
        CASE 
          WHEN c.user_low = $1::uuid THEN c.user_low_rank 
          ELSE c.user_high_rank 
        END AS rank,

        -- Pick your time depending on which side you sit on
        CASE 
          WHEN c.user_low = $1::uuid THEN c.user_low_time
          ELSE c.user_high_time 
        END AS time,

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
          WHEN c.user_low = $1::uuid THEN c.user_high 
          ELSE c.user_low 
        END AS friend_id
      ) f

      -- Join the users table using that friend_id
      JOIN users u ON u.id = f.friend_id

      WHERE c.user_low = $1::uuid OR c.user_high = $1::uuid
      ORDER BY rank ASC NULLS LAST;
    `;

    const { rows } = await db.query(query, [userId]);
const offlineContactIds = rows
      .filter((row) => row.rank === -1)
      .map((row) => row.contact_id);
if (offlineContactIds.length > 0) {
  const updateQuery = `
    UPDATE contacts
    SET 
      user_low_rank = CASE WHEN user_low = $1::uuid AND user_low_rank = -1 THEN 0 ELSE user_low_rank END,
      user_high_rank = CASE WHEN user_high = $1::uuid AND user_high_rank = -1 THEN 0 ELSE user_high_rank END
    WHERE id = $2::bigint;
  `;

  for (const contactId of offlineContactIds) {
    await db.query(updateQuery, [userId, contactId]);
  }
}
    return rows;
  } catch (err) {
    console.error('Error in fetchAllContacts:', err);
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

    const query1 = `
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
      RETURNING *;
    `;

    const { rows: contactRows } = await db.query(query1, [userLow, userHigh, senderId]);

    // Check if a row was inserted (conflict would produce 0 rows)
    if (!contactRows || contactRows.length === 0) {
      return { success: false, message: 'Contact already exists.' };
    }

    const insertedContact = contactRows[0]; // Extracted single contact row

    // Fetch user profiles only because contact row was successfully inserted
    const query2 = `
      SELECT id, name, email, avatar_url 
      FROM users 
      WHERE id IN ($1::uuid, $2::uuid);
    `;

    const { rows: userProfiles } = await db.query(query2, [senderId, receiverId]);

    const senderUser = userProfiles.find(u => u.id === senderId);
    const receiverUser = userProfiles.find(u => u.id === receiverId);

    const usersToProcess = [
      { targetUser: senderUser, partnerUser: receiverUser },
      { targetUser: receiverUser, partnerUser: senderUser }
    ];

    const results = usersToProcess.map(({ targetUser, partnerUser }) => {
      // Determine if this user sits on the low side or high side
      const isLow = insertedContact.user_low === targetUser.id;

      return {
        contact_id: insertedContact.id,
        status: insertedContact.status,
        initiated_by: insertedContact.initiated_by,
        contact_created_at: insertedContact.created_at,

        // Pick unseen, rank, and time dynamically based on user_low vs user_high
        unseen: isLow ? insertedContact.user_low_unseen : insertedContact.user_high_unseen,
        rank: isLow ? insertedContact.user_low_rank : insertedContact.user_high_rank,
        time: isLow ? insertedContact.user_low_time : insertedContact.user_high_time,

        // Attach the opposite user's profile
        contact: {
          id: partnerUser.id,
          name: partnerUser.name,
          email: partnerUser.email,
          avatar_url: partnerUser.avatar_url
        }
      };
    });

    return { 
      success: true, 
      senderData: results[0],   // Formatted object for Sender
      receiverData: results[1]  // Formatted object for Receiver
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
  RETURNING id
)
SELECT id FROM updated_contact;
    `;

  const { rows } = await db.query(query, [userId1, userId2, userLow, userHigh]);
const updatedContactId = rows[0]?.id;

    if (rows.length === 0) {
      return { success: false, message: 'Pending contact request not found' };
    }

    return { success: true, contact_id:updatedContactId };
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
