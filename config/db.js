const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  // Use connection string directly if provided (Render/Cloud standard)
  connectionString: process.env.DATABASE_URL,
  
  // Fallback to individual variables if DATABASE_URL isn't set
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'clive_db',
  
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis:30000,

  // Enable SSL automatically for cloud hosts (like Render/Neon/Heroku)
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Auto-create 'users', 'contacts', and 'messages' tables on startup
const createTablesQuery = `
  -- Enable pgcrypto for UUID generator if using older PostgreSQL version
  CREATE EXTENSION IF NOT EXISTS "pgcrypto";

  -- 1. Create Users Table
  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );

  -- 2. Create Contacts Table referencing user IDs with integer rank columns
  CREATE TABLE IF NOT EXISTS contacts (
    id BIGSERIAL PRIMARY KEY,
    user_low UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_high UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending',
    initiated_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Integer ranks maintained per user in the pair (1 = Top position)
    user_low_rank INT DEFAULT 0,
    user_high_rank INT DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
user_low_unseen INT DEFAULT 0,
    user_high_unseen INT DEFAULT 0,

    -- Ensures pair is unique and user_low is strictly smaller than user_high
    CONSTRAINT unique_user_pair UNIQUE (user_low, user_high),
    CONSTRAINT check_not_self CHECK (user_low <> user_high),
    CONSTRAINT check_user_order CHECK (user_low < user_high)
  );

  -- 3. Create B-Tree Indexes for sub-millisecond rank-based searches & pagination
  CREATE INDEX IF NOT EXISTS idx_contacts_low ON contacts(user_low);
  CREATE INDEX IF NOT EXISTS idx_contacts_high ON contacts(user_high);
  CREATE INDEX IF NOT EXISTS idx_contacts_low_rank ON contacts(user_low, user_low_rank ASC);
  CREATE INDEX IF NOT EXISTS idx_contacts_high_rank ON contacts(user_high, user_high_rank ASC);

-- 1. Create Messages Table
CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Index to optimize querying and deleting per contact_id
CREATE INDEX IF NOT EXISTS idx_messages_contact_created 
ON messages(contact_id, created_at DESC);

-- 3. Trigger Function: Deletes messages past the 10th newest per contact_id
CREATE OR REPLACE FUNCTION cap_contact_messages()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM messages
  WHERE contact_id = NEW.contact_id
    AND id NOT IN (
      SELECT id FROM messages
      WHERE contact_id = NEW.contact_id
      ORDER BY created_at DESC, id DESC
      LIMIT 10
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Attach Trigger
CREATE OR REPLACE TRIGGER enforce_10_message_limit
AFTER INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION cap_contact_messages();`;

const initDb = async () => {
  try {
    await pool.query(createTablesQuery);
    console.log('Database tables & B-Tree indexes verified / initialized successfully.');
  } catch (err) {
    console.error('Failed to initialize database tables:', err);
  }
};

pool.on('connect', () => {
  console.log('Connected to PostgreSQL Database');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
  process.exit(-1);
});

// Execute table creation on startup
initDb();

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};