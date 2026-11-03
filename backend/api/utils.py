import json
import logging
import os
import re
from pathlib import Path
from typing import Sequence

logger = logging.getLogger(__name__)


def minify_llm_response(raw_response: str) -> str:
    """Clean and minify a potentially messy JSON string from an LLM."""
    if not raw_response:
        return "{}"

    raw = raw_response.strip()

    # Step 1: Strip markdown code blocks if present
    # Case insensitive to handle ```JSON or ```json
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE | re.MULTILINE)
    raw = re.sub(r"\s*```$", "", raw, flags=re.MULTILINE)

    # Step 2: Aggressively extract only the content between the FIRST { and LAST }
    first_brace = raw.find("{")
    last_brace = raw.rfind("}")
    if first_brace != -1 and last_brace != -1:
        raw = raw[first_brace : last_brace + 1]

    raw = raw.strip()

    # Step 3: Validate and minify
    try:
        data = json.loads(raw)
        return json.dumps(data, separators=(",", ":"))
    except json.JSONDecodeError as exc:
        # If it fails, we return the cleaned raw string and let the caller handle it or log it
        logger.warning(f"Failed to decode JSON from LLM: {exc}")
        return raw


def _read_env_key(var_name: str) -> str:
    """Read ``var_name`` from environment, falling back to the root .env file."""
    key = os.environ.get(var_name, "").strip()
    if not key:
        env_path = Path(__file__).resolve().parent.parent / ".env"
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line.startswith(f"{var_name}="):
                    key = line.split("=", 1)[1].strip().strip("\"'")
                    break
    return key


def get_api_key() -> str:
    """Read GEMINI_API_KEY (used for embeddings) from env or root .env file."""
    return _read_env_key("GEMINI_API_KEY")


def get_openrouter_key() -> str:
    """Read OPENROUTER_API_KEY (used for chat/completion) from env or root .env."""
    return _read_env_key("OPENROUTER_API_KEY")


def format_tagged_block(tag: str, content: str) -> str:
    """Wrap untrusted content in an explicit XML-like block."""
    return f"<{tag}>\n{content}\n</{tag}>"


def format_tagged_turns(turns: Sequence[object] | None) -> str:
    """Render conversation turns with explicit untrusted-content delimiters."""
    if not turns:
        return "No prior history."

    lines: list[str] = []
    for turn in turns:
        role = str(getattr(turn, "role", "user"))
        content = str(getattr(turn, "content", ""))
        lines.append(f"- {role}: {format_tagged_block('conversation_turn', content)}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Safety Guardrails
# ---------------------------------------------------------------------------

INJECTION_PATTERNS = [
    "ignore previous instructions",
    "ignore all instructions",
    "reveal your system prompt",
    "forget everything",
    "act as",
    "jailbreak",
    "you are now",
    "what are your instructions",
    "what is your prompt",
    "system prompt",
]


def scrub_pii(text: str) -> str:
    patterns = [
        r"\b\d{3}-\d{2}-\d{4}\b",
        r"\b(?:\d[ -]*?){13,16}\b",
        r"\b[A-Z]\d{7}\b",
    ]
    for p in patterns:
        text = re.sub(p, "[REDACTED]", text)
    return text


def safety_check(message: str) -> str | None:
    """Returns a block reason string if unsafe, None if clean."""
    if any(p in message.lower() for p in INJECTION_PATTERNS):
        return "injection"
    return None
