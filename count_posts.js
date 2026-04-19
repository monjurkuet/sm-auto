const { Client } = require('pg');
require('dotenv').config();
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    const res = await c.query('SELECT COUNT(*) as cnt FROM scraper.facebook_posts WHERE page_id = $1', [
      '100064688828733'
    ]);
    console.log('Posts in DB for ryanscomputers:', res.rows[0].cnt);
  } catch (e) {
    console.error(e.message);
  } finally {
    await c.end();
  }
})();
