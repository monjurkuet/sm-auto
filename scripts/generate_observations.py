#!/usr/bin/env python3
"""Generate observation notes for monitored Facebook groups.

Analyzes DB data to produce structured markdown observation files
in the hermesagent repo for cross-session knowledge persistence.
"""

import json
import os
import sys
import subprocess
from datetime import datetime
from pathlib import Path
from collections import Counter

import psycopg

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

def safe_str(val):
    if isinstance(val, bytes):
        return val.decode('utf-8', errors='replace')
    return str(val) if val is not None else 'unknown'

def generate_group_observation(conn, group_id: str, group_name: str, export_date: str) -> str:
    """Generate a markdown observation for a single group."""
    with conn.cursor() as cur:
        # Post stats
        cur.execute("""
            SELECT
                COUNT(*) as total,
                COUNT(CASE WHEN last_seen_at > now() - interval '7 days' THEN 1 END) as posts_7d,
                COUNT(CASE WHEN last_seen_at > now() - interval '24 hours' THEN 1 END) as posts_24h,
                AVG(reaction_count) FILTER (WHERE reaction_count IS NOT NULL) as avg_reactions,
                AVG(comment_count) FILTER (WHERE comment_count IS NOT NULL) as avg_comments,
                AVG(share_count) FILTER (WHERE share_count IS NOT NULL) as avg_shares,
                COUNT(DISTINCT author_name) as distinct_authors,
                COUNT(CASE WHEN comment_count >= 5 THEN 1 END) as posts_5plus_comments
            FROM scraper.facebook_group_posts
            WHERE group_id = %s
        """, (group_id,))
        stats = cur.fetchone()

        # Top authors
        cur.execute("""
            SELECT author_name, COUNT(*) as cnt
            FROM scraper.facebook_group_posts
            WHERE group_id = %s AND author_name IS NOT NULL
            GROUP BY author_name
            ORDER BY cnt DESC
            LIMIT 5
        """, (group_id,))
        top_authors = cur.fetchall()

        # Recent post samples
        cur.execute("""
            SELECT post_id, LEFT(text_content, 100) as preview, reaction_count, comment_count, author_name
            FROM scraper.facebook_group_posts
            WHERE group_id = %s
            ORDER BY reaction_count DESC NULLS LAST
            LIMIT 5
        """, (group_id,))
        top_posts = cur.fetchall()

        # Registry info
        cur.execute("""
            SELECT member_count, privacy_type, vitality_score, membership_status
            FROM scraper.facebook_groups g
            LEFT JOIN scraper.facebook_group_registry r ON r.group_id = g.group_id
            WHERE g.group_id = %s
        """, (group_id,))
        reg = cur.fetchone()

    total, posts_7d, posts_24h, avg_r, avg_c, avg_s, distinct_authors, posts_5plus = stats
    member_count, privacy, vitality, membership = reg if reg else (None, None, None, None)

    posting_freq = round(posts_7d / 7.0, 2) if posts_7d else 0
    engagement = round((avg_r or 0) + (avg_c or 0) + (avg_s or 0), 1)
    organic_ratio = round(posts_5plus / total, 2) if total and total > 0 else 0

    lines = [
        f'# {safe_str(group_name)}',
        f'',
        f'**Group ID:** {safe_str(group_id)}',
        f'**Date:** {export_date}',
        f'**Members:** {safe_str(member_count)}',
        f'**Privacy:** {safe_str(privacy)}',
        f'**Membership Status:** {safe_str(membership)}',
        f'**Vitality Score:** {safe_str(vitality)}/100',
        f'',
        f'## Activity',
        f'',
        f'| Metric | Value |',
        f'|--------|-------|',
        f'| Total posts known | {total} |',
        f'| Posts (7 days) | {posts_7d} |',
        f'| Posts (24 hours) | {posts_24h} |',
        f'| Posting frequency | {posting_freq} posts/day |',
        f'| Distinct authors | {distinct_authors} |',
        f'| Avg reactions/post | {round(avg_r or 0, 1)} |',
        f'| Avg comments/post | {round(avg_c or 0, 1)} |',
        f'| Avg shares/post | {round(avg_s or 0, 1)} |',
        f'',
        f'## Top Authors',
        f'',
    ]
    for name, cnt in top_authors:
        lines.append(f'- {safe_str(name)}: {cnt} posts')
    lines.append('')
    lines.append('## Top Posts by Engagement')
    lines.append('')
    for pid, preview, reactions, comments, author in top_posts:
        lines.append(f'- [{safe_str(pid)}] "{safe_str(preview)}..." — {reactions}r/{comments}c by {safe_str(author)}')
    lines.append('')
    lines.append('## Dynamics')
    lines.append('')
    lines.append(f'- **Organic conversation ratio:** {organic_ratio} (posts with 5+ comments / total)')
    lines.append(f'- **Avg engagement per post:** {engagement} (reactions + comments + shares)')
    lines.append(f'- **Repeat posters:** {", ".join(f"{safe_str(n)} ({c})" for n, c in top_authors[:3])}')
    lines.append('')

    return '\n'.join(lines)

def generate_cycle_summary(conn, export_date: str) -> str:
    """Generate a cycle-level summary."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
                COUNT(DISTINCT group_id) as groups_with_posts,
                COUNT(*) as total_posts,
                COUNT(reaction_count) as with_reactions,
                COUNT(comment_count) as with_comments,
                COUNT(text_content) as with_text,
                COUNT(DISTINCT author_name) as total_authors
            FROM scraper.facebook_group_posts
        """)
        stats = cur.fetchone()

        cur.execute("SELECT COUNT(*) FROM scraper.facebook_group_post_comments")
        comment_count = cur.fetchone()[0]

        cur.execute("SELECT COUNT(*) FROM scraper.facebook_group_registry WHERE is_active = true")
        active_groups = cur.fetchone()[0]

    groups_with_posts, total_posts, with_reactions, with_comments, with_text, total_authors = stats

    lines = [
        f'# Monitoring Cycle Summary — {export_date}',
        f'',
        f'## Overview',
        f'',
        f'| Metric | Value |',
        f'|--------|-------|',
        f'| Active monitored groups | {active_groups} |',
        f'| Groups with posts | {groups_with_posts} |',
        f'| Total posts | {total_posts} |',
        f'| Posts with reactions | {with_reactions} |',
        f'| Posts with comments | {with_comments} |',
        f'| Posts with text | {with_text} |',
        f'| Total comments | {comment_count} |',
        f'| Distinct authors | {total_authors} |',
        f'',
        f'## Per-Group Breakdown',
        f'',
    ]

    with conn.cursor() as cur:
        cur.execute("""
            SELECT g.group_id, g.name, g.vitality_score,
                   COUNT(p.post_id) as posts,
                   AVG(p.reaction_count) FILTER (WHERE p.reaction_count IS NOT NULL) as avg_r
            FROM scraper.facebook_groups g
            LEFT JOIN scraper.facebook_group_posts p ON p.group_id = g.group_id
            JOIN scraper.facebook_group_registry r ON r.group_id = g.group_id
            WHERE r.is_active = true
            GROUP BY g.group_id, g.name, g.vitality_score
            ORDER BY g.vitality_score DESC NULLS LAST
        """)
        for gid, gname, vscore, pcount, avgr in cur.fetchall():
            gname = safe_str(gname)
            lines.append(f'- **{gname}** (vitality {safe_str(vscore)}): {pcount} posts, avg {round(avgr or 0, 1)} reactions')

    lines.append('')
    return '\n'.join(lines)

def git_push(repo_path: Path, message: str) -> bool:
    try:
        subprocess.run(['git', 'add', '-A'], cwd=repo_path, check=True, capture_output=True)
        result = subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=repo_path, capture_output=True)
        if result.returncode == 0:
            return True
        subprocess.run(['git', 'commit', '-m', message], cwd=repo_path, check=True, capture_output=True)
        subprocess.run(['git', 'push'], cwd=repo_path, check=True, capture_output=True, timeout=30)
        return True
    except Exception as e:
        print(f'[OBSERVE] git push failed: {e}')
        return False

def main():
    export_date = datetime.now().strftime('%Y-%m-%d')
    print(f'[OBSERVE] Generating observations for {export_date}')

    obs_dir = HERMESAGENT_REPO / 'knowledge' / 'facebook-groups' / 'observations' / export_date
    obs_dir.mkdir(parents=True, exist_ok=True)

    conn = get_conn()
    try:
        # Get all active groups
        with conn.cursor() as cur:
            cur.execute("""
                SELECT g.group_id, g.name
                FROM scraper.facebook_groups g
                JOIN scraper.facebook_group_registry r ON r.group_id = g.group_id
                WHERE r.is_active = true
                ORDER BY g.vitality_score DESC NULLS LAST
            """)
            groups = cur.fetchall()

        for group_id, group_name in groups:
            gid = safe_str(group_id)
            gname = safe_str(group_name)
            md = generate_group_observation(conn, gid, gname, export_date)
            out_file = obs_dir / f'group_{gid}.md'
            with open(out_file, 'w', encoding='utf-8') as f:
                f.write(md)
            print(f'[OBSERVE] Wrote observation for {gname}')

        # Cycle summary
        summary = generate_cycle_summary(conn, export_date)
        with open(obs_dir / 'cycle_summary.md', 'w', encoding='utf-8') as f:
            f.write(summary)
        print(f'[OBSERVE] Wrote cycle summary')

        # Push
        if git_push(HERMESAGENT_REPO, f'Facebook group observations for {export_date}'):
            print(f'[OBSERVE] Pushed to hermesagent repo')
    finally:
        conn.close()

if __name__ == '__main__':
    main()
