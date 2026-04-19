const fs = require('fs');
const { Client } = require('pg');
require('dotenv').config();

async function compare() {
  // Read extracted post IDs
  const data = fs.readFileSync('output/page_posts.json', 'utf8');
  const obj = JSON.parse(data);
  const extractedIds = new Set(obj.posts.map((p) => p.postId).filter(Boolean));
  console.log(`Extracted ${extractedIds.size} distinct postIds`);

  // Read DB post external_post_id
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    const res = await c.query(`SELECT external_post_id FROM scraper.facebook_posts WHERE page_id = $1`, [
      '100064688828733'
    ]);
    const dbIds = new Set(res.rows.map((r) => r.external_post_id).filter(Boolean));
    console.log(`DB has ${dbIds.size} external_post_id values`);

    const missing = [...extractedIds].filter((id) => !dbIds.has(id));
    console.log(`\nMissing in DB (${missing.length}):`);
    missing.forEach((id) => console.log(`  ${id}`));

    // Also check if any DB IDs not in extracted (should be older ones)
    const extraInDb = [...dbIds].filter((id) => !extractedIds.has(id));
    console.log(`\nIn DB but not in this extraction (${extraInDb.length}):`);
    extraInDb.forEach((id) => console.log(`  ${id}`));
  } finally {
    await c.end();
  }
}

compare().catch(console.error);
