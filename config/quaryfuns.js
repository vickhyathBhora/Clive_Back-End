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
      c.created_at AS contact_created_at,
      CASE 
        WHEN c.user_low = $1 THEN c.user_low_rank 
        ELSE c.user_high_rank 
      END AS rank,
      jsonb_build_object(
        'id', u.id,
        'name', u.name,
        'email', u.email,
        'avatar_url', u.avatar_url
      ) AS contact,
      c.reqsentby
    FROM contacts c
    JOIN users u ON u.id = CASE 
      WHEN c.user_low = $1 THEN c.user_high 
      ELSE c.user_low 
    END
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
    // A. Delete message history
    await db.query(
      `DELETE FROM messages 
       WHERE (sender_id = $1 AND receiver_id = $2)
          OR (sender_id = $2 AND receiver_id = $1);`,
      [userId1, userId2]
    );

    // B. Get target contact's current rank & total contact count
    const statsRes = await db.query(
      `SELECT 
         CASE WHEN user_low = $1 THEN user_low_rank ELSE user_high_rank END AS old_rank,
         (SELECT COUNT(*) FROM contacts WHERE user_low = $1 OR user_high = $1) AS total_contacts
       FROM contacts
       WHERE (user_low = $1 AND user_high = $2) OR (user_low = $2 AND user_high = $1);`,
      [userId1, userId2]
    );

    if (statsRes.rows.length === 0) return { success: true };

    const oldRank = parseInt(statsRes.rows[0].old_rank, 10);
    const totalContacts = parseInt(statsRes.rows[0].total_contacts, 10);

    // If it's already at the bottom, no re-indexing needed
    if (oldRank === totalContacts) return { success: true };

    // C. Shift contacts that were BELOW this one UP by 1 (rank - 1)
    await db.query(
      `UPDATE contacts
       SET 
         user_low_rank = CASE 
           WHEN user_low = $1 AND user_low_rank > $2 THEN user_low_rank - 1 
           ELSE user_low_rank 
         END,
         user_high_rank = CASE 
           WHEN user_high = $1 AND user_high_rank > $2 THEN user_high_rank - 1 
           ELSE user_high_rank 
         END
       WHERE user_low = $1 OR user_high = $1;`,
      [userId1, oldRank]
    );

    // D. Move target contact to the exact last rank position (totalContacts)
    await db.query(
      `UPDATE contacts
       SET 
         user_low_rank = CASE WHEN user_low = $1 THEN $3 ELSE user_low_rank END,
         user_high_rank = CASE WHEN user_high = $1 THEN $3 ELSE user_high_rank END
       WHERE (user_low = $1 AND user_high = $2) OR (user_low = $2 AND user_high = $1);`,
      [userId1, userId2, totalContacts]
    );

    return { success: true };
  } catch (err) {
    console.error('Error in deleteMessagesBetweenUsers:', err);
    throw err;
  }
}

/**
 * 4. Remove contact AND messages (re-indexes remaining ranks so no rank gap is left)
 */
async function removeContactTransaction(userId, targetId) {
  try {
    // A. Find deleted contact's rank before deleting
    const rankRes = await db.query(
      `SELECT CASE WHEN user_low = $1 THEN user_low_rank ELSE user_high_rank END AS old_rank
       FROM contacts 
       WHERE (user_low = $1 AND user_high = $2) OR (user_low = $2 AND user_high = $1);`,
      [userId, targetId]
    );

    const oldRank = rankRes.rows[0] ? parseInt(rankRes.rows[0].old_rank, 10) : null;

    // B. Delete all messages between the two users
    await db.query(
      `DELETE FROM messages 
       WHERE (sender_id = $1 AND receiver_id = $2)
          OR (sender_id = $2 AND receiver_id = $1);`,
      [userId, targetId]
    );

    // C. Delete the contact row
    await db.query(
      `DELETE FROM contacts 
       WHERE (user_low = $1 AND user_high = $2)
          OR (user_low = $2 AND user_high = $1);`,
      [userId, targetId]
    );

    // D. Shift remaining contacts UP by 1 to fill the deleted slot
    if (oldRank !== null) {
      await db.query(
        `UPDATE contacts
         SET 
           user_low_rank = CASE 
             WHEN user_low = $1 AND user_low_rank > $2 THEN user_low_rank - 1 
             ELSE user_low_rank 
           END,
           user_high_rank = CASE 
             WHEN user_high = $1 AND user_high_rank > $2 THEN user_high_rank - 1 
             ELSE user_high_rank 
           END
         WHERE user_low = $1 OR user_high = $1;`,
        [userId, oldRank]
      );
    }

    return { success: true };
  } catch (err) {
    console.error('Error in removeContactTransaction:', err);
    throw err;
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

async function createPendingContact(userId1, userId2) {
  try {
    // Ordering UUIDs lexically for user_low and user_high constraints
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
          reqsentby
        )
        VALUES (
          $1::uuid, 
          $2::uuid, 
          'pending'::varchar, 
          $3::uuid, 
          1, 
          1, 
          $3::uuid
        )
        ON CONFLICT (user_low, user_high) DO NOTHING
        RETURNING id AS contact_id, created_at AS contact_created_at, status, user_low, user_high, user_low_rank, user_high_rank, reqsentby
      )
      SELECT 
        i.contact_id,
        i.contact_created_at,
        i.status,
        CASE 
          WHEN i.user_low = $3::uuid THEN i.user_low_rank 
          ELSE i.user_high_rank 
        END AS rank,
        json_build_object(
          'id', u.id,
          'name', u.name,
          'email', u.email,
          'avatar_url', u.avatar_url
        ) AS contact,
        i.reqsentby
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
};