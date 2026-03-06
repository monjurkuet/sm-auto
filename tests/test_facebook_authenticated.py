#!/usr/bin/env python3
"""
Test script for Facebook page extraction with authenticated Chrome profile.
Runs in headed mode (visible browser) with an existing Chrome profile.
"""

import asyncio
import json
import re
from datetime import datetime
from pathlib import Path

import nodriver as uc


# JavaScript extraction function
EXTRACT_SCRIPT = """() => {
  const data = {
    // Basic info
    url: window.location.href,
    pathname: window.location.pathname,
    
    // Page header info
    name: document.querySelector('h1')?.textContent?.trim(),
    
    // Verification
    isVerified: !!document.querySelector('[aria-label*="Verified"]') || 
               !!document.querySelector('[data-testid="verificationBadge"]') ||
               !!document.querySelector('svg[aria-label="Verified page"]'),
    
    // Get all text for pattern matching
    fullText: document.body.innerText,
    
    // Cover photo
    coverPhoto: document.querySelector('[data-pagelet="PageCover"] image')?.getAttribute('xlink:href') ||
               document.querySelector('image[preserveAspectRatio="xMidYMid slice"]')?.getAttribute('xlink:href') ||
               document.querySelector('a[href*="cover_photo"] img')?.src,
    
    // Profile photo
    profilePhoto: document.querySelector('[data-pagelet="PageAvatar"] img')?.src ||
                 document.querySelector('image[aria-label*="Profile"]')?.getAttribute('xlink:href'),
    
    // Category
    category: document.querySelector('a[href*="category"]')?.textContent?.trim() ||
             document.querySelector('[data-pagelet*="Category"]')?.textContent?.trim(),
    
    // Location
    location: document.querySelector('a[href*="place"]')?.textContent?.trim() ||
             document.querySelector('[data-pagelet*="Location"]')?.textContent?.trim(),
    
    // Contact info
    phone: document.querySelector('a[href^="tel:"]')?.textContent?.trim(),
    email: document.querySelector('a[href^="mailto:"]')?.textContent?.trim(),
    website: document.querySelector('a[href^="http"]')?.href,
    
    // Username (from URL patterns)
    username: window.location.pathname.split('/')[1],
    
    // Page ID (from various data attributes)
    pageId: document.body.innerHTML.match(/"pageID":"(\\d+)"/)?.[1] ||
           document.body.innerHTML.match(/"page_id":"(\\d+)"/)?.[1],
    
    // Followers and likes from structured data
    followers: null,
    likes: null,
    
    // About section
    about: null,
    
    // Additional links
    allLinks: Array.from(document.querySelectorAll('a[href]')).map(a => ({
      text: a.textContent?.trim(),
      href: a.href
    })).filter(a => a.text && a.text.length < 50).slice(0, 50),
  };
  
  // Try to find stats in the full text
  const text = data.fullText;
  
  // Followers
  const followersMatch = text.match(/(\\d[\\d,]*K?)\\s*followers?/i);
  if (followersMatch) data.followers = followersMatch[1];
  
  // Likes  
  const likesMatch = text.match(/(\\d[\\d,]*K?)\\s*likes?/i);
  if (likesMatch) data.likes = likesMatch[1];
  
  // Try to find about section
  const aboutMatch = text.match(/About[\\s\\S]{0,200}(?:\\.\\.\\.|read more)/i);
  if (aboutMatch) data.about = aboutMatch[0];
  
  return data;
}
"""


async def test_with_authenticated_profile(
    page_url: str = "https://www.facebook.com/cvrng",
    profile_path: str = "/root/.config/google-chrome/Default"
):
    """Test with authenticated Chrome profile."""
    
    print("\n" + "="*60)
    print("Facebook Page Extraction - Authenticated Mode")
    print("URL: " + page_url)
    print("Profile: " + profile_path)
    print("="*60 + "\n")
    
    browser = None
    try:
        # Launch browser with authenticated profile (headed mode)
        print("[1] Launching browser with authenticated profile...")
        print("    (Browser window should be visible)")
        
        browser = await uc.start(
            headless=False,  # Headed mode
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
        print("[2] Using tab: " + str(tab))
        
        # Wait for page to fully load
        print("[3] Waiting for page to load...")
        await asyncio.sleep(10)
        
        # Get current URL
        current_url = str(tab.url)
        print("[3] Current URL: " + current_url)
        
        if "login" in current_url.lower():
            print("[!] Still on login page - profile not authenticated!")
            return {"error": "login_required", "url": current_url}
        
        # Execute JavaScript extraction
        print("[4] Executing JavaScript extraction...")
        
        try:
            result = await tab.evaluate(EXTRACT_SCRIPT)
            
            if result and not hasattr(result, 'exception'):
                # Process results
                result['extracted_at'] = datetime.now().isoformat()
                result['method'] = 'javascript_authenticated'
                result['current_url'] = current_url
                
                # Print results
                print("\n" + "="*60)
                print("EXTRACTED DATA")
                print("="*60)
                
                for key, value in result.items():
                    if key == 'fullText':
                        print(key + ": " + value[:500] + "...")
                    elif key == 'allLinks':
                        print(key + ": " + str(len(value)) + " links")
                    elif value:
                        print(key + ": " + str(value))
                
                # Save results
                output_file = "facebook_authenticated_result.json"
                with open(output_file, "w", encoding="utf-8") as f:
                    json.dump(result, f, indent=2, ensure_ascii=False)
                
                print("\n[✓] Results saved to: " + output_file)
                
                # Also try to get page source for more data
                print("\n[5] Getting additional data from page source...")
                try:
                    page_source = await tab.get_content()
                    with open("facebook_authenticated_source.html", "w", encoding="utf-8") as f:
                        f.write(page_source)
                    print("[5] Page source saved (" + str(len(page_source)) + " chars)")
                except Exception as e:
                    print("[!] Error getting page source: " + str(e))
                
                return result
            else:
                print("[!] JavaScript returned error or None")
                if hasattr(result, 'exception'):
                    print("    Exception: " + str(result.exception))
                    
        except Exception as js_err:
            print("[!] JavaScript error: " + str(js_err))
        
        # Fallback: get page source
        print("\n[*] Falling back to page source extraction...")
        try:
            page_source = await tab.get_content()
            
            # Parse basic data from HTML
            data = {
                "url": page_url,
                "extracted_at": datetime.now().isoformat(),
                "method": "html_parsing",
            }
            
            # Extract from meta tags
            og_title = re.search(r'<meta property="og:title" content="([^"]+)"', page_source)
            if og_title:
                data["page_name"] = og_title.group(1)
            
            og_desc = re.search(r'<meta property="og:description" content="([^"]+)"', page_source)
            if og_desc:
                data["description"] = og_desc.group(1)
            
            og_image = re.search(r'<meta property="og:image" content="([^"]+)"', page_source)
            if og_image:
                data["profile_image"] = og_image.group(1)
            
            # Extract likes and talking about
            likes = re.search(r'(\d[\d,]*)\s*likes', page_source)
            if likes:
                data["likes"] = likes.group(1)
            
            talking = re.search(r'(\d[\d,]*)\s* talking about', page_source)
            if talking:
                data["talking_about"] = talking.group(1)
            
            print("\n" + "="*60)
            print("EXTRACTED DATA (HTML Fallback)")
            print("="*60)
            
            for key, value in data.items():
                print(key + ": " + str(value))
            
            # Save
            with open("facebook_authenticated_result.json", "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            
            print("\n[✓] Results saved")
            
            return data
            
        except Exception as e:
            print("[!] Fallback error: " + str(e))
            return None
            
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
    profile = "/root/.config/google-chrome/Default"
    
    if len(sys.argv) > 1:
        url = sys.argv[1]
    if len(sys.argv) > 2:
        profile = sys.argv[2]
    
    asyncio.run(test_with_authenticated_profile(url, profile))
