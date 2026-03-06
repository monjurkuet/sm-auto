# -*- coding: utf-8 -*-
import json
import time
import http.client
import requests
from urllib.parse import parse_qs, unquote
from datetime import datetime

import pandas as pd
from bs4 import BeautifulSoup


def get_debugger_url(host="127.0.0.1", port=9222):
    conn = http.client.HTTPConnection(host, port)
    conn.request("GET", "/json/version")
    response = conn.getresponse()
    data = json.loads(response.read().decode())
    return data["webSocketDebuggerUrl"]


def get_browser_cookies(ws_url=None):
    """Extract cookies from existing browser session"""
    if ws_url is None:
        ws_url = get_debugger_url()

    # Use CDP to get cookies
    import urllib.request

    # Get the CDP session info
    conn = http.client.HTTPConnection("127.0.0.1", 9222)
    conn.request("GET", "/json/list")
    response = conn.getresponse()
    pages = json.loads(response.read().decode())

    # Get cookies from first page (Facebook page)
    for page in pages:
        if "facebook.com" in page.get("url", ""):
            # Use DevTools Protocol to get cookies
            target_id = page["id"]
            break
    else:
        # Use the first available page
        target_id = pages[0]["id"] if pages else None

    # Get cookies via CDP
    ws_url_base = ws_url.replace("ws://", "http://").replace("/devtools/", "/json/")

    return {}


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
    timestamp = min(tmp_creation_array)
    current_date_time = datetime.now()
    date_time_obj = datetime.fromtimestamp(timestamp)
    difference = current_date_time - date_time_obj
    return difference.days


def is_date_exceed_limit(max_days_ago, days_limit=61):
    return max_days_ago > days_limit


def get_before_time(time_zone="Asia/Taipei"):
    import pytz

    location_tz = pytz.timezone(time_zone)
    current_time = datetime.now(location_tz)
    timestamp = str(int(current_time.timestamp()))
    return timestamp


def get_payload(doc_id_in: str, id_in: str, before_time: str = None):
    variables_dict = {
        "afterTime": None,
        "beforeTime": before_time,
        "count": 3,
        "cursor": None,
        "feedLocation": "TIMELINE",
        "feedbackSource": 0,
        "focusCommentID": None,
        "memorializedSplitTimeFilter": None,
        "omitPinnedPost": True,
        "postedBy": {"group": "OWNER"},
        "privacy": {"exclusivity": "INCLUSIVE", "filter": "ALL"},
        "privacySelectorRenderLocation": "COMET_STREAM",
        "renderLocation": "timeline",
        "scale": 3,
        "stream_count": 1,
        "taggedInOnly": False,
        "useDefaultActor": False,
        "id": id_in,
        "__relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider": False,
        "__relay_internal__pv__IsWorkUserrelayprovider": False,
        "__relay_internal__pv__IsMergQAPollsrelayprovider": False,
        "__relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider": False,
        "__relay_internal__pv__CometUFIShareActionMigrationrelayprovider": False,
        "__relay_internal__pv__StoriesArmadilloReplyEnabledrelayprovider": False,
        "__relay_internal__pv__StoriesTrayShouldShowMetadatarelayprovider": False,
        "__relay_internal__pv__StoriesRingrelayprovider": False,
        "__relay_internal__pv__EventCometCardImage_prefetchEventImagerelayprovider": False,
    }

    payload_out = {"variables": json.dumps(variables_dict), "doc_id": doc_id_in}
    return payload_out


def get_next_payload(doc_id_in: str, id_in: str, before_time: str, cursor_in: str):
    variables_dict = {
        "afterTime": None,
        "beforeTime": before_time,
        "count": 3,
        "cursor": cursor_in,
        "feedLocation": "TIMELINE",
        "feedbackSource": 0,
        "focusCommentID": None,
        "memorializedSplitTimeFilter": None,
        "omitPinnedPost": True,
        "postedBy": {"group": "OWNER"},
        "privacy": {"exclusivity": "INCLUSIVE", "filter": "ALL"},
        "privacySelectorRenderLocation": "COMET_STREAM",
        "renderLocation": "timeline",
        "scale": 3,
        "stream_count": 1,
        "taggedInOnly": False,
        "useDefaultActor": False,
        "id": id_in,
        "__relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider": False,
        "__relay_internal__pv__IsWorkUserrelayprovider": False,
        "__relay_internal__pv__IsMergQAPollsrelayprovider": False,
        "__relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider": False,
        "__relay_internal__pv__CometUFIShareActionMigrationrelayprovider": False,
        "__relay_internal__pv__StoriesArmadilloReplyEnabledrelayprovider": False,
        "__relay_internal__pv__StoriesTrayShouldShowMetadatarelayprovider": False,
        "__relay_internal__pv__StoriesRingrelayprovider": False,
        "__relay_internal__pv__EventCometCardImage_prefetchEventImagerelayprovider": False,
    }
    payload_out = {"variables": json.dumps(variables_dict), "doc_id": doc_id_in}
    return payload_out


def get_next_cursor(body_content_in):
    for i in range(len(body_content_in) - 1, -1, -1):
        try:
            json_tail = json.loads(body_content_in[i])
            nex_cursor = json_tail.get("data").get("page_info").get("end_cursor")
            return nex_cursor
        except AttributeError:
            pass
    return None


def get_next_page_status(body_content):
    for each_body in body_content:
        try:
            tmp_json = json.loads(each_body)
            next_page_status = (
                tmp_json.get("data").get("page_info").get("has_next_page")
            )
            return next_page_status
        except Exception as e:
            pass
    return True


def compare_timestamp(timestamp: int, days_limit: int, display_progress: bool) -> bool:
    timestamp_date = datetime.utcfromtimestamp(timestamp).date()
    current_date = datetime.utcnow().date()
    past_date = current_date - __import__("datetime").timedelta(days=days_limit)
    if display_progress:
        days_remaining = (timestamp_date - past_date).days
        if days_remaining > 0:
            print(f"{days_remaining} more days of posts to collect.")
        else:
            print("Target days reached or exceeded.")
    return timestamp_date < past_date


class FacebookDirectAPIScraper:
    """Scraper that uses browser cookies to make direct GraphQL API calls"""

    def __init__(self, ws_url=None):
        if ws_url is None:
            ws_url = get_debugger_url()

        self.ws_url = ws_url
        self.session = requests.Session()
        self._setup_session()

    def _setup_session(self):
        """Get cookies from existing browser and set up session"""
        import urllib.request
        import urllib.parse

        # Get CDP endpoint
        conn = http.client.HTTPConnection("127.0.0.1", 9222)
        conn.request("GET", "/json/list")
        response = conn.getresponse()
        pages = json.loads(response.read().decode())

        # Find Facebook page
        fb_page = None
        for page in pages:
            if "facebook.com" in page.get("url", ""):
                fb_page = page
                break

        if not fb_page:
            print("No Facebook page found in browser. Please open Facebook first.")

        # Use playwright to get cookies
        from playwright.sync_api import sync_playwright

        pw = sync_playwright().start()
        browser = pw.chromium.connect_over_cdp(self.ws_url)

        # Get cookies from the browser
        contexts = browser.contexts
        if contexts:
            cookies = contexts[0].cookies()
            print(f"Got {len(cookies)} cookies from browser")

            # Print first few cookies
            for c in cookies[:5]:
                print(f"  {c['name']}: {c['value'][:20]}...")

            for cookie in cookies:
                self.session.cookies.set(
                    cookie["name"], cookie["value"], domain=cookie["domain"]
                )

        browser.close()
        pw.stop()

        # Debug: print session cookies
        print(f"Session has {len(self.session.cookies)} cookies")

        # Set common headers
        self.session.headers.update(
            {
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.9",
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": "https://www.facebook.com",
                "Referer": "https://www.facebook.com/",
            }
        )

    def _clean_res(self):
        self.res_new = []
        self.feedback_list = []
        self.context_list = []
        self.creation_list = []
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
                if "data" in json_data and "node" in json_data["data"]:
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

    def process_reactions(self, reactions_in):
        reaction_hash = {}
        for each_react in reactions_in:
            reaction_hash[each_react["node"]["localized_name"]] = each_react[
                "reaction_count"
            ]
        return reaction_hash

    def format_data(self, res_in, fb_username_or_userid, new_reactions):
        final_res = pd.json_normalize(res_in)
        final_res["context"] = self.context_list
        final_res["username_or_userid"] = fb_username_or_userid
        final_res["owing_profile"] = self.owning_profile
        final_res["sub_reactions"] = new_reactions
        final_res["post_url"] = "https://www.facebook.com/" + final_res[
            "post_id"
        ].astype(str)
        final_res["time"] = self.creation_list
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

    def get_user_posts(
        self,
        fb_username_or_userid: str,
        days_limit: int = 61,
        display_progress: bool = True,
    ) -> dict:
        url = "https://www.facebook.com/api/graphql/"
        before_time = get_before_time()
        loop_limit = 5000
        is_first_time = True

        self._clean_res()

        # First, we need to get the doc_id and user_id
        # For now, use a common doc_id for user timeline
        doc_id = "7012574398465656"  # Common timeline doc_id
        user_id = fb_username_or_userid

        print(f"Fetching posts from user: {fb_username_or_userid}")

        for i in range(loop_limit):
            if is_first_time:
                payload_in = get_payload(
                    doc_id_in=doc_id, id_in=user_id, before_time=before_time
                )
                is_first_time = False
            else:
                next_cursor = get_next_cursor(body_content_in=body_content)
                if not next_cursor:
                    print("No more cursor available")
                    break
                payload_in = get_next_payload(
                    doc_id_in=doc_id,
                    id_in=user_id,
                    before_time=before_time,
                    cursor_in=next_cursor,
                )

            try:
                response = self.session.post(url=url, data=payload_in)
                body = response.content.decode("utf-8")

                if not body.strip():
                    print(f"Empty response at iteration {i}")
                    break

                # Debug: print response status and first 500 chars
                if i < 2:
                    print(f"Response status: {response.status_code}")
                    print(f"Response body (first 500): {body[:500]}")

                body_content = body.split("\n")
                self.parse_body(body_content)
            except Exception as e:
                print(f"Request error: {e}")
                break

            next_page_status = get_next_page_status(body_content=body_content)

            if self.creation_list:
                before_time = str(self.creation_list[-1])

            if not next_page_status:
                print("There are no more posts.")
                break

            if compare_timestamp(
                timestamp=int(before_time),
                days_limit=days_limit,
                display_progress=display_progress,
            ):
                print(
                    f"The scraper has successfully retrieved posts from the past {str(days_limit)} days."
                )
                break

            if i % 5 == 0:
                print(f"Fetched {i} pages...")

        res_out = self.collect_posts()
        new_reactions = self.process_reactions(
            [r["top_reactions"] for r in res_out if "top_reactions" in r]
        )

        final_res = self.format_data(
            res_in=res_out,
            fb_username_or_userid=fb_username_or_userid,
            new_reactions=new_reactions,
        )

        return {
            "fb_username_or_userid": fb_username_or_userid,
            "data": final_res,
        }


if __name__ == "__main__":
    scraper = FacebookDirectAPIScraper()
    result = scraper.get_user_posts("ryanscomputersbanani", days_limit=30)
    print(f"Found {len(result['data'])} posts")
