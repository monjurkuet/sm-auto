#!/usr/bin/env python3
"""
Aggregate discovered groups from batch search output.
Reads the last group_search.json, plus replays searches to collect results.

Usage:
  cd /root/codebase/sm-auto && set -a && source .env && set +a
  python3 scripts/aggregate_search_results.py
"""

import json
import os
import sys
import re
from pathlib import Path

OUTPUT_DIR = Path("/root/codebase/sm-auto/output")
REGISTRY_QUERY = """
SELECT group_url FROM scraper.facebook_group_registry WHERE is_active = true
"""

def extract_groups_from_json(path: Path) -> list[dict]:
    """Extract group results from a search output JSON file."""
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text())
        return data.get("results", [])
    except (json.JSONDecodeError, KeyError):
        return []


def main():
    # Read the last group_search.json
    search_file = OUTPUT_DIR / "group_search.json"
    groups = extract_groups_from_json(search_file)
    
    print(f"Groups from last search: {len(groups)}")
    
    # Also check all batch_query_*.json files (from batch script)
    all_groups = {}
    for f in sorted(OUTPUT_DIR.glob("batch_query_*.json")):
        try:
            data = json.loads(f.read_text())
            query = data.get("query", "unknown")
            for g in data.get("results", []):
                key = g.get("groupId") or g.get("url", "")
                if key and key not in all_groups:
                    g["foundBy"] = [query]
                    all_groups[key] = g
                elif key:
                    all_groups[key]["foundBy"].append(query)
        except:
            pass
    
    # Add groups from the last search file
    for g in groups:
        key = g.get("groupId") or g.get("url", "")
        if key and key not in all_groups:
            query = "last_search"
            g["foundBy"] = [query]
            all_groups[key] = g
    
    if not all_groups:
        print("No groups found in output files.")
        print("The batch search ran but results were overwritten each time.")
        print("Re-running the batch search with proper persistence is needed.")
        return
    
    # Sort by member count
    sorted_groups = sorted(
        all_groups.values(),
        key=lambda g: g.get("memberCount") or 0,
        reverse=True
    )
    
    # Print summary
    with_members = [g for g in sorted_groups if g.get("memberCount")]
    public = [g for g in sorted_groups if g.get("privacyType") == "Public"]
    private = [g for g in sorted_groups if g.get("privacyType") == "Private"]
    
    print(f"\nUnique groups found: {len(sorted_groups)}")
    print(f"With member count: {len(with_members)}")
    print(f"Public: {len(public)}")
    print(f"Private: {len(private)}")
    
    # Top 30 by members
    print(f"\nTop 30 groups by member count:")
    for i, g in enumerate(sorted_groups[:30], 1):
        members = f"{g['memberCount']:,}" if g.get("memberCount") else "?"
        privacy = g.get("privacyType") or "?"
        name = (g.get("name") or "Unknown")[:50]
        url = g.get("url") or ""
        queries = ", ".join(g.get("foundBy", []))
        print(f"  {i:3d}. {members:>10}  {privacy:>7}  {name}  [{queries}]")
    
    # Save aggregated report
    report_path = OUTPUT_DIR / "logs" / "search_aggregation.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "uniqueGroupsFound": len(sorted_groups),
        "groups": sorted_groups
    }
    report_path.write_text(json.dumps(report, indent=2))
    print(f"\nAggregated report saved to: {report_path}")


if __name__ == "__main__":
    main()
