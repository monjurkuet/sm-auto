#!/usr/bin/env python3
"""
Test script to verify the extractor fixes work correctly.
"""

import sys
import json

# Add the project root to path
sys.path.insert(0, '.')

from sm_auto.platforms.facebook.page.extractor import FacebookPageExtractor


def test_extractor():
    """Test the extractor with debug HTML files."""
    
    extractor = FacebookPageExtractor()
    
    # Test with one of the debug HTML files
    test_files = [
        "debug_LivewireBD.html",
        "debug_GoriberGadget.html",
        "debug_KryInternational.html",
    ]
    
    for filename in test_files:
        try:
            with open(filename, "r", encoding="utf-8") as f:
                html = f.read()
            
            # Construct page URL from filename
            page_name = filename.replace("debug_", "").replace(".html", "")
            page_url = f"https://www.facebook.com/{page_name}"
            
            print(f"\n{'='*60}")
            print(f"Testing: {filename}")
            print(f"{'='*60}")
            
            result = extractor.extract_from_html(html, page_url)
            
            print(f"Page Name: {result.page_name}")
            print(f"Page URL: {result.page_url}")
            print(f"Username: {result.username}")
            print(f"Page ID: {result.page_id}")
            print(f"Category: {result.category}")
            print(f"Description: {result.description[:100]}..." if result.description and len(result.description or "") > 100 else f"Description: {result.description}")
            print(f"Likes: {result.likes} (numeric: {result.likes_numeric})")
            print(f"Followers: {result.followers} (numeric: {result.followers_numeric})")
            print(f"Talking About: {result.talking_about} (numeric: {result.talking_about_numeric})")
            print(f"Checkins: {result.checkins} (numeric: {result.checkins_numeric})")
            print(f"Location: {result.location}")
            print(f"Website: {result.website}")
            print(f"Phone: {result.phone}")
            print(f"Email: {result.email}")
            print(f"Profile Image: {result.profile_image_url[:80]}..." if result.profile_image_url and len(result.profile_image_url or "") > 80 else f"Profile Image: {result.profile_image_url}")
            print(f"Cover Image: {result.cover_image_url[:80]}..." if result.cover_image_url and len(result.cover_image_url or "") > 80 else f"Cover Image: {result.cover_image_url}")
            print(f"Verified: {result.is_verified}")
            print(f"Extraction Method: {result.extraction_method}")
            
        except FileNotFoundError:
            print(f"\nSkipping {filename} - file not found")
        except Exception as e:
            print(f"\nError processing {filename}: {e}")


if __name__ == "__main__":
    test_extractor()
