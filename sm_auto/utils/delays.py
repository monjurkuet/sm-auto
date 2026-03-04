"""
Human-like delay helpers for SM-Auto framework.

Provides variable delay functions to simulate realistic human behavior
during automation, helping to avoid detection by anti-bot systems.
"""

import asyncio
import random
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from nodriver.core.tab import Tab
    from nodriver.core.element import Element


async def micro_delay() -> None:
    """
    Very short delay between keystrokes or small actions.

    Range: 80-200ms
    Use: Between individual keystrokes, after mouse clicks settle
    """
    from sm_auto.utils.config import get_settings

    settings = get_settings()
    delay = random.uniform(
        settings.delays.micro_delay_min, settings.delays.micro_delay_max
    )
    await asyncio.sleep(delay)


async def action_delay() -> None:
    """
    Short delay between UI actions in the same task.

    Range: 0.5-2.5s
    Use: Between search and scroll, between clicks on related elements
    """
    from sm_auto.utils.config import get_settings

    settings = get_settings()
    delay = random.uniform(
        settings.delays.action_delay_min, settings.delays.action_delay_max
    )
    await asyncio.sleep(delay)


async def task_delay() -> None:
    """
    Medium delay between distinct tasks.

    Range: 2-8s
    Use: After finishing a search before starting to scrape, between major operations
    """
    from sm_auto.utils.config import get_settings

    settings = get_settings()
    delay = random.uniform(
        settings.delays.task_delay_min, settings.delays.task_delay_max
    )
    await asyncio.sleep(delay)


async def page_delay() -> None:
    """
    Delay after page navigation to allow content to settle.

    Range: 1.5-4s
    Use: After page.load(), after clicking navigation links
    """
    from sm_auto.utils.config import get_settings

    settings = get_settings()
    delay = random.uniform(
        settings.delays.page_delay_min, settings.delays.page_delay_max
    )
    await asyncio.sleep(delay)


async def reading_pause() -> None:
    """
    Simulates reading content on the page.

    Range: 3-12s
    Use: Randomly during scrolling sessions to simulate reading listings
    """
    from sm_auto.utils.config import get_settings

    settings = get_settings()
    delay = random.uniform(
        settings.delays.reading_pause_min, settings.delays.reading_pause_max
    )
    await asyncio.sleep(delay)


async def session_gap() -> None:
    """
    Long delay between separate automation sessions.

    Range: 5-20 minutes
    Use: Between complete automation runs for the same account
    """
    delay = random.uniform(300, 1200)  # 5-20 minutes
    await asyncio.sleep(delay)


async def human_type(
    element: "Element",
    text: str,
    wpm: Optional[int] = None,
    clear_first: bool = True,
) -> None:
    """
    Type text with human-like timing including per-character delays and word boundary pauses.

    Args:
        element: The input element to type into.
        text: The text to type.
        wpm: Words per minute for typing speed (uses config default if None).
        clear_first: Whether to clear the input before typing.
    """
    from sm_auto.utils.config import get_settings

    settings = get_settings()
    typing_wpm = wpm or settings.delays.wpm

    # Calculate delay per character based on WPM
    # Average word length is ~5 characters, so characters per second = WPM * 5 / 60
    chars_per_second = typing_wpm * 5 / 60
    base_delay = 1.0 / chars_per_second

    if clear_first:
        # Clear the input field
        await element.clear_input()
        await micro_delay()

    # Focus the element
    await element.click()
    await micro_delay()

    # Type each character with variable delay
    words = text.split()
    char_index = 0

    for word in words:
        for char in word:
            # Add some randomness to typing speed
            jitter = random.uniform(0.7, 1.3)
            delay = base_delay * jitter

            # Occasionally add a longer pause (thinking pause)
            if random.random() < 0.05:  # 5% chance
                delay *= random.uniform(2, 4)

            await element.send_keys(char)
            await asyncio.sleep(delay)
            char_index += 1

        # Add space between words with a slightly longer pause
        if char_index < len(text):  # Not the last word
            await element.send_keys(" ")
            # Word boundary pause - longer than character delay
            await asyncio.sleep(random.uniform(base_delay * 3, base_delay * 6))

    await micro_delay()


async def human_scroll(
    tab: "Tab",
    pixels: int = 2000,
    scroll_chunks: int = 5,
    with_reading_pauses: bool = True,
) -> None:
    """
    Scroll the page with human-like behavior including chunked scrolling and reading pauses.

    Args:
        tab: The browser tab to scroll.
        pixels: Total pixels to scroll.
        scroll_chunks: Number of chunks to divide the scroll into.
        with_reading_pauses: Whether to include random reading pauses.
    """
    pixels_per_chunk = pixels // scroll_chunks
    current_position = 0

    for i in range(scroll_chunks):
        # Scroll one chunk
        scroll_amount = pixels_per_chunk + random.randint(-100, 100)
        current_position += scroll_amount

        await tab.evaluate(f"window.scrollBy(0, {scroll_amount})")

        # Short pause between scroll chunks
        await asyncio.sleep(random.uniform(0.3, 0.8))

        # Occasionally add a reading pause
        if with_reading_pauses and random.random() < 0.3:  # 30% chance
            await reading_pause()


async def human_click(element: "Element") -> None:
    """
    Click an element with human-like timing.

    Args:
        element: The element to click.
    """
    # Move to element (simulated mouse movement)
    await micro_delay()

    # Click
    await element.mouse_click()

    # Post-click delay
    await micro_delay()


async def random_think_pause() -> None:
    """
    Add a random 'thinking' pause, as if the user is deciding what to do next.

    Range: 1-3s with 20% chance of longer pause (5-10s)
    """
    if random.random() < 0.2:  # 20% chance of longer pause
        await asyncio.sleep(random.uniform(5, 10))
    else:
        await asyncio.sleep(random.uniform(1, 3))
