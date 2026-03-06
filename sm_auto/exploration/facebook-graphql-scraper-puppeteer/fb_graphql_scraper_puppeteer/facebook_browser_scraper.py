# -*- coding: utf-8 -*-
import json
import time

import pandas as pd
from bs4 import BeautifulSoup
import requests


class FacebookBrowserScraper:
    """Scraper that uses existing browser via Playwright CDP"""

    def __init__(self, ws_url=None):
        if ws_url is None:
            ws_url = "ws://127.0.0.1:9222/devtools/browser/835dff87-a6d6-4136-ac61-772a21d74021"

        self.ws_url = ws_url
        self._setup_browser()

    def _setup_browser(self):
        from playwright.sync_api import sync_playwright

        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.connect_over_cdp(self.ws_url)

        # Get first Facebook page
        contexts = self.browser.contexts
        if contexts:
            pages = contexts[0].pages
            # Find Facebook page
            fb_page = None
            for p in pages:
                if "facebook.com" in p.url:
                    fb_page = p
                    break
            self.page = fb_page if fb_page else pages[0] if pages else None

        self.graphql_responses = []

        if self.page:
            self.page.on("response", self._handle_response)
            print(f"Connected to page: {self.page.url}")

    def _handle_response(self, response):
        url = response.url
        if "/api/graphql/" in url:
            try:
                body = response.text()
                if body.strip():
                    self.graphql_responses.append({"url": url, "text": body})
            except Exception:
                pass

    def get_page_info(self):
        """Extract basic page info from DOM"""
        info = self.page.evaluate("""
            () => {
                const result = {
                    name: '',
                    followers: '',
                    following: '',
                    phone: '',
                    address: '',
                    website: '',
                    about: '',
                    posts: []
                };
                
                // Get page name
                const nameEl = document.querySelector('h1') || document.querySelector('[data-pagelet="PageHeader"] h1');
                if (nameEl) result.name = nameEl.innerText;
                
                // Get follower/following count
                const followText = document.body.innerText.match(/([\\d,]+)\\s*(followers?|following)/i);
                if (followText) result.followers = followText[0];
                
                // Get contact info
                const links = document.querySelectorAll('a[href^="tel:"], a[href^="mailto:"], a[href^="http"]');
                links.forEach(link => {
                    const href = link.href;
                    const text = link.innerText.trim();
                    if (href.startsWith('tel:')) result.phone = text;
                    else if (href.startsWith('http') && !href.includes('facebook')) result.website = text;
                });
                
                // Get address - look for address in text
                const bodyText = document.body.innerText;
                const addressMatch = bodyText.match(/\\d+\\s+[^\\n]+(?:Bangladesh|Dhaka|Chittagong|Sylhet)/i);
                if (addressMatch) result.address = addressMatch[0];
                
                // Get posts - look for post links
                const postLinks = document.querySelectorAll('a[href*="/posts/"]');
                postLinks.forEach(link => {
                    result.posts.push({
                        url: link.href,
                        text: link.innerText.substring(0, 100).trim()
                    });
                });
                
                return result;
            }
        """)
        return info

    def get_graphql_data(self):
        """Parse captured GraphQL responses"""
        results = []

        for resp_data in self.graphql_responses:
            text = resp_data.get("text", "")
            if not text:
                continue

            payloads = text.split("\n")
            for payload in payloads:
                if not payload.strip():
                    continue
                try:
                    data = json.loads(payload)
                    results.append(data)
                except json.JSONDecodeError:
                    continue

        return results

    def scrape_page(self, fb_username_or_userid, max_scrolls=10):
        # Navigate to page
        url = f"https://www.facebook.com/{fb_username_or_userid}"
        print(f"Navigating to {url}...")
        self.page.goto(url, wait_until="domcontentloaded")
        time.sleep(5)

        # Reset responses
        self.graphql_responses = []

        # Get page info
        print("Getting page info...")
        page_info = self.get_page_info()
        print(f"Page name: {page_info.get('name', 'N/A')}")
        print(f"Followers: {page_info.get('followers', 'N/A')}")
        print(f"Posts found: {len(page_info.get('posts', []))}")

        # Scroll to trigger more GraphQL requests
        print(f"Scrolling {max_scrolls} times...")
        for i in range(max_scrolls):
            self.page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            time.sleep(2)

        # Get GraphQL data
        print("Parsing GraphQL responses...")
        graphql_data = self.get_graphql_data()

        return {
            "page_info": page_info,
            "graphql_data": graphql_data,
            "response_count": len(self.graphql_responses),
        }

    def close(self):
        self.browser.close()
        self.pw.stop()


if __name__ == "__main__":
    scraper = FacebookBrowserScraper()
    result = scraper.scrape_page("ryanscomputersbanani", max_scrolls=10)
    print(f"\nCaptured {result['response_count']} GraphQL responses")
    print(f"Page info: {result['page_info']}")
    scraper.close()
