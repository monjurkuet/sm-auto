const { Client } = require('pg');
require('dotenv').config();

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  try {
    // Get latest run for this page
    const runRes = await c.query(
      `SELECT id FROM scraper.scrape_runs 
       WHERE entity_external_id = $1 AND surface = 'page_posts' AND status = 'completed'
       ORDER BY completed_at DESC LIMIT 1`,
      ['100064688828733']
    );

    if (runRes.rows.length === 0) {
      console.log('No completed page_posts run found');
      process.exit(0);
    }

    const runId = runRes.rows[0].id;
    console.log('Run ID:', runId);

    // Check raw graphql artifacts
    const artRes = await c.query(
      `SELECT artifact_name, jsonb_array_length(payload) as len 
       FROM scraper.scrape_artifacts 
       WHERE scrape_run_id = $1 AND artifact_name = 'graphql'`,
      [runId]
    );
    console.log('GraphQL artifact count:', artRes.rows.length ? artRes.rows[0].len : 0);

    // Get a sample fragment
    if (artRes.rows.length > 0) {
      const sampleRes = await c.query(
        `SELECT payload[0] as first FROM scraper.scrape_artifacts 
         WHERE scrape_run_id = $1 AND artifact_name = 'graphql'`,
        [runId]
      );
      if (sampleRes.rows[0].first) {
        const frag = sampleRes.rows[0].first;
        console.log('First fragment friendlyName:', frag.request?.friendlyName);
        console.log('Fragment path:', frag.path?.join?.('.'));
      }
    }

    // Get summary artifact
    const sumRes = await c.query(
      `SELECT payload FROM scraper.scrape_artifacts 
       WHERE scrape_run_id = $1 AND artifact_name = 'graphql_summary'`,
      [runId]
    );
    if (sumRes.rows.length > 0) {
      console.log('GraphQL summary friendlyNames:', JSON.stringify(sumRes.rows[0].payload.friendlyNames, null, 2));
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await c.end();
  }
})();
