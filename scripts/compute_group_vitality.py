#!/usr/bin/env python3
"""compute_group_vitality.py — Score monitored groups for relevance and vitality.

Scoring formula (0-100):
  30 pts: posting frequency (avg posts/day over last 7d, capped at 10/day → 30pts)
  25 pts: engagement rate ((avg reactions+comments+shares) / member_count * 1000, capped)
  20 pts: comment density (avg comments per post, capped at 20 → 20pts)
  15 pts: member count (log scale: 100→0, 1M→15)
  10 pts: organic conversation (ratio of posts with 5+ comments → 10pts max)

Also updates: posting_frequency_7d, avg_reactions_per_post, avg_comments_per_post,
engagement_rate on scraper.facebook_groups, and relevance_score on the registry.
"""

import os
import sys
import math
import psycopg

def get_conn():
    """Build connection from env vars (loaded from .env by the shell script)."""
    return psycopg.connect(
        host=os.environ.get("PGHOST", "127.0.0.1"),
        port=int(os.environ.get("PGPORT", "5432")),
        dbname=os.environ.get("PGDATABASE", "facebook_scraper"),
        user=os.environ.get("PGUSER", "agent0"),
        password=os.environ.get("PGPASSWORD", ""),
        sslmode=os.environ.get("PGSSLMODE", "disable"),
    )


def score_posting_frequency(avg_posts_per_day: float) -> int:
    """0 posts/day=0, 10+=30, linear."""
    if avg_posts_per_day <= 0:
        return 0
    return min(30, int(avg_posts_per_day * 3))


def score_engagement_rate(rate: float) -> int:
    """engagement_rate = (avg interactions / members) * 1000. Capped at 25."""
    if rate <= 0:
        return 0
    return min(25, int(rate * 2.5))


def score_comment_density(avg_comments: float) -> int:
    """0 comments/post=0, 20+=20, linear."""
    if avg_comments <= 0:
        return 0
    return min(20, int(avg_comments))


def score_member_count(members: int | None) -> int:
    """Log scale: 100→0, 1M→15."""
    if not members or members <= 0:
        return 0
    log_val = math.log10(max(members, 1))
    # log10(100)=2 → 0, log10(1_000_000)=6 → 15
    return min(15, max(0, int((log_val - 2) * 3.75)))


def score_organic_conversation(ratio: float) -> int:
    """Ratio of posts with 5+ comments. 0→0, 1.0→10."""
    if ratio <= 0:
        return 0
    return min(10, int(ratio * 10))


def main():
    conn = get_conn()
    with conn:
        with conn.cursor() as cur:
            # Get all active monitored groups with their posts
            cur.execute("""
                SELECT
                    g.group_id,
                    g.member_count,
                    COUNT(p.post_id) AS total_posts,
                    COUNT(p.post_id) FILTER (WHERE p.last_seen_at > now() - interval '7 days') AS posts_7d,
                    AVG(p.reaction_count) FILTER (WHERE p.reaction_count IS NOT NULL) AS avg_reactions,
                    AVG(p.comment_count) FILTER (WHERE p.comment_count IS NOT NULL) AS avg_comments,
                    AVG(p.share_count) FILTER (WHERE p.share_count IS NOT NULL) AS avg_shares,
                    COUNT(p.post_id) FILTER (
                        WHERE p.comment_count IS NOT NULL AND p.comment_count >= 5
                        AND p.last_seen_at > now() - interval '7 days'
                    ) AS posts_5plus_comments_7d,
                    COUNT(p.post_id) FILTER (
                        WHERE p.last_seen_at > now() - interval '7 days'
                    ) AS denom_posts_7d
                FROM scraper.facebook_groups g
                JOIN scraper.facebook_group_registry r ON r.group_id = g.group_id
                LEFT JOIN scraper.facebook_group_posts p ON p.group_id = g.group_id
                WHERE r.is_active = true
                GROUP BY g.group_id, g.member_count
            """)

            rows = cur.fetchall()
            if not rows:
                print("[VITALITY] No monitored groups found.")
                return

            print(f"[VITALITY] Scoring {len(rows)} groups...")

            for row in rows:
                (group_id, member_count, total_posts, posts_7d,
                 avg_reactions, avg_comments, avg_shares,
                 posts_5plus, denom_posts_7d) = row

                # Ensure group_id is a string (psycopg may return bytes)
                group_id = group_id.decode() if isinstance(group_id, bytes) else str(group_id)

                # Compute metrics
                posting_freq = (posts_7d / 7.0) if posts_7d else 0
                avg_r = float(avg_reactions) if avg_reactions else 0
                avg_c = float(avg_comments) if avg_comments else 0
                avg_s = float(avg_shares) if avg_shares else 0
                avg_interactions = avg_r + avg_c + avg_s

                eng_rate = (avg_interactions / member_count * 1000) if member_count and member_count > 0 else 0
                organic_ratio = (posts_5plus / denom_posts_7d) if denom_posts_7d and denom_posts_7d > 0 else 0

                # Compute scores
                s_freq = score_posting_frequency(posting_freq)
                s_eng = score_engagement_rate(eng_rate)
                s_comm = score_comment_density(avg_c)
                s_members = score_member_count(member_count)
                s_organic = score_organic_conversation(organic_ratio)
                total_score = s_freq + s_eng + s_comm + s_members + s_organic

                # Update facebook_groups
                cur.execute("""
                    UPDATE scraper.facebook_groups
                    SET posting_frequency_7d = %s,
                        avg_reactions_per_post = %s,
                        avg_comments_per_post = %s,
                        engagement_rate = %s,
                        vitality_score = %s
                    WHERE group_id = %s
                """, (round(posting_freq, 2), round(avg_r, 2), round(avg_c, 2),
                      round(eng_rate, 4), total_score, str(group_id)))

                # Update registry relevance_score
                cur.execute("""
                    UPDATE scraper.facebook_group_registry
                    SET relevance_score = %s
                    WHERE group_id = %s
                """, (total_score, str(group_id)))

                name_cur = conn.cursor()
                name_cur.execute("SELECT name FROM scraper.facebook_groups WHERE group_id = %s", (group_id,))
                name_row = name_cur.fetchone()
                name_val = name_row[0] if name_row else "?"
                name = name_val.decode() if isinstance(name_val, bytes) else str(name_val)[:40]

                print(f"  {name}: score={total_score}/100 "
                      f"(freq={s_freq} eng={s_eng} comm={s_comm} members={s_members} organic={s_organic})")

            print(f"[VITALITY] Updated {len(rows)} groups.")


if __name__ == "__main__":
    main()
