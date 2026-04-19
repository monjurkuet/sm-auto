const fs = require('fs');
try {
  const data = fs.readFileSync('output/page_posts.json', 'utf8');
  const obj = JSON.parse(data);
  console.log('post count:', obj.posts.length);
  obj.posts.slice(0, 10).forEach((p, i) => {
    console.log(`post ${i}: id=${p.id} postId=${p.postId} textLen=${(p.text || '').length}`);
  });
} catch (e) {
  console.error('Error:', e.message);
  const raw = fs.readFileSync('output/page_posts.json', 'utf8');
  const match = raw.match(/"id"\s*:\s*"/g);
  if (match) {
    console.log('Approx post count by counting id fields:', match.length);
  }
}
