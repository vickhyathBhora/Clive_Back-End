const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../config/db'); // Import your database pool module
const nodemailer = require('nodemailer'); // Make sure nodemailer is installed

// Configure Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail', // or your SMTP provider configuration
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
// -------------------------------------------------------------------
// JWT Authentication Middleware
// Decodes the Bearer token and attaches the user payload to req.user
// -------------------------------------------------------------------
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Extract token from "Bearer <TOKEN>"

  if (!token) {
    return res.status(401).json({ message: 'Access token missing' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'your_default_jwt_secret', (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    req.user = user; // user object contains phone (e.g. req.user.phone)
    next();
  });
};

// -------------------------------------------------------------------
// GET /api/contacts/list
// Fetches all contacts for the logged-in user using dual B-Tree index
// -------------------------------------------------------------------
router.get('/list', authenticateToken, async (req, res) => {
  const userPhone = req.user.phone; // Decoded phone number from token

  if (!userPhone) {
    return res.status(400).json({ message: 'User phone number not found in token' });
  }

  try {
    // Joins contacts with users table to get the contact's profile info
const query = `
      SELECT 
        c.id AS contact_id,
        CASE 
          WHEN c.phone_low = $1 THEN c.phone_high
          ELSE c.phone_low
        END AS contact_phone,
        u.email AS contact_email,
        c.status,
        c.initiated_by,
        c.created_at
      FROM contacts c
      JOIN users u 
        ON u.phone = (
          CASE 
            WHEN c.phone_low = $1 THEN c.phone_high
            ELSE c.phone_low
          END
        )
      WHERE c.phone_low = $1 OR c.phone_high = $1;
    `;
    const { rows } = await db.query(query, [userPhone]);

    // If no contacts are found, send a clear message response
    if (rows.length === 0) {
      return res.status(200).json({
        hasContacts: false,
        message: 'No contacts found for this user',
        contacts: [],
      });
    }

    // If contacts exist, send the list
    return res.status(200).json({
      hasContacts: true,
      count: rows.length,
      contacts: rows,
    });
  } catch (err) {
    console.error('Error fetching contacts:', err);
    return res.status(500).json({ message: 'Server error fetching contacts' });
  }
});
// -------------------------------------------------------------------
// POST /api/contacts/add
// Adds a new contact request by sorting low and high numbers
// -------------------------------------------------------------------
// POST /api/contacts/add
router.post('/add', authenticateToken, async (req, res) => {
  const senderPhone = req.user.phone;
  const { recipientEmail } = req.body; // Changed from recipientPhone to recipientEmail

  // 1. Basic validation
  if (!recipientEmail) {
    return res.status(400).json({ message: 'Recipient email address is required' });
  }

  try {
    const targetEmail = recipientEmail.trim().toLowerCase();

    // 2. Fetch recipient user details using their email
    const userCheckQuery = `SELECT phone, email FROM users WHERE LOWER(email) = $1;`;
    const userCheckRes = await db.query(userCheckQuery, [targetEmail]);

    if (userCheckRes.rows.length === 0) {
      return res.status(404).json({ message: 'No user found with this email address' });
    }

    const recipient = userCheckRes.rows[0];

    // Check if the user is trying to add themselves
    if (senderPhone === recipient.phone) {
      return res.status(400).json({ message: 'Cannot add yourself as a contact' });
    }

    // 3. Sort phone numbers for phone_low and phone_high database order
    const phone_low = senderPhone < recipient.phone ? senderPhone : recipient.phone;
    const phone_high = senderPhone < recipient.phone ? recipient.phone : senderPhone;

    // 4. Insert relationship into contacts table
    const insertQuery = `
      INSERT INTO contacts (phone_low, phone_high, status, initiated_by)
      VALUES ($1, $2, 'pending', $3)
      RETURNING *;
    `;

    const { rows } = await db.query(insertQuery, [phone_low, phone_high, senderPhone]);
    const createdContact = rows[0];

    // 5. Send an email notification to the recipient (non-blocking)
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: recipient.email,
      subject: 'New Contact Request - Clive Chat',
      text: `Hello,\n\nA user (${senderPhone}) has added you on Clive Chat!\n\nLog in to accept or view your contacts.`,
    };

    transporter.sendMail(mailOptions, (mailErr, info) => {
      if (mailErr) {
        console.error('Failed to send contact request email:', mailErr);
      } else {
        console.log('Contact request email sent:', info.response);
      }
    });

    // 6. Return response to frontend
    return res.status(201).json({
      message: 'Contact request sent successfully',
      contact: {
        contact_id: String(createdContact.id),
        contact_phone: recipient.phone,
        contact_email: recipient.email,
        status: createdContact.status,
        initiated_by: createdContact.initiated_by,
        created_at: createdContact.created_at,
      },
    });

  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ message: 'Contact or request already exists' });
    }
    if (err.code === '23514') {
      return res.status(400).json({ message: 'Cannot add yourself as a contact' });
    }

    console.error('Error adding contact:', err);
    return res.status(500).json({ message: 'Server error creating contact' });
  }
});




router.delete('/delete/:contactId', authenticateToken, async (req, res) => {
  const userPhone = req.user.phone;
  const { contactId } = req.params;

  // 1. Guard against 'undefined', 'null', or invalid non-numeric IDs
  if (!contactId || contactId === 'undefined' || contactId === 'null' || isNaN(Number(contactId))) {
    return res.status(400).json({ message: 'Invalid or missing contact ID' });
  }

  const numericContactId = parseInt(contactId, 10);

  try {
    // 2. Retrieve contact details along with both users' emails before deletion
    const findQuery = `
      SELECT 
        c.id,
        c.phone_low,
        c.phone_high,
        u1.email AS low_email,
        u2.email AS high_email
      FROM contacts c
      JOIN users u1 ON c.phone_low = u1.phone
      JOIN users u2 ON c.phone_high = u2.phone
      WHERE c.id = $1 AND (c.phone_low = $2 OR c.phone_high = $2);
    `;

    const { rows } = await db.query(findQuery, [numericContactId, userPhone]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Contact not found or unauthorized' });
    }

    const contact = rows[0];

    // Identify target user to receive notification email
    const targetUserEmail = contact.phone_low === userPhone ? contact.high_email : contact.low_email;

    // 3. Delete record from database
    await db.query('DELETE FROM contacts WHERE id = $1;', [numericContactId]);

    // 4. Send email notification (non-blocking)
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: targetUserEmail,
      subject: 'Contact Removed - Clive Chat',
      text: `Hello,\n\nThe user with phone number (${userPhone}) has removed you from their contacts list.\n\nRegards,\nClive Team`,
    };

    transporter.sendMail(mailOptions, (mailErr, info) => {
      if (mailErr) {
        console.error('Failed to send deletion email notification:', mailErr);
      } else {
        console.log('Deletion notification email sent:', info.response);
      }
    });

    return res.status(200).json({
      message: 'Contact deleted successfully',
      contactId: numericContactId,
    });

  } catch (err) {
    console.error('Error deleting contact:', err);
    return res.status(500).json({ message: 'Server error deleting contact' });
  }
});
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const searchQuery = req.query.query || '';

    // If query is empty, return an empty array immediately
    if (!searchQuery.trim()) {
      return res.status(200).json({ users: [] });
    }

    // Format query for wildcards: '%vic%'
    const searchPattern = `%${searchQuery.trim().toLowerCase()}%`;

    // SQL Query to search by name or email
    const sql = `
      SELECT id, name, email, avatar_url, created_at
      FROM users
      WHERE (LOWER(name) LIKE LOWER($1) OR LOWER(email) LIKE LOWER($1));
    `;

    const { rows } = await db.query(sql, [searchPattern]);

    // Send back all matched user details
    return res.status(200).json({ users: rows });
  } catch (error) {
    console.error('Error during database search:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;