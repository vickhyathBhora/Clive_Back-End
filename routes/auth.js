const express = require('express');
const router = express.Router();
const db = require('../config/db');
const jwt = require('jsonwebtoken');

/**
 * Direct Google Login (No OTP required)
 * POST /api/google-auth
 */
router.post('/google-auth', async (req, res) => {
  const { email, name, avatarUrl } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required from Google account.' });
  }

  try {
    // 1. Check if user already exists
    let userResult = await db.query(
      'SELECT id, email, name, avatar_url, created_at FROM users WHERE email = $1',
      [email]
    );

    let user;

    if (userResult.rows.length > 0) {
    const updatedUser = await db.query(
      `UPDATE users 
       SET name = COALESCE(name, $1), 
           avatar_url = COALESCE(avatar_url, $2)
       WHERE email = $3 
       RETURNING id, email, name, avatar_url, created_at;`,
      [name, avatarUrl, email]
    );
    user = updatedUser.rows[0];
    console.log(`👤 Updated shadow user profile for: ${email}`);
    } else {
      // New User: Create entry with auto-generated UUID
      const defaultName = name ||null;
      const newUser = await db.query(
        `INSERT INTO users (email, name, avatar_url) 
         VALUES ($1, $2, $3) 
         RETURNING id, email, name, avatar_url, created_at`,
        [email, defaultName, avatarUrl]
      );
      user = newUser.rows[0];
    }

    // 2. Generate Auth Token with ONLY user ID
    const jwtSecret = process.env.JWT_SECRET || 'your_fallback_jwt_secret';
    const token = jwt.sign({ id: user.id }, jwtSecret, { expiresIn: '7d' });

    // 3. Return response for Dashboard Context
    return res.status(200).json({
      message: 'Authentication successful!',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatar_url,
        createdAt: user.created_at
      }
    });

  } catch (error) {
    console.error('Google Auth Error:', error);
    return res.status(500).json({ message: 'Internal server error during authentication.' });
  }
});
module.exports = router;