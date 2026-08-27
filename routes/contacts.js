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
  console.log('--- 🚀 [GET /offline_unseen] Route Triggered ---');
  
  try {
    // 1. Log req.user payload received from authenticateToken middleware
    console.log('📌 [DEBUG] req.user:', req.user);

    const userId = req.user?.id || req.user?.userId;
    console.log('📌 [DEBUG] Extracted userId:', userId);

    if (!userId) {
      console.warn('⚠️ [WARN] User ID missing in token payload');
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

    console.log('📌 [DEBUG] Executing Database Query with param:', String(userId));

    // 3. Execute DB Query
    const { rows } = await db.query(offlineUnseenQuery, [String(userId)]);

    console.log('✅ [SUCCESS] Query executed successfully. Total rows returned:', rows.length);
    console.log('📌 [DEBUG] Rows output:', JSON.stringify(rows, null, 2));

    return res.status(200).json({
      success: true,
      data: rows
    });

  } catch (error) {
    // 4. Log detailed error metrics in Render logs
    console.error('❌ [CRITICAL ERROR] /offline_unseen execution failed:');
    console.error('   ├── Error Name:', error.name);
    console.error('   ├── Error Message:', error.message);
    console.error('   ├── PostgreSQL Error Code:', error.code || 'N/A');
    console.error('   └── Stack Trace:\n', error.stack);

    return res.status(500).json({ 
      success: false, 
      message: 'Server error',
      debug_error: error.message // Temporarily exposed for quick frontend debugging
    });
  }
});

module.exports = router;