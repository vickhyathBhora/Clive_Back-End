const express = require('express');
const router = express.Router();
const db = require('../config/db');
const jwt = require('jsonwebtoken');

/**
 * Google Auth Endpoint
 * POST /api/auth/google-auth
 * Receives: { token: "ya29..." }
 */
router.post('/google-auth', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ message: 'Google access token is required.' });
  }

  try {
    // 1. Verify token & fetch user profile directly from Google
    const googleRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!googleRes.ok) {
      return res.status(401).json({ message: 'Invalid or expired Google token.' });
    }

    const googleUser = await googleRes.json();
    const { email, name, picture } = googleUser;

    if (!email) {
      return res.status(400).json({ message: 'Could not retrieve email from Google.' });
    }

    const avatarUrl = picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(name || email)}&background=random&color=fff`;

    // 2. Check if user already exists
    let user;
    const existingUser = await db.query(
      'SELECT id, email, name, avatar_url, created_at FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      user = existingUser.rows[0];
    } else {
      // Create new user in PostgreSQL
      const newUser = await db.query(
        `INSERT INTO users (email, name, avatar_url) 
         VALUES ($1, $2, $3) 
         RETURNING id, email, name, avatar_url, created_at`,
        [email, name || email.split('@')[0], avatarUrl]
      );
      user = newUser.rows[0];
    }

    // 3. Generate App Auth Token
    const jwtSecret = process.env.JWT_SECRET || 'your_fallback_jwt_secret';
    const appToken = jwt.sign({ id: user.id }, jwtSecret, { expiresIn: '7d' });

    // 4. Return successful login data
    return res.status(200).json({
      message: 'Authentication successful!',
      token: appToken,
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