import { ChromeClient } from '../src/browser/chrome_client';

interface SocialMediaLink {
  platform: string;
  handle: string;
  url: string;
}

interface PageInfo {
  pageId: string;
  userVanity: string;
  name: string;
  followers: number;
  following: number;
  category: string;
  bio: string;
  location: string;
  website: string;
  phone: string;
  email: string;
  socialMedia: SocialMediaLink[];
  isPage: boolean;
}

function parseNumber(str: string): number {
  if (!str) return 0;
  if (str.includes('K')) return Math.round(parseFloat(str) * 1000);
  if (str.includes('M')) return Math.round(parseFloat(str) * 1000000);
  return parseInt(str) || 0;
}

async function extractPageInfo(pageUrl: string): Promise<PageInfo> {
  const chrome = new ChromeClient(9222);
  const browser = await chrome.connect();
  
  const result: PageInfo = {
    pageId: '',
    userVanity: '',
    name: '',
    followers: 0,
    following: 0,
    category: '',
    bio: '',
    location: '',
    website: '',
    phone: '',
    email: '',
    socialMedia: [],
    isPage: false
  };
  
  try {
    const page = await browser.newPage();
    
    // 1. Get basic info from main profile page
    console.log(`Fetching ${pageUrl}...`);
    await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    
    const mainData = await page.evaluate(() => {
      const allText = document.body.innerText;
      const spans = Array.from(document.querySelectorAll('span')).map(s => s.textContent?.trim()).filter(Boolean);
      
      // Get page ID from scripts
      let pageId = '';
      let userVanity = '';
      const scripts = Array.from(document.querySelectorAll('script'));
      for (const s of scripts) {
        const content = s.textContent || '';
        if (content.includes('userID')) {
          const match = content.match(/"userID"\s*:\s*"(\d+)"/);
          if (match && !pageId) pageId = match[1];
          const match2 = content.match(/"userVanity"\s*:\s*"([^"]+)"/);
          if (match2 && !userVanity) userVanity = match2[1];
        }
      }
      
      // Extract followers/following
      let followers = '';
      let following = '';
      const profileMatch = allText.match(/([\d.KM]+)\s*followers?\s*•?\s*([\d.KM]*)\s*following?/i);
      if (profileMatch) {
        followers = profileMatch[1];
        following = profileMatch[2];
      }
      
      // Extract name
      const nameMatch = spans.find(s => /^Ryans/.test(s) && !s.includes('followers') && s.length < 50);
      
      // Extract category
      const categoryMatch = spans.find(s => s === 'Computer Store');
      
      // Extract bio
      const bioPatterns = [
        /Bangladesh's leading nationwide computer retail chain[^\.]*\./,
        /computer store[^\.]*solution[^\.]*\./i,
      ];
      let bio = '';
      for (const pattern of bioPatterns) {
        const match = allText.match(pattern);
        if (match) {
          bio = match[0];
          break;
        }
      }
      
      // Extract location
      const locationMatch = spans.find(s => /Rangpur.*Bangladesh/.test(s) || /Dhaka.*Bangladesh/.test(s));
      
      // Extract website
      const websiteMatch = spans.find(s => s === 'ryans.com' || s === 'www.ryans.com');
      
      return {
        pageId,
        userVanity,
        name: nameMatch || '',
        followers,
        following,
        category: categoryMatch || '',
        bio,
        location: locationMatch || '',
        website: websiteMatch || ''
      };
    });
    
    result.pageId = mainData.pageId;
    result.userVanity = mainData.userVanity;
    result.name = mainData.name;
    result.followers = parseNumber(mainData.followers);
    result.following = parseNumber(mainData.following);
    result.category = mainData.category;
    result.bio = mainData.bio;
    result.location = mainData.location;
    result.website = mainData.website;
    
    // 2. Get contact info from directory_contact_info
    console.log('Fetching contact info...');
    await page.goto(pageUrl + '/directory_contact_info', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    
    const contactData = await page.evaluate(() => {
      const allText = document.body.innerText;
      
      // Extract phone
      const phoneMatch = allText.match(/Phone[\s\n]+([\d\-\+]+)/);
      const phone = phoneMatch ? phoneMatch[1] : '';
      
      // Extract email
      const emailMatch = allText.match(/Email[\s\n]+([\w.-]+@[\w.-]+\.\w+)/);
      const email = emailMatch ? emailMatch[1] : '';
      
      // Extract social media from anchor tags
      const socialMedia: Array<{platform: string, handle: string, url: string}> = [];
      const anchors = document.querySelectorAll('a');
      
      for (const anchor of anchors) {
        const href = (anchor as HTMLAnchorElement).href;
        const text = anchor.textContent?.trim() || '';
        
        // Skip if not a social media link
        if (!href.includes('instagram.com') && 
            !href.includes('tiktok.com') && 
            !href.includes('tumblr.com') &&
            !href.includes('pinterest.com') &&
            !href.includes('youtube.com') &&
            !href.includes('x.com') &&
            !href.includes('twitter.com')) {
          continue;
        }
        
        // Extract platform
        let platform = 'unknown';
        if (href.includes('instagram.com')) platform = 'instagram';
        else if (href.includes('tiktok.com')) platform = 'tiktok';
        else if (href.includes('tumblr.com')) platform = 'tumblr';
        else if (href.includes('pinterest.com')) platform = 'pinterest';
        else if (href.includes('youtube.com')) platform = 'youtube';
        else if (href.includes('x.com') || href.includes('twitter.com')) platform = 'x';
        
        // Extract handle - use text content, or parse from URL
        let handle = text;
        if (href.includes('@')) {
          const match = href.match(/@([^?&=\/]+)/);
          if (match) handle = '@' + match[1];
        }
        
        // Only add if not duplicate
        if (!socialMedia.some(s => s.platform === platform)) {
          socialMedia.push({ platform, handle, url: href });
        }
      }
      
      return { phone, email, socialMedia };
    });
    
    result.phone = contactData.phone;
    result.email = contactData.email;
    result.socialMedia = contactData.socialMedia;
    
    return result;
    
  } finally {
    await chrome.disconnect();
  }
}

// Test with both pages
async function main() {
  console.log('=== Testing ryanscomputers (profile) ===');
  const profileResult = await extractPageInfo('https://www.facebook.com/ryanscomputers');
  console.log(JSON.stringify(profileResult, null, 2));
  
  console.log('\n\n=== Testing ryanscomputersbanani (page) ===');
  const pageResult = await extractPageInfo('https://www.facebook.com/ryanscomputersbanani');
  console.log(JSON.stringify(pageResult, null, 2));
}

main().catch(console.error);
