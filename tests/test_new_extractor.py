
import os
import sys
from sm_auto.platforms.facebook.page.extractor import FacebookPageExtractor

def test_extraction():
    extractor = FacebookPageExtractor()
    
    debug_files = [f for f in os.listdir('.') if f.startswith('debug_') and f.endswith('.html')]
    
    if not debug_files:
        print("No debug HTML files found to test with.")
        return

    for html_file in debug_files:
        print(f"
Testing extraction from: {html_file}")
        with open(html_file, 'r', encoding='utf-8') as f:
            html = f.read()
        
        # Fake URL based on filename
        page_url = f"https://www.facebook.com/{html_file.replace('debug_', '').replace('.html', '')}"
        
        result = extractor.extract_from_html(html, page_url)
        
        print(f"  Page Name: {result.page_name}")
        print(f"  Likes: {result.likes} ({result.likes_numeric})")
        print(f"  Followers: {result.followers} ({result.followers_numeric})")
        print(f"  Talking About: {result.talking_about} ({result.talking_about_numeric})")
        print(f"  Checkins: {result.checkins} ({result.checkins_numeric})")
        print(f"  Category: {result.category}")
        print(f"  Verified: {result.is_verified}")

if __name__ == "__main__":
    # Add project root to sys.path
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    if project_root not in sys.path:
        sys.path.insert(0, project_root)
        
    test_extraction()
