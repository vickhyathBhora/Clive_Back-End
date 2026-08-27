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

router.get('/offline_unseen', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        message: 'User ID missing in token payload' 
      });
    }

    const offlineUnseenQuery = `
   SELECT 
  id,
  CASE 
    WHEN user_low = $1::uuid THEN user_low_rank 
    ELSE user_high_rank 
  END AS rank
FROM contacts
WHERE (user_low = $1::uuid AND user_low_time IS NOT NULL)
   OR (user_high = $1::uuid AND user_high_time IS NOT NULL)
ORDER BY (
  CASE 
    WHEN user_low = $1::uuid THEN user_low_time 
    ELSE user_high_time 
  END
) DESC;
    `;

    const { rows } = await db.query(offlineUnseenQuery, [userId]);
console.log(rows);
    return res.status(200).json({
      success: true,
      data: rows
    });

  } catch (error) {
    console.error('❌ Error in /offline_unseen route:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

module.exports = router;