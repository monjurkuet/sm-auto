#!/usr/bin/env python3
"""
Comprehensive Facebook page extraction with authenticated Chrome profile.
Extracts maximum data from the page including HTML parsing.
"""

import asyncio
import json
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

import nodriver as uc


async def extract_facebook_page(
    page_url: str = "https://www.facebook.com/cvrng",
    profile_path: str = "/root/.config/google-chrome/Default"
):
    """Comprehensive Facebook page extraction."""
    
    print("\n" + "="*60)
    print("Facebook Page Extraction - Comprehensive")
    print("URL: " + page_url)
    print("="*60 + "\n")
    
    browser = None
    try:
        # Launch browser
        print("[1] Launching browser with authenticated profile...")
        browser = await uc.start(
            headless=False,
            sandbox=False,
            user_data_dir=profile_path,
            browser_args=[
                "--no-sandbox",
                "--disable-dev-shm-usage", 
                "--disable-gpu",
                "--ignore-certificate-errors",
            ]
        )
        print("[1] Browser launched")
        
        # Navigate to page
        print("[2] Navigating to " + page_url + "...")
        tab = await browser.get(page_url)
        
        # Wait for page to load
        print("[3] Waiting for page to load...")
        await asyncio.sleep(12)
        
        # Get page source
        print("[4] Getting page source...")
        page_source = await tab.get_content()
        
        # Save raw HTML
        with open("facebook_full_source.html", "w", encoding="utf-8") as f:
            f.write(page_source)
        print("[4] Saved page source (" + str(len(page_source)) + " chars)")
        
        # Parse data from HTML
        data = {
            "url": page_url,
            "extracted_at": datetime.now().isoformat(),
            "source_length": len(page_source),
        }
        
        # ======= OpenGraph Meta Tags =======
        print("[5] Extracting data from meta tags...")
        
        # og:title - page name
        og_title = re.search(r'<meta\s+property="og:title"\s+content="([^"]+)"', page_source)
        if og_title:
            data["page_name"] = og_title.group(1).strip()
        
        # og:description
        og_desc = re.search(r'<meta\s+property="og:description"\s+content="([^"]+)"', page_source)
        if og_desc:
            data["description"] = og_desc.group(1).strip()
        
        # og:url
        og_url = re.search(r'<meta\s+property="og:url"\s+content="([^"]+)"', page_source)
        if og_url:
            data["canonical_url"] = og_url.group(1).strip()
        
        # og:image
        og_image = re.search(r'<meta\s+property="og:image"\s+content="([^"]+)"', page_source)
        if og_image:
            data["profile_image_url"] = og_image.group(1).strip()
        
        # og:type
        og_type = re.search(r'<meta\s+property="og:type"\s+content="([^"]+)"', page_source)
        if og_type:
            data["page_type"] = og_type.group(1).strip()
        
        # ======= Twitter Card Tags =======
        twitter_title = re.search(r'<meta\s+name="twitter:title"\s+content="([^"]+)"', page_source)
        if twitter_title:
            data["twitter_title"] = twitter_title.group(1).strip()
        
        twitter_desc = re.search(r'<meta\s+name="twitter:description"\s+content="([^"]+)"', page_source)
        if twitter_desc:
            data["twitter_description"] = twitter_desc.group(1).strip()
        
        twitter_image = re.search(r'<meta\s+name="twitter:image"\s+content="([^"]+)"', page_source)
        if twitter_image:
            data["twitter_image_url"] = twitter_image.group(1).strip()
        
        # ======= Application Tags =======
        # iOS app URL
        ios_url = re.search(r'<meta\s+property="al:ios:url"\s+content="([^"]+)"', page_source)
        if ios_url:
            data["ios_app_url"] = ios_url.group(1).strip()
        
        # Android app URL
        android_url = re.search(r'<meta\s+property="al:android:url"\s+content="([^"]+)"', page_source)
        if android_url:
            data["android_app_url"] = android_url.group(1).strip()
        
        # ======= Extract Likes & Stats =======
        # From description: "54,195 likes · 944 talking about this"
        desc = data.get("description", "")
        
        likes_match = re.search(r'([\d,]+)\s*likes', desc, re.IGNORECASE)
        if likes_match:
            data["likes"] = likes_match.group(1)
        
        talking_match = re.search(r'([\d,]+)\s* talking about', desc, re.IGNORECASE)
        if talking_match:
            data["talking_about"] = talking_match.group(1)
        
        # ======= Extract from page text =======
        # Get body text
        body_match = re.search(r'<body[^>]*>(.*?)</body>', page_source, re.DOTALL | re.IGNORECASE)
        if body_match:
            body_text = body_match.group(1)
            # Remove HTML tags
            body_text = re.sub(r'<[^>]+>', ' ', body_text)
            body_text = re.sub(r'\s+', ' ', body_text).strip()
            
            # Find additional stats
            # Followers
            followers_match = re.search(r'([\d,]+)\s*(?:K|M)?\s*followers?', body_text, re.IGNORECASE)
            if followers_match and not data.get("followers"):
                data["followers"] = followers_match.group(1)
            
            # Check-ins
            checkins_match = re.search(r'([\d,]+)\s*(?:K|M)?\s*check-?ins?', body_text, re.IGNORECASE)
            if checkins_match:
                data["checkins"] = checkins_match.group(1)
            
            # Phone
            phone_match = re.search(r'\+?[\d\s\-\(\)]{10,}', body_text)
            if phone_match:
                potential_phone = phone_match.group(0).strip()
                if len(potential_phone) >= 10:
                    data["phone"] = potential_phone
            
            # Email
            email_match = re.search(r'[\w\.\-]+@[\w\.\-]+\.\w+', body_text)
            if email_match:
                data["email"] = email_match.group(0)
            
            # Website
            website_match = re.search(r'https?://[^\s<>"{}|\\^`\[\]]+', body_text)
            if website_match:
                data["website"] = website_match.group(0)
            
            # Location
            location_patterns = [
                r'([A-Z][a-zA-Z\s]+,\s*[A-Z]{2})',  # City, State
                r'(?:Location|City)[:\s]*([A-Za-z\s,]+)',
            ]
            for pattern in location_patterns:
                loc_match = re.search(pattern, body_text)
                if loc_match:
                    data["location_raw"] = loc_match.group(1).strip()
                    break
        
        # ======= Extract additional JSON data =======
        # Look for page ID
        page_id_match = re.search(r'"pageID":"(\d+)"', page_source)
        if page_id_match:
            data["page_id"] = page_id_match.group(1)
        
        page_id_match2 = re.search(r'"page_id":"(\d+)"', page_source)
        if page_id_match2:
            data["page_id"] = page_id_match2.group(1)
        
        # ======= Print Results =======
        print("\n" + "="*60)
        print("EXTRACTED DATA")
        print("="*60)
        
        for key, value in data.items():
            if isinstance(value, str) and len(value) > 80:
                print(key + ": " + value[:80] + "...")
            else:
                print(key + ": " + str(value))
        
        # Save to JSON
        output_file = "facebook_comprehensive_result.json"
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        print("\n[✓] Results saved to: " + output_file)
        
        # Summary
        print("\n" + "="*60)
        print("SUMMARY")
        print("="*60)
        print("Page Name: " + str(data.get("page_name", "N/A")))
        print("Likes: " + str(data.get("likes", "N/A")))
        print("Talking About: " + str(data.get("talking_about", "N/A")))
        print("Page ID: " + str(data.get("page_id", "N/A")))
        print("Profile Image: " + str(data.get("profile_image_url", "N/A"))[:60] + "...")
        print("Description: " + str(data.get("description", "N/A"))[:80] + "...")
        
        return data
        
    except Exception as e:
        print("[!] Error: " + str(e))
        import traceback
        traceback.print_exc()
        return None
        
    finally:
        print("\n[6] Closing browser...")
        if browser:
            try:
                await browser.stop()
            except:
                pass


if __name__ == "__main__":
    import sys
    
    url = "https://www.facebook.com/cvrng"
    if len(sys.argv) > 1:
        url = sys.argv[1]
    
    asyncio.run(extract_facebook_page(url))
