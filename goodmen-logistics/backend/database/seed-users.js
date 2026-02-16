const { pool } = require('../config/database');
const bcrypt = require('bcrypt');

async function seedUsers() {
  const users = [
    { username: 'admin', password: 'admin123', role: 'admin' },
    { username: 'safety', password: 'safety123', role: 'safety' },
    { username: 'fleet', password: 'fleet123', role: 'fleet' },
    { username: 'dispatch', password: 'dispatch123', role: 'dispatch' }
  ];

  for (const user of users) {
    const hash = await bcrypt.hash(user.password, 10);
    await pool.query(
      `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)
       ON CONFLICT (username) DO NOTHING`,
      [user.username, hash, user.role]
    );
  }
  console.log('Seeded users table.');
}

if (require.main === module) {
  seedUsers().then(() => process.exit(0));
}

module.exports = { seedUsers };
