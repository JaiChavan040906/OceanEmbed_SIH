"""Thin wrapper around Groq's OpenAI-compatible chat API.

Used for narrative analysis of predicted subsurface fields, profiles, and heatwave alerts.
Free-form input; the caller decides what context to pass.
"""
from __future__ import annotations
from typing import Any

from .config import settings

try:
    from groq import Groq
except ImportError:
    Groq = None


SYSTEM_PROMPT = """You are an expert oceanographer and marine-data analyst.
The user will supply predictions from an AI model (OceanEmbedV2) that reconstructs
subsurface temperature in the North Indian Ocean from daily satellite observations.
Give crisp, physically informed analysis in plain English:
- Interpret the numbers (compare to climatological norms where possible).
- Flag anomalies (marine heatwaves, unusual thermocline depth, mesoscale eddies).
- Suggest concrete downstream actions for fisheries, cyclone forecasting, or
  coral-reef management if relevant.
- Keep responses under 250 words. Use short paragraphs and bullet points when helpful.
Never invent numbers; if a value is missing say so."""


def _client() -> Any:
    if Groq is None:
        raise RuntimeError("groq package not installed. `pip install groq`.")
    if not settings.groq_api_key:
        raise RuntimeError("GROQ_API_KEY not set (add it to backend/.env).")
    return Groq(api_key=settings.groq_api_key)


def analyse(user_context: str, extra_system: str | None = None,
            temperature: float = 0.3, max_tokens: int = 700) -> str:
    """Send `user_context` to Groq and return the analyst text."""
    client = _client()
    sys_prompt = SYSTEM_PROMPT
    if extra_system:
        sys_prompt = sys_prompt + "\n\n" + extra_system
    resp = client.chat.completions.create(
        model=settings.groq_model,
        messages=[
            {'role': 'system', 'content': sys_prompt},
            {'role': 'user',   'content': user_context},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return resp.choices[0].message.content.strip()
