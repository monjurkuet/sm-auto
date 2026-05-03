#!/usr/bin/env python3
"""
Persona Training Data Generator v1

Reconstructs conversations from Facebook group posts + comments,
extracts author personas (personality, communication style, expertise),
and generates multi-turn dialogue pairs with persona context for fine-tuning
agents that can impersonate different people.

Pipeline:
  1. Reconstruct conversations (post → comments → reply threads)
  2. Profile each author's persona via LLM analysis
  3. Generate dialogue pairs with persona system prompts
  4. Export to training-data/ with persona cards + dialogue examples

Design decisions:
  - Each persona gets a "persona card" — a structured profile covering
    communication style, expertise, language mix, personality traits
  - Dialogue pairs include the persona card as system prompt so the model
    learns to adopt that specific personality
  - Multi-turn conversations are reconstructed from post + comment threads
  - Single-author posts become monologue-style training examples
  - Quality scoring filters out low-substance exchanges
  - Dedup by author prevents one prolific poster from dominating
"""

import json
import os
import re
import subprocess
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

# ── Config ──────────────────────────────────────────────────────────────
SM_AUTO_DIR = Path("/root/codebase/sm-auto")
TRAINING_DATA_DIR = Path("/root/codebase/training-data")
PERSONA_DIR = TRAINING_DATA_DIR / "personas"
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://llm.datasolved.org/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "gemini-2.5-flash")
FALLBACK_MODEL = os.environ.get("FALLBACK_MODEL", "z-ai/glm-5.1")
MIN_POSTS_FOR_PERSONA = int(os.environ.get("MIN_POSTS_FOR_PERSONA", "2"))
MIN_DIALOGUE_SUBSTANCE = int(os.environ.get("MIN_DIALOGUE_SUBSTANCE", "50"))
MAX_AUTHORS_PER_RUN = int(os.environ.get("MAX_AUTHORS_PER_RUN", "10"))
MAX_DIALOGUES_PER_RUN = int(os.environ.get("MAX_DIALOGUES_PER_RUN", "50"))

STATE_FILE = SM_AUTO_DIR / "scripts" / ".persona_generator_state.json"


def _load_api_key() -> str:
    env_key = os.environ.get("LLM_API_KEY") or os.environ.get("OPENAI_API_KEY", "")
    if env_key:
        return env_key
    # Try sm-auto .env
    env_path = SM_AUTO_DIR / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("LLM_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    # Try Hermes config
    config_path = Path(os.path.expanduser("~/.hermes/config.yaml"))
    if config_path.exists():
        m = re.search(r"api_key:\s*(sk-\S+)", config_path.read_text())
        if m:
            return m.group(1)
    return ""


LLM_API_KEY = _load_api_key()


# ── Database ────────────────────────────────────────────────────────────
def _ensure_str(val) -> str:
    """Ensure a value is a string, handling bytes from psycopg."""
    if isinstance(val, bytes):
        return val.decode("utf-8", errors="replace")
    if val is None:
        return ""
    return str(val)


def get_db_connection():
    """Get PostgreSQL connection from sm-auto .env."""
    import psycopg
    env_path = SM_AUTO_DIR / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("DATABASE_URL="):
                db_url = line.split("=", 1)[1].strip().strip('"').strip("'")
                return psycopg.connect(db_url)
    raise RuntimeError("DATABASE_URL not found in sm-auto .env")


# ── Conversation Reconstruction ─────────────────────────────────────────
def fetch_conversations(conn) -> list[dict]:
    """Fetch posts with their comments, reconstructing conversation threads."""
    cur = conn.cursor()

    # Get posts with at least some engagement
    cur.execute("""
        SELECT p.post_id, p.group_id, p.author_id, p.author_name,
               p.text_content, p.reaction_count, p.comment_count,
               p.share_count, p.created_at, p.first_seen_at,
               g.name as group_name
        FROM scraper.facebook_group_posts p
        LEFT JOIN scraper.facebook_groups g ON p.group_id = g.group_id
        WHERE p.text_content IS NOT NULL AND p.text_content != ''
        ORDER BY p.comment_count DESC, p.reaction_count DESC
    """)
    posts = cur.fetchall()

    # Get all comments
    cur.execute("""
        SELECT c.comment_id, c.post_id, c.parent_comment_id,
               c.author_id, c.author_name, c.text_content,
               c.reaction_count, c.reply_count, c.created_at
        FROM scraper.facebook_group_post_comments c
        WHERE c.text_content IS NOT NULL AND c.text_content != ''
        ORDER BY c.post_id, c.created_at
    """)
    comments = cur.fetchall()

    # Build comment index
    comment_by_post = defaultdict(list)
    comment_by_id = {}
    for c in comments:
        cid, post_id, parent_id, author_id, author_name, text, reactions, replies, created = c
        comment_obj = {
            "comment_id": _ensure_str(cid),
            "post_id": _ensure_str(post_id),
            "parent_comment_id": _ensure_str(parent_id) if parent_id else None,
            "author_id": _ensure_str(author_id) if author_id else None,
            "author_name": _ensure_str(author_name) or "Anonymous",
            "text": _ensure_str(text),
            "reactions": int(reactions) if reactions else 0,
            "replies": int(replies) if replies else 0,
            "created_at": created.isoformat() if created else None,
        }
        comment_by_post[str(post_id)].append(comment_obj)
        comment_by_id[str(cid)] = comment_obj

    # Build conversations
    conversations = []
    for p in posts:
        post_id, group_id, author_id, author_name, text, reactions, comment_count, shares, created, first_seen, group_name = p
        if not text or not text.strip():
            continue

        post_obj = {
            "post_id": _ensure_str(post_id),
            "group_id": _ensure_str(group_id) if group_id else None,
            "group_name": _ensure_str(group_name) or "Unknown",
            "author_id": _ensure_str(author_id) if author_id else None,
            "author_name": _ensure_str(author_name) or "Anonymous",
            "text": _ensure_str(text).strip(),
            "reactions": int(reactions) if reactions else 0,
            "comment_count": int(comment_count) if comment_count else 0,
            "shares": int(shares) if shares else 0,
            "created_at": created.isoformat() if created else None,
        }

        # Build threaded comments
        post_comments = comment_by_post.get(str(post_id), [])
        threaded = _build_threads(post_comments, comment_by_id)

        conversations.append({
            "post": post_obj,
            "comments": threaded,
            "comment_count_actual": len(post_comments),
        })

    return conversations


def _build_threads(comments: list[dict], comment_by_id: dict) -> list[dict]:
    """Build nested reply threads from flat comment list."""
    by_parent = defaultdict(list)
    roots = []
    for c in comments:
        parent = c.get("parent_comment_id")
        if parent and parent in comment_by_id:
            by_parent[parent].append(c)
        else:
            roots.append(c)

    def add_replies(comment):
        replies = by_parent.get(comment["comment_id"], [])
        comment["replies"] = [add_replies(r) for r in replies]
        return comment

    return [add_replies(r) for r in roots]


# ── Author Analysis ─────────────────────────────────────────────────────
def analyze_authors(conversations: list[dict]) -> dict[str, dict]:
    """Aggregate per-author statistics from conversations."""
    authors = defaultdict(lambda: {
        "posts": [],
        "comments": [],
        "groups": set(),
        "total_reactions": 0,
        "languages": Counter(),
        "topics": Counter(),
    })

    for conv in conversations:
        post = conv["post"]
        author = post["author_name"]
        authors[author]["posts"].append(post)
        authors[author]["groups"].add(post.get("group_name", "Unknown"))
        authors[author]["total_reactions"] += post.get("reactions", 0)

        for comment in conv["comments"]:
            ca = comment["author_name"]
            authors[ca]["comments"].append(comment)
            authors[ca]["groups"].add(post.get("group_name", "Unknown"))

    # Convert sets to lists for JSON, ensure strings
    for a in authors.values():
        a["groups"] = [str(g) if g else "Unknown" for g in a["groups"]]

    return dict(authors)


def get_top_authors(authors: dict, min_posts: int = MIN_POSTS_FOR_PERSONA) -> list[tuple[str, dict]]:
    """Get authors with enough content for persona extraction."""
    qualified = []
    for name, data in authors.items():
        total_content = len(data["posts"]) + len(data["comments"])
        total_chars = sum(len(p.get("text", "")) for p in data["posts"]) + \
                      sum(len(c.get("text", "")) for c in data["comments"])
        if total_content >= min_posts and total_chars > 200 and name and name != "Anonymous":
            qualified.append((name, data))
    # Sort by total engagement
    qualified.sort(key=lambda x: x[1]["total_reactions"] + len(x[1]["posts"]) * 5 + len(x[1]["comments"]), reverse=True)
    return qualified


# ── LLM Analysis ────────────────────────────────────────────────────────
def call_llm(system_prompt: str, user_prompt: str, model: str = None, retries: int = 2) -> tuple[str, str]:
    """Call LLM endpoint with retry."""
    import requests
    use_model = model or LLM_MODEL
    url = f"{LLM_BASE_URL}/chat/completions"
    is_gemini = "gemini" in use_model.lower()
    timeout = 180 if is_gemini else 120

    payload = {
        "model": use_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.3,
        "max_tokens": 8192,
    }
    headers = {"Content-Type": "application/json"}
    if LLM_API_KEY:
        headers["Authorization"] = f"Bearer {LLM_API_KEY}"

    for attempt in range(retries + 1):
        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=timeout)
            resp.raise_for_status()
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            if content and content.strip():
                return content.strip(), use_model
            return "", use_model
        except Exception as e:
            if attempt < retries:
                time.sleep(3 * (attempt + 1))
                continue
            # Try fallback model
            if use_model != FALLBACK_MODEL:
                print(f"  {use_model} failed, trying {FALLBACK_MODEL}...", file=sys.stderr)
                payload["model"] = FALLBACK_MODEL
                try:
                    resp = requests.post(url, json=payload, headers=headers, timeout=120)
                    resp.raise_for_status()
                    data = resp.json()
                    content = data["choices"][0]["message"]["content"]
                    if content and content.strip():
                        return content.strip(), FALLBACK_MODEL
                except:
                    pass
            print(f"  LLM call failed: {e}", file=sys.stderr)
            return "", use_model
    return "", use_model


def extract_persona_card(author_name: str, author_data: dict) -> dict:
    """Use LLM to extract a persona card from an author's writing samples."""
    # Build writing samples (max ~12K chars)
    samples = []
    total_chars = 0
    max_chars = 12000

    for post in author_data["posts"]:
        text = post.get("text", "")[:2000]
        if text.strip():
            samples.append(f"[POST in {post.get('group_name', 'unknown')}]: {text}")
            total_chars += len(text)
            if total_chars > max_chars:
                break

    for comment in author_data["comments"]:
        text = comment.get("text", "")[:1000]
        if text.strip():
            samples.append(f"[COMMENT]: {text}")
            total_chars += len(text)
            if total_chars > max_chars:
                break

    if not samples:
        return _empty_persona(author_name)

    writing_samples = "\n\n".join(samples)

    system_prompt = """You are a persona analysis engine. Given samples of someone's writing from Facebook groups, create a detailed persona card that captures HOW they communicate — their personality, style, expertise, and language patterns.

Output a JSON object with these keys:

1. "name": the person's name/display name
2. "personality_traits": array of 3-5 personality trait strings (e.g., "cautious advisor", "enthusiastic promoter", "skeptical critic", "helpful mentor")
3. "communication_style": object with:
   - "formality": "casual" | "semi-formal" | "formal"
   - "directness": "direct" | "indirect" | "mixed"
   - "tone": dominant emotional tone (e.g., "friendly", "professional", "urgent", "persuasive", "cautionary")
   - "humor": "none" | "rare" | "occasional" | "frequent"
   - "emoji_usage": "none" | "minimal" | "moderate" | "heavy"
4. "language_patterns": object with:
   - "primary_language": "bn" | "en" | "mixed"
   - "code_switching": boolean (do they mix Bangla and English?)
   - "typical_greetings": array of greeting patterns they use (e.g., "আসসালামুয়ালাইকুম", "Hi", "ভাই")
   - "signature_phrases": array of phrases they commonly use
   - "sentence_length": "short" | "medium" | "long" | "varied"
5. "expertise_areas": array of topics they show knowledge in (e.g., "forex trading", "iPhone resale", "business investment")
6. "role_patterns": array of roles they typically play in conversations (e.g., "seller", "advisor", "skeptic", "questioner", "promoter")
7. "system_prompt": a 2-4 sentence system prompt that captures this persona's voice — written in second person as instructions to an AI adopting this personality. Example: "You are [name], a [personality] who communicates in [style]. You speak in [language pattern]. Your expertise is in [areas]. When discussing [topics], you tend to [behavior]."
8. "sample_responses": array of 3 objects, each with:
   - "context": a common question/situation this person would encounter
   - "response": how THIS person would respond in their own voice and style

Output ONLY valid JSON, no markdown fences."""

    user_prompt = f"Author: {author_name}\nGroups active in: {', '.join(author_data.get('groups', ['unknown']))}\nTotal posts: {len(author_data['posts'])}\nTotal comments: {len(author_data['comments'])}\nTotal reactions received: {author_data.get('total_reactions', 0)}\n\n--- WRITING SAMPLES ---\n{writing_samples}"

    raw, model_used = call_llm(system_prompt, user_prompt)

    if not raw.strip():
        return _empty_persona(author_name)

    # Parse JSON
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)

    try:
        persona = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            try:
                persona = json.loads(match.group(0))
            except json.JSONDecodeError:
                return _empty_persona(author_name)
        else:
            return _empty_persona(author_name)

    persona["name"] = author_name
    persona["_model_used"] = model_used
    persona["_timestamp"] = datetime.now(timezone.utc).isoformat()
    return persona


def _empty_persona(name: str) -> dict:
    return {
        "name": name,
        "personality_traits": [],
        "communication_style": {"formality": "unknown", "directness": "unknown", "tone": "unknown", "humor": "unknown", "emoji_usage": "unknown"},
        "language_patterns": {"primary_language": "unknown", "code_switching": False, "typical_greetings": [], "signature_phrases": [], "sentence_length": "unknown"},
        "expertise_areas": [],
        "role_patterns": [],
        "system_prompt": f"You are {name}.",
        "sample_responses": [],
    }


# ── Dialogue Pair Generation ────────────────────────────────────────────
def generate_dialogue_pairs(conversations: list[dict], persona_cards: dict[str, dict], authors: dict) -> list[dict]:
    """Generate multi-turn dialogue pairs from conversations with persona context.
    
    For authors with persona cards, use the full card system prompt.
    For authors without cards, generate a simple system prompt from their writing patterns.
    """
    dialogues = []

    for conv in conversations:
        post = conv["post"]
        post_author = post["author_name"]
        post_text = post.get("text", "").strip()

        if not post_text or len(post_text) < MIN_DIALOGUE_SUBSTANCE:
            continue

        # 1. Post as a "user question" → best comment as "assistant response"
        # Find the best comment (longest, most substantial)
        best_comments = []
        for comment in conv["comments"]:
            comment_text = comment.get("text", "").strip()
            comment_author = comment.get("author_name", "Anonymous")
            if not comment_text or len(comment_text) < MIN_DIALOGUE_SUBSTANCE:
                continue
            if comment_author == post_author:
                continue  # Skip self-replies for this pairing
            best_comments.append((comment, comment_text, comment_author))

        # Sort by length (most substantial response first)
        best_comments.sort(key=lambda x: len(x[1]), reverse=True)

        for comment, comment_text, comment_author in best_comments[:3]:
            # Get system prompt for the responder
            system_prompt = _get_system_prompt(comment_author, persona_cards, authors)
            
            dialogues.append({
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"In the Facebook group '{post.get('group_name', '')}', someone posted:\n\n{_clean_text(post_text)[:2000]}"},
                    {"role": "assistant", "content": _clean_text(comment_text)[:4000]},
                ],
                "metadata": {
                    "source": "facebook_group_persona",
                    "persona": comment_author,
                    "group": _ensure_str(post.get("group_name", "")),
                    "conversation_type": _classify_conversation(comment_text),
                    "language": _detect_language(comment_text),
                    "perspective": "responder",
                    "is_organic": True,
                    "collected_at": datetime.now(timezone.utc).isoformat()[:10],
                },
            })

        # 2. Post author perspective — "write a post like this author"
        if post_author and len(post_text) >= 100:
            system_prompt = _get_system_prompt(post_author, persona_cards, authors)
            dialogues.append({
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Write a post for the Facebook group '{post.get('group_name', '')}' about {_infer_topic(post_text)}"},
                    {"role": "assistant", "content": _clean_text(post_text)[:4000]},
                ],
                "metadata": {
                    "source": "facebook_group_persona",
                    "persona": post_author,
                    "group": _ensure_str(post.get("group_name", "")),
                    "conversation_type": _classify_conversation(post_text),
                    "language": _detect_language(post_text),
                    "perspective": "author",
                    "is_organic": True,
                    "collected_at": datetime.now(timezone.utc).isoformat()[:10],
                },
            })

        # 3. Reply thread — multi-turn conversation
        if len(conv["comments"]) >= 2:
            thread_turns = []
            thread_turns.append({"role": "user", "content": _clean_text(post_text)[:2000]})

            for comment in conv["comments"][:8]:
                ct = comment.get("text", "").strip()
                if not ct or len(ct) < 20:
                    continue
                # Alternate roles to create a conversation flow
                role = "assistant" if len(thread_turns) % 2 == 1 else "user"
                thread_turns.append({"role": role, "content": _clean_text(ct)[:2000]})

                # Add replies
                for reply in comment.get("replies", [])[:2]:
                    rt = reply.get("text", "").strip()
                    if rt and len(rt) >= 20:
                        role = "user" if role == "assistant" else "assistant"
                        thread_turns.append({"role": role, "content": _clean_text(rt)[:1500]})

            if len(thread_turns) >= 3:
                # Use the post author's system prompt if available
                system_prompt = _get_system_prompt(post_author, persona_cards, authors)
                dialogues.append({
                    "messages": [
                        {"role": "system", "content": system_prompt},
                    ] + thread_turns,
                    "metadata": {
                        "source": "facebook_group_persona",
                        "persona": post_author,
                        "group": _ensure_str(post.get("group_name", "")),
                        "conversation_type": "thread",
                        "language": _detect_language(post_text),
                        "perspective": "thread",
                        "is_organic": True,
                        "collected_at": datetime.now(timezone.utc).isoformat()[:10],
                    },
                })

    return dialogues


def _get_system_prompt(author_name: str, persona_cards: dict, authors: dict) -> str:
    """Get system prompt for an author — from persona card or generated from patterns."""
    if author_name in persona_cards:
        return persona_cards[author_name].get("system_prompt", f"You are {author_name}.")
    
    # Generate a simple system prompt from author's writing patterns
    author_data = authors.get(author_name, {})
    lang = _detect_language(
        " ".join(p.get("text", "")[:500] for p in author_data.get("posts", [])[:3]) +
        " ".join(c.get("text", "")[:300] for c in author_data.get("comments", [])[:3])
    )
    groups = author_data.get("groups", ["unknown"])
    groups_str = ", ".join(str(g) for g in groups[:3])
    
    if lang == "bn":
        return f"You are {author_name}, a member of Facebook groups like {groups_str}. You communicate primarily in Bangla. Respond naturally as this person would."
    elif lang == "mixed":
        return f"You are {author_name}, a member of Facebook groups like {groups_str}. You mix Bangla and English naturally. Respond in your own voice and style."
    else:
        return f"You are {author_name}, a member of Facebook groups like {groups_str}. Respond naturally as this person would."


def _infer_topic(text: str) -> str:
    """Infer the topic of a post for the user prompt."""
    text_lower = text.lower()
    topics = []
    if any(w in text_lower for w in ["iphone", "ipad", "macbook", "laptop", "phone", "মোবাইল"]):
        topics.append("electronics/phones")
    if any(w in text_lower for w in ["invest", "ফরেক্স", "forex", "crypto", "ক্রিপ্টো", "বিন্যাস", "profit", "লাভ"]):
        topics.append("investing/trading")
    if any(w in text_lower for w in ["business", "ব্যবসা", "startup", "company"]):
        topics.append("business")
    if any(w in text_lower for w in ["price", "দাম", "টাকা", "buy", "sell", "কিনতে"]):
        topics.append("marketplace")
    return ", ".join(topics) if topics else "a topic relevant to this group"


def _create_context_prompt(conv: dict, role: str) -> str:
    """Create a context prompt that sets up the conversation scenario."""
    post = conv["post"]
    group = post.get("group_name", "")
    n_comments = conv.get("comment_count_actual", 0)

    if role == "stranger":
        return f"You're in the Facebook group '{group}'. Someone asks about a topic you're interested in. Share your thoughts naturally, as you would in this group."
    return f"Respond in the Facebook group '{group}' in your own style."


def _clean_text(text: str) -> str:
    """Clean up text for training data."""
    # Remove multiple consecutive newlines
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Remove WhatsApp-style formatting artifacts
    text = re.sub(r"\+\s*\n\s*\+\s*", " ", text)
    # Strip leading/trailing whitespace
    text = text.strip()
    return text


def _classify_conversation(text: str) -> str:
    """Heuristic conversation type classification."""
    text_lower = text.lower()
    if any(w in text_lower for w in ["?", "কিভাবে", "কি করে", "how to", "how do", "why"]):
        return "question"
    if any(w in text_lower for w in ["buy", "sell", "price", "দাম", "টাকা", "inbox", "whatsapp"]):
        return "marketplace"
    if any(w in text_lower for w in ["invest", "profit", "লাভ", "risk", "ঝুঁকি", "return"]):
        return "investment"
    if any(w in text_lower for w in ["guarantee", "guaranteed", "100%", "গ্যারান্টি"]):
        return "promotion"
    if len(text) > 500:
        return "discussion"
    return "general"


def _detect_language(text: str) -> str:
    """Simple language detection based on Unicode ranges."""
    bangla_chars = sum(1 for c in text if '\u0980' <= c <= '\u09FF')
    latin_chars = sum(1 for c in text if c.isascii() and c.isalpha())
    total = bangla_chars + latin_chars
    if total == 0:
        return "unknown"
    if bangla_chars / total > 0.7:
        return "bn"
    if latin_chars / total > 0.7:
        return "en"
    return "mixed"


# ── State Management ────────────────────────────────────────────────────
def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except json.JSONDecodeError:
            pass
    return {"last_run": None, "profiled_authors": {}, "version": "v1"}


def save_state(state: dict):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2))


# ── Export ──────────────────────────────────────────────────────────────
def export_persona_cards(persona_cards: dict[str, dict], timestamp: str):
    """Export persona cards as individual JSON files + combined index."""
    today = timestamp[:10]
    cards_dir = PERSONA_DIR / "cards" / today
    cards_dir.mkdir(parents=True, exist_ok=True)

    index = []
    for name, card in persona_cards.items():
        # Write individual card
        safe_name = re.sub(r"[^\w\-]", "_", name)[:64]
        card_path = cards_dir / f"{safe_name}.json"
        card_path.write_text(json.dumps(card, indent=2, ensure_ascii=False))

        index.append({
            "name": name,
            "card_file": str(card_path.relative_to(PERSONA_DIR)),
            "personality_traits": card.get("personality_traits", []),
            "expertise_areas": card.get("expertise_areas", []),
            "primary_language": card.get("language_patterns", {}).get("primary_language", "unknown"),
            "communication_style": card.get("communication_style", {}).get("tone", "unknown"),
        })

    # Write combined index
    index_path = PERSONA_DIR / "index.json"
    existing_index = []
    if index_path.exists():
        try:
            existing_index = json.loads(index_path.read_text())
        except:
            pass

    # Merge — update existing, add new
    by_name = {e["name"]: e for e in existing_index}
    for entry in index:
        by_name[entry["name"]] = entry

    index_path.write_text(json.dumps(list(by_name.values()), indent=2, ensure_ascii=False))

    # Write all-time combined cards
    all_cards_path = PERSONA_DIR / "all_cards.jsonl"
    existing_cards = {}
    if all_cards_path.exists():
        for line in all_cards_path.read_text().splitlines():
            try:
                c = json.loads(line)
                existing_cards[c.get("name", "")] = c
            except:
                pass
    for name, card in persona_cards.items():
        existing_cards[name] = card
    all_cards_path.write_text("\n".join(json.dumps(c, ensure_ascii=False) for c in existing_cards.values()) + "\n")

    print(f"  Exported {len(persona_cards)} persona cards → {cards_dir}")


def export_dialogue_pairs(dialogues: list[dict], timestamp: str):
    """Export dialogue pairs to training-data/personas/dialogues/."""
    today = timestamp[:10]
    dialogues_dir = PERSONA_DIR / "dialogues" / today
    dialogues_dir.mkdir(parents=True, exist_ok=True)

    # Write raw dialogue pairs
    raw_path = dialogues_dir / "dialogues.jsonl"
    with open(raw_path, "a") as f:
        for d in dialogues:
            f.write(json.dumps(d, ensure_ascii=False) + "\n")

    # Curate by persona
    by_persona = defaultdict(list)
    for d in dialogues:
        persona = d.get("metadata", {}).get("persona", "unknown")
        by_persona[persona].append(d)

    curated_dir = dialogues_dir / "by_persona"
    curated_dir.mkdir(parents=True, exist_ok=True)
    for persona, examples in by_persona.items():
        safe_name = re.sub(r"[^\w\-]", "_", persona)[:64]
        persona_path = curated_dir / f"{safe_name}.jsonl"
        with open(persona_path, "w") as f:
            for ex in examples:
                f.write(json.dumps(ex, ensure_ascii=False) + "\n")

    # Curate by conversation type
    by_type = defaultdict(list)
    for d in dialogues:
        ctype = d.get("metadata", {}).get("conversation_type", "general")
        by_type[ctype].append(d)

    type_dir = dialogues_dir / "by_type"
    type_dir.mkdir(parents=True, exist_ok=True)
    for ctype, examples in by_type.items():
        type_path = type_dir / f"{ctype}.jsonl"
        with open(type_path, "w") as f:
            for ex in examples:
                f.write(json.dumps(ex, ensure_ascii=False) + "\n")

    # Update all-time cumulative files
    all_dialogues_path = PERSONA_DIR / "all_dialogues.jsonl"
    with open(all_dialogues_path, "a") as f:
        for d in dialogues:
            f.write(json.dumps(d, ensure_ascii=False) + "\n")

    print(f"  Exported {len(dialogues)} dialogue pairs → {dialogues_dir}")
    print(f"  Personas: {list(by_persona.keys())}")
    print(f"  Types: {dict(Counter(by_type.keys()))}")


# ── Git Sync ────────────────────────────────────────────────────────────
def git_sync(repo_path: Path, label: str) -> bool:
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    try:
        subprocess.run(["git", "pull", "--rebase", "--autostash", "origin", "main"],
                       cwd=repo_path, capture_output=True, timeout=30)
        result = subprocess.run(["git", "status", "--porcelain"],
                               cwd=repo_path, capture_output=True, text=True, timeout=10)
        if not result.stdout.strip():
            print(f"  {label}: No changes to commit")
            return True
        subprocess.run(["git", "add", "."], cwd=repo_path, capture_output=True, timeout=10)
        subprocess.run(["git", "commit", "-m", f"Persona training data auto-sync ({label}) - {timestamp}"],
                       cwd=repo_path, capture_output=True, text=True, timeout=10)
        subprocess.run(["git", "push", "origin", "main"],
                       cwd=repo_path, capture_output=True, text=True, timeout=30)
        print(f"  {label}: Synced ✓")
        return True
    except Exception as e:
        print(f"  {label}: Git error: {e}", file=sys.stderr)
        return False


# ── Main Pipeline ───────────────────────────────────────────────────────
def main():
    print("=== Persona Training Data Generator v1 ===")
    print(f"Started: {datetime.now(timezone.utc).isoformat()}")

    state = load_state()
    timestamp = datetime.now(timezone.utc).isoformat()

    # Step 1: Fetch conversations from DB
    print("\n📊 Fetching conversations from database...")
    conn = get_db_connection()
    conversations = fetch_conversations(conn)
    conn.close()
    print(f"  Found {len(conversations)} conversations")

    if not conversations:
        print("No conversations found.")
        return

    # Step 2: Analyze authors
    print("\n👤 Analyzing authors...")
    authors = analyze_authors(conversations)
    top_authors = get_top_authors(authors)
    print(f"  {len(authors)} unique authors, {len(top_authors)} with enough content for persona extraction")

    if not top_authors:
        print("Not enough author data for persona extraction.")
        return

    # Step 3: Extract persona cards (skip already profiled authors unless stale)
    print("\n🎭 Extracting persona cards...")
    persona_cards = {}
    newly_profiled = 0
    skipped = 0

    for author_name, author_data in top_authors[:MAX_AUTHORS_PER_RUN]:
        last_profiled = state.get("profiled_authors", {}).get(author_name, "")
        # Re-profile if never done or data is >7 days old
        needs_profile = not last_profiled or (timestamp[:10] > last_profiled[:10] and
            (datetime.fromisoformat(timestamp) - datetime.fromisoformat(last_profiled)).days > 7)

        if not needs_profile:
            # Load existing card
            all_cards_path = PERSONA_DIR / "all_cards.jsonl"
            if all_cards_path.exists():
                for line in all_cards_path.read_text().splitlines():
                    try:
                        c = json.loads(line)
                        if c.get("name") == author_name:
                            persona_cards[author_name] = c
                            break
                    except:
                        pass
            skipped += 1
            continue

        print(f"  Profiling {author_name} ({len(author_data['posts'])} posts, {len(author_data['comments'])} comments)...")
        card = extract_persona_card(author_name, author_data)
        if card.get("system_prompt") and card["system_prompt"] != f"You are {author_name}.":
            persona_cards[author_name] = card
            state.setdefault("profiled_authors", {})[author_name] = timestamp
            newly_profiled += 1
            style = card.get("communication_style", {})
            lang = card.get("language_patterns", {})
            print(f"    ✓ {card.get('personality_traits', [])}, {style.get('tone', '?')} tone, {lang.get('primary_language', '?')}")
        else:
            print(f"    - Insufficient data for persona")

    print(f"  Profiled: {newly_profiled}, Loaded existing: {skipped}")

    # Step 4: Generate dialogue pairs
    print("\n💬 Generating dialogue pairs...")
    dialogues = generate_dialogue_pairs(conversations, persona_cards, authors)
    print(f"  Generated {len(dialogues)} dialogue pairs with persona context")

    # Step 5: Export
    print("\n📁 Exporting...")
    export_persona_cards(persona_cards, timestamp)
    export_dialogue_pairs(dialogues, timestamp)

    # Step 6: Git sync
    print("\n🔄 Syncing to GitHub...")
    git_sync(TRAINING_DATA_DIR, "training-data")

    # Save state
    state["last_run"] = timestamp
    save_state(state)

    # Summary
    print(f"\n=== Done ===")
    print(f"Conversations processed: {len(conversations)}")
    print(f"Persona cards: {len(persona_cards)} ({newly_profiled} new)")
    print(f"Dialogue pairs: {len(dialogues)}")


if __name__ == "__main__":
    main()
