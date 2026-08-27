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
    
    // 1. Get currentUserId directly from req.user
    const currentUserId = req.user.id;
    // If query is empty, return an empty array immediately
    if (!searchQuery.trim()) {
      return res.status(200).json({ users: [] });
    }

    const searchPattern = `%${searchQuery.trim().toLowerCase()}%`;

    // SQL Query to search users matching pattern EXCEPT current user
    const sql = `
      SELECT id, name, email, avatar_url, created_at
      FROM users
      WHERE (LOWER(name) LIKE LOWER($1) OR LOWER(email) LIKE LOWER($1))
        AND id <> $2::uuid;
    `;

    const { rows } = await db.query(sql, [searchPattern, String(currentUserId)]);
    // Send back all matched user details
    return res.status(200).json({ users: rows });
  } catch (error) {
    console.error('Error during database search:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/offline_unseen', authenticateToken, async (req, res) => {

  try {
    // 1. Log req.user payload received from authenticateToken middleware

    const userId = req.user?.id || req.user?.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID missing in token payload'
      });
    }

    // 2. Query definition using safe UUID casting
    const offlineUnseenQuery = `
      SELECT 
        id,
        CASE 
          WHEN user_low = $1::text::uuid THEN user_low_rank 
          ELSE user_high_rank 
        END AS rank
      FROM contacts
      WHERE (user_low = $1::text::uuid AND user_low_time IS NOT NULL)
         OR (user_high = $1::text::uuid AND user_high_time IS NOT NULL)
      ORDER BY (
        CASE 
          WHEN user_low = $1::text::uuid THEN user_low_time 
          ELSE user_high_time 
        END
      ) DESC;
    `;


    // 3. Execute DB Query
    const { rows } = await db.query(offlineUnseenQuery, [String(userId)]);


    return res.status(200).json({
      success: true,
      data: rows
    });

  } catch (error) {

    return res.status(500).json({
      success: false,
      message: 'Server error',
      debug_error: error.message // Temporarily exposed for quick frontend debugging
    });
  }
});

module.exports = router;