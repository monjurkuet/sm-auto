const { Client } = require('pg');
require('dotenv').config();
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    const res = await c.query(`
      SELECT fp.page_id, fp.name, COUNT(fpo.id) as post_count
      FROM scraper.facebook_pages fp
      LEFT JOIN scraper.facebook_posts fpo ON fpo.page_id = fp.page_id
      GROUP BY fp.page_id, fp.name
      ORDER BY post_count ASC
    `);
    console.log('Pages with post counts (ascending):');
    res.rows.forEach((r) => {
      console.log(`  ${r.post_count} posts  ${r.page_id}  ${r.name}`);
    });
    const zero = res.rows.filter((r) => r.post_count === 0);
    if (zero.length) {
      console.log('\nPages with ZERO posts:');
      zero.forEach((r) => console.log(`  ${r.page_id}  ${r.name}`));
    } else {
      console.log('\nAll pages have at least one post.');
    }
  } finally {
    await c.end();
  }
})();
