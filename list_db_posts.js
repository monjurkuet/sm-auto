const { Client } = require('pg');
require('dotenv').config();
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    const res = await c.query(
      `SELECT external_post_id, story_id, permalink FROM scraper.facebook_posts WHERE page_id = $1 ORDER BY last_scraped_at DESC`,
      ['100064688828733']
    );
    console.log('Existing posts for this page in DB:');
    res.rows.forEach((r, i) => {
      console.log(
        `  ${i}: external_post_id=${r.external_post_id} story_id=${r.story_id} permalink=${r.permalink ? 'yes' : 'no'}`
      );
    });
    console.log(`Total: ${res.rows.length}`);
  } finally {
    await c.end();
  }
})();
