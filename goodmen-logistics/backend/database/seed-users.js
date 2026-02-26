const knex = require('knex');
const path = require('path');
const bcrypt = require('bcrypt');

// Load knexfile
const knexConfig = require(path.join(__dirname, '../knexfile.js'));
const db = knex(knexConfig.development);

async function seedUsers() {
  try {
    console.log('Seeding users...\n');

    const users = [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'safety', password: 'safety123', role: 'safety' },
      { username: 'fleet', password: 'fleet123', role: 'fleet' },
      { username: 'dispatch', password: 'dispatch123', role: 'dispatch' },
      { username: 'service_advisor', password: 'service123', role: 'service_advisor' },
      { username: 'technician', password: 'tech123', role: 'technician' },
      { username: 'accounting', password: 'acct123', role: 'accounting' }
    ];

    for (const user of users) {
      const hash = await bcrypt.hash(user.password, 10);
      try {
        await db('users').insert({
          username: user.username,
          password_hash: hash,
          role: user.role
        });
        console.log(`✓ Created user: ${user.username} (${user.role})`);
      } catch (err) {
        if (err.message.includes('duplicate')) {
          console.log(`⚠ User already exists: ${user.username}`);
        } else {
          console.log(`✗ Error creating user ${user.username}: ${err.message}`);
        }
      }
    }

    console.log('\n✅ User seeding completed!');
    console.log('\nLogin credentials:');
    users.forEach(u => {
      console.log(`  ${u.username}: ${u.password}`);
    });

  } catch (error) {
    console.error('Fatal error during seeding:', error);
  } finally {
    await db.destroy();
    process.exit(0);
  }
}

if (require.main === module) {
  seedUsers();
}

module.exports = { seedUsers };
