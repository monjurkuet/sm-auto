#!/usr/bin/env python3
"""
Parse Facebook page HTML to extract structured data.
"""

import re
import json
from datetime import datetime

# Read the HTML file
with open("facebook_page_source.html", "r", encoding="utf-8") as f:
    html = f.read()

# Extract data using regex
data = {
    "url": "https://www.facebook.com/cvrng",
    "page_name": None,
    "likes": None,
    "talking_about": None,
    "description": None,
    "website": None,
    "category": None,
    "location": None,
    "profile_image": None,
    "extracted_at": datetime.now().isoformat(),
}

# Extract from meta tags
og_title = re.search(r'<meta property="og:title" content="([^"]+)"', html)
if og_title:
    data["page_name"] = og_title.group(1)

og_desc = re.search(r'<meta property="og:description" content="([^"]+)"', html)
if og_desc:
    data["description"] = og_desc.group(1)
    # Extract likes and talking about from description
    desc = data["description"]
    likes_match = re.search(r'([\d,]+)\s*likes', desc, re.IGNORECASE)
    if likes_match:
        data["likes"] = likes_match.group(1)
    
    talking_match = re.search(r'([\d,]+)\s* talking about', desc, re.IGNORECASE)
    if talking_match:
        data["talking_about"] = talking_match.group(1)

og_url = re.search(r'<meta property="og:url" content="([^"]+)"', html)
if og_url:
    data["url"] = og_url.group(1)

og_image = re.search(r'<meta property="og:image" content="([^"]+)"', html)
if og_image:
    data["profile_image"] = og_image.group(1)

# Extract description meta tag
meta_desc = re.search(r'<meta name="description" content="([^"]+)"', html)
if meta_desc:
    data["meta_description"] = meta_desc.group(1)

# Extract Twitter data
twitter_title = re.search(r'<meta name="twitter:title" content="([^"]+)"', html)
if twitter_title:
    data["twitter_title"] = twitter_title.group(1)

twitter_desc = re.search(r'<meta name="twitter:description" content="([^"]+)"', html)
if twitter_desc:
    data["twitter_description"] = twitter_desc.group(1)

twitter_image = re.search(r'<meta name="twitter:image" content="([^"]+)"', html)
if twitter_image:
    data["twitter_image"] = twitter_image.group(1)

# Extract additional data from script tags (JSON data)
# Look for page data in script tags
scripts = re.findall(r'<script[^>]*>([^<]+)</script>', html)

# Look for specific patterns in the HTML
# Page ID
page_id_match = re.search(r'"pageID":"(\d+)"', html)
if page_id_match:
    data["page_id"] = page_id_match.group(1)

# Look for page category
category_match = re.search(r'"category":"([^"]+)"', html)
if category_match:
    data["category"] = category_match.group(1)

# Look for verified status
verified_match = re.search(r'"isVerified":(\w+)', html)
if verified_match:
    data["is_verified"] = verified_match.group(1) == "true"

# Print results
print("=" * 60)
print("FACEBOOK PAGE DATA EXTRACTION REPORT")
print("=" * 60)
print(f"\nPage URL: {data['url']}")
print(f"Page Name: {data['page_name']}")
print(f"Likes: {data['likes']}")
print(f"Talking About: {data['talking_about']}")
print(f"Description: {data['description']}")
print(f"Profile Image: {data['profile_image'][:80]}..." if data.get('profile_image') else "Profile Image: Not found")
print(f"Page ID: {data.get('page_id', 'Not found')}")
print(f"Category: {data.get('category', 'Not found')}")
print(f"Verified: {data.get('is_verified', 'Not found')}")
print(f"Extracted At: {data['extracted_at']}")

# Save to JSON
output_file = "facebook_page_report.json"
with open(output_file, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print(f"\n[✓] Report saved to: {output_file}")
