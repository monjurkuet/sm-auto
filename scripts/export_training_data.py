#!/usr/bin/env python3
"""Export Facebook group data as JSONL training data for LLM fine-tuning.

Reads from the PostgreSQL database, classifies posts using heuristics
(and optionally LLM), and writes JSONL files to the training-data repo.

Usage:
  python3 scripts/export_training_data.py [--date YYYY-MM-DD] [--with-llm]
"""

import json
import os
import sys
import subprocess
from datetime import datetime, date
from pathlib import Path

import psycopg

# ── Config ──
SM_AUTO_DIR = Path(__file__).resolve().parent.parent
TRAINING_DATA_REPO = Path(os.environ.get('TRAINING_DATA_REPO', '/root/codebase/training-data'))
HERMESAGENT_REPO = Path(os.environ.get('HERMESAGENT_REPO', '/root/codebase/hermesagent'))

def get_conn():
    return psycopg.connect(
        host=os.environ.get('PGHOST', '127.0.0.1'),
        port=int(os.environ.get('PGPORT', '5432')),
        dbname=os.environ.get('PGDATABASE', 'facebook_scraper'),
        user=os.environ.get('PGUSER', 'agent0'),
        password=os.environ.get('PGPASSWORD', ''),
        sslmode=os.environ.get('PGSSLMODE', 'disable'),
    )

def jval(val):
    """Make any DB value JSON-serializable."""
    if isinstance(val, bytes):
        return val.decode('utf-8', errors='replace')
    if val is None:
        return None
    if hasattr(val, 'isoformat'):
        return val.isoformat()
    return val

def detect_language(text: str) -> str:
    """Heuristic Bangla detection via Unicode range."""
    if not text:
        return 'unknown'
    bengali_chars = sum(1 for c in text if '\u0980' <= c <= '\u09FF')
    total = len(text.replace(' ', '')) or 1
    ratio = bengali_chars / total
    if ratio > 0.3:
        return 'bn'
    if ratio > 0.05:
        return 'mixed'
    return 'en'

def classify_conversation_type(text: str) -> str:
    """Heuristic conversation type classification."""
    if not text:
        return 'unknown'
    t = text.lower()
    # Spam/scam indicators
    if any(kw in t for kw in ['guaranteed profit', '100%', 'earn money', 'click here', 'dm me', 'whatsapp']):
        return 'spam'
    # Promotion
    if any(kw in t for kw in ['buy now', 'sell', 'price', 'bdt', 'tk', 'cash on delivery', 'contact']):
        return 'promotion'
    # Questions
    if any(kw in t for kw in ['?', 'কি', 'কেন', 'কিভাবে', 'কে', 'কোথায়']):
        return 'question'
    return 'discussion'

def export_posts(conn, export_date: str) -> int:
    """Export all posts as JSONL."""
    out_dir = TRAINING_DATA_REPO / 'facebook-groups' / 'raw' / export_date
    out_dir.mkdir(parents=True, exist_ok=True)

    with conn.cursor() as cur:
        if export_date == 'all':
            cur.execute("""
                SELECT p.post_id, p.text_content, p.author_name, p.author_id,
                       p.reaction_count, p.comment_count, p.share_count,
                       p.created_at, p.last_scraped_at,
                       p.group_id, g.name as group_name
                FROM scraper.facebook_group_posts p
                JOIN scraper.facebook_groups g ON g.group_id = p.group_id
                ORDER BY p.last_seen_at DESC
            """)
        else:
            cur.execute("""
                SELECT p.post_id, p.text_content, p.author_name, p.author_id,
                       p.reaction_count, p.comment_count, p.share_count,
                       p.created_at, p.last_scraped_at,
                       p.group_id, g.name as group_name
                FROM scraper.facebook_group_posts p
                JOIN scraper.facebook_groups g ON g.group_id = p.group_id
                WHERE p.last_seen_at::date = %s::date
                ORDER BY p.last_seen_at DESC
            """, (export_date,))

        rows = cur.fetchall()

    out_file = out_dir / 'posts.jsonl'
    count = 0
    with open(out_file, 'w', encoding='utf-8') as f:
        for row in rows:
            (post_id, text, author_name, author_id,
             reactions, comments, shares,
             created_at, scraped_at, group_id, group_name) = row

            # Handle bytes/datetime from psycopg
            post_id = jval(post_id)
            group_id = jval(group_id)
            group_name = jval(group_name) or ''
            text = jval(text) or ''
            author_name = jval(author_name) or ''
            author_id = jval(author_id)
            created_at = jval(created_at)
            scraped_at = jval(scraped_at)

            language = detect_language(text)
            conversation_type = classify_conversation_type(text)

            record = {
                'id': f'post_{post_id}',
                'text': text,
                'language': language,
                'author': {'name': author_name, 'id': author_id},
                'group': {'id': group_id, 'name': group_name},
                'metrics': {'reactions': reactions, 'comments': comments, 'shares': shares},
                'created_at': created_at,
                'scraped_at': scraped_at,
                'classification': {
                    'conversation_type': conversation_type,
                    'author_type': 'real',  # heuristic default
                    'is_organic': conversation_type not in ('spam', 'scam'),
                },
            }
            f.write(json.dumps(record, ensure_ascii=False) + '\n')
            count += 1

    return count

def export_comments(conn, export_date: str) -> int:
    """Export all comments as JSONL."""
    out_dir = TRAINING_DATA_REPO / 'facebook-groups' / 'raw' / export_date
    out_dir.mkdir(parents=True, exist_ok=True)

    with conn.cursor() as cur:
        cur.execute("""
            SELECT c.comment_id, c.text_content, c.author_name, c.author_id,
                   c.parent_comment_id, c.created_at, c.post_id,
                   p.group_id
            FROM scraper.facebook_group_post_comments c
            JOIN scraper.facebook_group_posts p ON p.post_id = c.post_id
            ORDER BY c.created_at DESC
        """)

        rows = cur.fetchall()

    out_file = out_dir / 'comments.jsonl'
    count = 0
    with open(out_file, 'w', encoding='utf-8') as f:
        for row in rows:
            (comment_id, text, author_name, author_id,
             parent_comment_id, created_at, post_id, group_id) = row

            comment_id = jval(comment_id)
            text = jval(text) or ''
            author_name = jval(author_name) or ''
            author_id = jval(author_id)
            parent_comment_id = jval(parent_comment_id)
            post_id = jval(post_id)
            group_id = jval(group_id)
            created_at = jval(created_at)

            language = detect_language(text)

            record = {
                'id': comment_id,
                'text': text,
                'language': language,
                'author': {'name': author_name, 'id': author_id},
                'parent_id': parent_comment_id,
                'post_id': post_id,
                'group_id': group_id,
                'created_at': created_at,
            }
            f.write(json.dumps(record, ensure_ascii=False) + '\n')
            count += 1

    return count

def export_curated_bangla(export_date: str) -> int:
    """Filter raw posts for Bangla content and create curated training examples."""
    raw_file = TRAINING_DATA_REPO / 'facebook-groups' / 'raw' / export_date / 'posts.jsonl'
    if not raw_file.exists():
        return 0

    out_dir = TRAINING_DATA_REPO / 'facebook-groups' / 'curated' / export_date
    out_dir.mkdir(parents=True, exist_ok=True)

    bangla_discussions = []
    bangla_qa = []
    organic = []
    spam_samples = []

    with open(raw_file, 'r', encoding='utf-8') as f:
        for line in f:
            post = json.loads(line)
            lang = post.get('language', 'unknown')
            conv_type = post.get('classification', {}).get('conversation_type', 'discussion')
            is_organic = post.get('classification', {}).get('is_organic', True)
            text = post.get('text', '')

            if not text or len(text.strip()) < 20:
                continue

            if lang in ('bn', 'mixed'):
                bangla_discussions.append(post)
                if conv_type == 'question':
                    bangla_qa.append(post)

            if is_organic and conv_type not in ('spam', 'scam'):
                organic.append(post)

            if conv_type in ('spam', 'scam'):
                spam_samples.append(post)

    # Write curated files
    def write_jsonl(posts: list, path: Path) -> int:
        with open(path, 'w', encoding='utf-8') as f:
            for p in posts:
                example = {
                    'messages': [{'role': 'user', 'content': p['text']}],
                    'metadata': {
                        'source': 'facebook_group',
                        'group_id': p.get('group', {}).get('id'),
                        'language': p.get('language'),
                        'conversation_type': p.get('classification', {}).get('conversation_type'),
                        'is_organic': p.get('classification', {}).get('is_organic', True),
                        'collected_at': export_date,
                    },
                }
                f.write(json.dumps(example, ensure_ascii=False) + '\n')
        return len(posts)

    counts = {}
    counts['bangla_discussions'] = write_jsonl(bangla_discussions, out_dir / 'bangla-discussions.jsonl')
    counts['bangla_qa'] = write_jsonl(bangla_qa, out_dir / 'bangla-qa.jsonl')
    counts['organic'] = write_jsonl(organic, out_dir / 'organic-interactions.jsonl')
    counts['spam'] = write_jsonl(spam_samples, out_dir / 'spam-scam-samples.jsonl')

    return sum(counts.values())

def git_push(repo_path: Path, message: str) -> bool:
    """Stage, commit, and push to git."""
    try:
        subprocess.run(['git', 'add', '-A'], cwd=repo_path, check=True, capture_output=True)
        result = subprocess.run(
            ['git', 'diff', '--cached', '--quiet'],
            cwd=repo_path, capture_output=True,
        )
        if result.returncode == 0:
            return True  # nothing to commit
        subprocess.run(['git', 'commit', '-m', message], cwd=repo_path, check=True, capture_output=True)
        subprocess.run(['git', 'push'], cwd=repo_path, check=True, capture_output=True, timeout=30)
        return True
    except Exception as e:
        print(f'[EXPORT] git push failed for {repo_path}: {e}')
        return False

def main():
    export_date = sys.argv[1] if len(sys.argv) > 1 else datetime.now().strftime('%Y-%m-%d')
    all_mode = '--all' in sys.argv
    if all_mode:
        export_date = 'all'
    print(f'[EXPORT] Exporting training data for {export_date}')

    conn = get_conn()
    try:
        post_count = export_posts(conn, export_date)
        print(f'[EXPORT] Exported {post_count} posts')

        comment_count = export_comments(conn, export_date)
        print(f'[EXPORT] Exported {comment_count} comments')

        curated_count = export_curated_bangla(export_date)
        print(f'[EXPORT] Exported {curated_count} curated examples')

        # Push to git
        if git_push(TRAINING_DATA_REPO, f'Auto-export training data for {export_date}'):
            print(f'[EXPORT] Pushed to training-data repo')
        else:
            print(f'[EXPORT] No changes or push failed for training-data repo')
    finally:
        conn.close()

if __name__ == '__main__':
    main()
