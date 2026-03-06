# -*- coding: utf-8 -*-
import asyncio
import json
import time
import http.client
from urllib.parse import parse_qs, unquote

import pandas as pd
from bs4 import BeautifulSoup
import requests
from playwright.sync_api import sync_playwright


def get_debugger_url(host="127.0.0.1", port=9222):
    conn = http.client.HTTPConnection(host, port)
    conn.request("GET", "/json/version")
    response = conn.getresponse()
    data = json.loads(response.read().decode())
    return data["webSocketDebuggerUrl"]


def find_feedback_with_subscription_target_id(data):
    if isinstance(data, dict):
        if "feedback" in data and isinstance(data["feedback"], dict):
            feedback = data["feedback"]
            if "subscription_target_id" in list(feedback.keys()):
                return feedback
        for value in data.values():
            result = find_feedback_with_subscription_target_id(value)
            if result:
                return result
    elif isinstance(data, list):
        for item in data:
            result = find_feedback_with_subscription_target_id(item)
            if result:
                return result
    return None


def find_message_text(data):
    if isinstance(data, dict):
        if "story" in data:
            if isinstance(data["story"], dict) and "message" in data["story"]:
                if (
                    isinstance(data["story"]["message"], dict)
                    and "text" in data["story"]["message"]
                ):
                    return data["story"]["message"]["text"]
        for value in data.values():
            result = find_message_text(value)
            if result:
                return result
    elif isinstance(data, list):
        for item in data:
            result = find_message_text(item)
            if result:
                return result
    return None


def find_creation(data):
    if isinstance(data, dict):
        if "story" in data:
            if isinstance(data["story"], dict) and "creation_time" in data["story"]:
                return data["story"]["creation_time"]
        for value in data.values():
            result = find_creation(value)
            if result:
                return result
    elif isinstance(data, list):
        for item in data:
            result = find_creation(item)
            if result:
                return result
    return None


def find_owning_profile(data):
    if isinstance(data, dict):
        if "owning_profile" in data:
            if isinstance(data["owning_profile"], dict):
                return data["owning_profile"]
        for value in data.values():
            result = find_owning_profile(value)
            if result:
                return result
    elif isinstance(data, list):
        for item in data:
            result = find_owning_profile(item)
            if result:
                return result
    return None


def days_difference_from_now(tmp_creation_array):
    from datetime import datetime

    timestamp = min(tmp_creation_array)
    current_date_time = datetime.now()
    date_time_obj = datetime.fromtimestamp(timestamp)
    difference = current_date_time - date_time_obj
    return difference.days


def is_date_exceed_limit(max_days_ago, days_limit=61):
    return max_days_ago > days_limit


class PlaywrightPage:
    def __init__(self, ws_url=None, open_browser=False):
        if ws_url is None:
            ws_url = get_debugger_url()

        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.connect_over_cdp(ws_url)

        # Get existing pages or create new one
        existing_pages = self.browser.contexts[0].pages if self.browser.contexts else []
        if existing_pages:
            self.page = existing_pages[0]
            print(f"Using existing page: {self.page.url}")
        else:
            self.page = self.browser.new_page()

        self.graphql_responses = []

        self.page.on("response", self._handle_response)

    def _handle_response(self, response):
        url = response.url
        if "/api/graphql/" in url or "/graphql/" in url:
            try:
                body = response.text()
                self.graphql_responses.append({"url": url, "text": body})
            except Exception:
                pass

    def navigate(self, url):
        try:
            self.page.goto(url, wait_until="domcontentloaded", timeout=90000)
        except Exception as e:
            print(f"Navigation error: {e}")
            # Try with network idle
            try:
                self.page.goto(url, wait_until="networkidle", timeout=60000)
            except Exception as e2:
                print(f"Fallback navigation failed: {e2}")
        time.sleep(3)

    def scroll_down(self, distance=4000):
        try:
            self.page.evaluate(f"window.scrollBy(0, {distance})")
        except Exception as e:
            print(f"Scroll error: {e}")

    def scroll_to_bottom(self, delay=2000):
        self.page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        time.sleep(delay / 1000)

    def get_page_source(self):
        return self.page.content()

    def click_element(self, selector):
        self.page.click(selector)

    def wait_for_selector(self, selector, timeout=30000):
        self.page.wait_for_selector(selector, timeout=timeout)

    def close(self):
        # Don't close the existing browser/page, just disconnect
        self.browser.close()
        self.playwright.stop()


class PlaywrightRequestsParser:
    def __init__(self, page):
        self.page = page
        self.reaction_names = ["讚", "哈", "怒", "大心", "加油", "哇", "嗚"]
        self.en_reaction_names = [
            "like",
            "haha",
            "angry",
            "love",
            "care",
            "sorry",
            "wow",
        ]
        self.res_new = []
        self.feedback_list = []
        self.context_list = []
        self.creation_list = []
        self.author_id_list = []
        self.author_id_list2 = []
        self.owning_profile = []

    def get_graphql_responses(self):
        responses = []
        for resp_data in self.page.graphql_responses:
            text = resp_data.get("text", "")
            if text:
                payloads = text.split("\n")
                for payload in payloads:
                    if payload.strip():
                        try:
                            parsed = json.loads(payload)
                            responses.append(parsed)
                        except json.JSONDecodeError:
                            pass
        return responses

    def _clean_res(self):
        self.res_new = []
        self.feedback_list = []
        self.context_list = []
        self.creation_list = []
        self.author_id_list = []
        self.author_id_list2 = []
        self.owning_profile = []

    def parse_body(self, body_content):
        for each_body in body_content:
            if isinstance(each_body, str):
                try:
                    json_data = json.loads(each_body)
                except json.JSONDecodeError:
                    continue
            else:
                json_data = each_body

            self.res_new.append(json_data)
            try:
                each_res = json_data["data"]["node"].copy()
                each_feedback = find_feedback_with_subscription_target_id(each_res)
                if each_feedback:
                    self.feedback_list.append(each_feedback)
                    message_text = find_message_text(json_data)
                    creation_time = find_creation(json_data)
                    owing_profile = find_owning_profile(json_data)
                    if message_text:
                        self.context_list.append(message_text)
                    else:
                        self.context_list.append(None)
                    if creation_time:
                        self.creation_list.append(creation_time)
                    self.owning_profile.append(owing_profile)
            except Exception:
                pass

    def collect_posts(self):
        res_out = []
        for each in self.feedback_list:
            res_out.append(
                {
                    "post_id": each["subscription_target_id"],
                    "reaction_count": each["reaction_count"],
                    "top_reactions": each["top_reactions"],
                    "share_count": each["share_count"],
                    "comment_rendering_instance": each["comment_rendering_instance"],
                    "video_view_count": each.get("video_view_count"),
                }
            )
        return res_out

    def convert_res_to_df(self, res_in):
        df_res = pd.json_normalize(res_in)
        df_res = df_res[
            [
                "post_id",
                "reaction_count.count",
                "comment_rendering_instance.comments.total_count",
                "share_count.count",
                "top_reactions.edges",
                "video_view_count",
            ]
        ]
        return df_res

    def process_reactions(self, reactions_in):
        reaction_hash = {}
        for each_react in reactions_in:
            reaction_hash[each_react["node"]["localized_name"]] = each_react[
                "reaction_count"
            ]
        return reaction_hash

    def extract_first_payload(self, payload_str):
        parsed_data = parse_qs(payload_str)
        decoded_data = {
            unquote(k): [unquote(v) for v in vals] for k, vals in parsed_data.items()
        }
        first_payload = {k: v[0] for k, v in decoded_data.items()}
        payload_variables = json.loads(first_payload["variables"])
        first_payload["variables"] = payload_variables
        return first_payload


class FacebookPlaywrightScraper:
    def __init__(self, ws_url=None, open_browser=False):
        self.page = PlaywrightPage(ws_url=ws_url, open_browser=open_browser)
        self.requests_parser = PlaywrightRequestsParser(self.page)
        self.post_id_list = []
        self.reaction_count_list = []
        self.profile_feed = []
        self.res = {
            "post_caption": [],
            "post_date": [],
            "post_likes": [],
            "comment_share_type": [],
            "comment_share_value": [],
        }
        self.pre_diff_days = float("-inf")
        self.counts_of_same_diff_days = 0

    def _clean_res(self):
        self.post_id_list = []
        self.reaction_count_list = []
        self.profile_feed = []
        self.res = {
            "post_caption": [],
            "post_date": [],
            "post_likes": [],
            "comment_share_type": [],
            "comment_share_value": [],
        }
        self.requests_parser._clean_res()

    def check_progress(self, days_limit=61, display_progress=True):
        graphql_data = self.requests_parser.get_graphql_responses()
        tmp_creation_array = []

        for json_data in graphql_data:
            try:
                each_res = json_data["data"]["node"].copy()
                each_feedback = find_feedback_with_subscription_target_id(each_res)
                if each_feedback:
                    creation_time = find_creation(json_data)
                    if creation_time:
                        tmp_creation_array.append(int(creation_time))
            except Exception:
                pass

        if not tmp_creation_array:
            return True

        diff_days = days_difference_from_now(tmp_creation_array=tmp_creation_array)

        if self.pre_diff_days == diff_days:
            self.counts_of_same_diff_days += 1
        else:
            self.counts_of_same_diff_days = 0
        self.pre_diff_days = max(diff_days, self.pre_diff_days)

        if display_progress:
            print(
                f"To access posts acquired within the past {self.pre_diff_days} days."
            )

        return is_date_exceed_limit(max_days_ago=diff_days, days_limit=days_limit)

    def get_profile_feed(self):
        time.sleep(2)
        page_source = self.page.get_page_source()
        soup = BeautifulSoup(page_source, "html.parser")

        target_div = soup.find("div", {"data-pagelet": "ProfileTilesFeed_0"})
        if not target_div:
            target_div = soup.find("div", class_="xieb3on")

        if target_div:
            texts = target_div.find_all(text=True)
            return texts[2::]
        return []

    def get_plugin_page_followers(self, fb_username_or_userid):
        plugin_page_url = f"https://www.facebook.com/plugins/page.php?href=https%3A%2F%2Fwww.facebook.com%2F{fb_username_or_userid}&tabs=timeline&width=340&height=500&small_header=false&adapt_container_width=true&hide_cover=false&show_facepile=true&appId&locale=en_us"
        plugin_response = requests.get(url=plugin_page_url)
        plugin_soup = BeautifulSoup(plugin_response.text, "html.parser")
        plugin_soup = plugin_soup.find("div", class_="_1drq")
        if not plugin_soup:
            return plugin_soup
        return plugin_soup.text

    def format_data(self, res_in, fb_username_or_userid, new_reactions):
        final_res = pd.json_normalize(res_in)
        final_res["context"] = self.requests_parser.context_list
        final_res["username_or_userid"] = fb_username_or_userid
        final_res["owing_profile"] = self.requests_parser.owning_profile
        final_res["sub_reactions"] = new_reactions
        final_res["post_url"] = "https://www.facebook.com/" + final_res["post_id"]
        final_res["time"] = self.requests_parser.creation_list
        final_res["published_date"] = pd.to_datetime(final_res["time"], unit="s")
        final_res["published_date2"] = final_res["published_date"].dt.strftime(
            "%Y-%m-%d"
        )
        final_res = final_res[
            [
                "post_id",
                "post_url",
                "username_or_userid",
                "owing_profile",
                "published_date",
                "published_date2",
                "time",
                "reaction_count.count",
                "comment_rendering_instance.comments.total_count",
                "share_count.count",
                "sub_reactions",
                "context",
                "video_view_count",
            ]
        ].to_dict(orient="records")

        filtered_post_id = []
        filtered_data = []
        for each_data in list(final_res):
            if each_data["post_id"] not in filtered_post_id:
                filtered_data.append(each_data)
                filtered_post_id.append(each_data["post_id"])
        return filtered_data

    def process_reactions(self, res_in):
        reactions_out = []
        for each_res in res_in:
            each_reactions = each_res["top_reactions"]["edges"]
            processed_reactions = self.requests_parser.process_reactions(
                reactions_in=each_reactions
            )
            reactions_out.append(processed_reactions)
        return reactions_out

    def get_init_payload(self):
        return None

    def scroll_and_collect(self, url, max_scrolls=30, display_progress=True):
        self.page.navigate(url)
        time.sleep(3)

        for _ in range(max_scrolls):
            self.page.scroll_down(4000)
            time.sleep(1)
            self.page.scroll_to_bottom(2000)

            if display_progress and _ % 5 == 0:
                if self.check_progress(
                    days_limit=61, display_progress=display_progress
                ):
                    break
                elif self.counts_of_same_diff_days >= 5:
                    break

    def get_user_posts(
        self,
        fb_username_or_userid: str,
        days_limit: int = 61,
        display_progress: bool = True,
        max_scrolls: int = 30,
    ) -> dict:
        url = f"https://www.facebook.com/{fb_username_or_userid}?locale=en_us"

        self._clean_res()
        self.pre_diff_days = float("-inf")
        self.counts_of_same_diff_days = 0

        self.page.navigate(url)
        time.sleep(3)

        for i in range(max_scrolls):
            self.page.scroll_down(4000)
            time.sleep(1)
            self.page.scroll_to_bottom(2000)

            if display_progress and i % 5 == 0 and i > 0:
                if self.check_progress(
                    days_limit=days_limit, display_progress=display_progress
                ):
                    break
                elif self.counts_of_same_diff_days >= 5:
                    break

        profile_feed = self.get_profile_feed()

        if "Page" in profile_feed:
            followers = self.get_plugin_page_followers(
                fb_username_or_userid=fb_username_or_userid
            )
            if followers:
                profile_feed.append(followers)

        graphql_data = self.requests_parser.get_graphql_responses()
        self.requests_parser.parse_body(graphql_data)

        res_out = self.requests_parser.collect_posts()
        new_reactions = self.process_reactions(res_in=res_out)

        final_res = self.format_data(
            res_in=res_out,
            fb_username_or_userid=fb_username_or_userid,
            new_reactions=new_reactions,
        )

        return {
            "fb_username_or_userid": fb_username_or_userid,
            "profile": profile_feed,
            "data": final_res,
        }

    def close(self):
        self.page.close()


if __name__ == "__main__":
    facebook_user_id = "ryanscomputersbanani"
    days_limit = 30

    scraper = FacebookPlaywrightScraper()
    res = scraper.get_user_posts(
        fb_username_or_userid=facebook_user_id,
        days_limit=days_limit,
        display_progress=True,
    )
    print(f"Captured {len(res.get('data', []))} posts")
    scraper.close()
