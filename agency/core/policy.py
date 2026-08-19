"""Compliance engine — the hard gate every piece of content passes before it
can be published.

Non-negotiable rules (they cannot be turned off by config):
  * no real, identifiable person may be depicted or referenced as the subject
    of a generated likeness (no celebrity names, no "looks like <person>",
    no uploaded reference of a real human);
  * every persona is an adult fictional character, and any descriptor that
    reads young/school-adjacent is rejected outright;
  * suggestive/adult-tier material may only go to age-gated destinations, and
    only when the operator explicitly enabled that tier;
  * every published item carries an AI-disclosure label.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# Descriptors that imply a minor. Any hit is a hard reject, in any tier.
MINOR_TERMS = [
    r"\bchild(?:ren)?\b", r"\bkid(?:s)?\b", r"\bteen(?:s|age[dr]?)?\b", r"\bminor\b",
    r"\bschool ?girl\b", r"\bschool ?boy\b", r"\bunderage\b", r"\bloli\b", r"\bpre-?teen\b",
    r"\byoung ?girl\b", r"\byoung ?boy\b", r"\bbaby\b", r"\btoddler\b", r"\bhigh ?school\b",
    r"\b(1[0-7])\s*(?:years? old|yo|y/o)\b",
]

# Anything implying a real, identifiable human being.
REAL_PERSON_TERMS = [
    r"\bcelebrit(?:y|ies)\b", r"\blookalike\b", r"\blook(?:s)? like [A-Z]", r"\bdeep ?fake\b",
    r"\bface ?swap\b", r"\bundress\b", r"\bnudify\b", r"\breal person\b", r"\bmy ex\b",
    r"\bphoto of (?:a )?real\b", r"\bactress\b", r"\bactor\b", r"\binfluencer named\b",
]

# Adult-tier signals: allowed only when the adult tier is enabled AND the
# destination is age-gated.
ADULT_TERMS = [
    r"\bnude\b", r"\bnsfw\b", r"\bexplicit\b", r"\blingerie\b", r"\btopless\b",
    r"\bsuggestive\b", r"\bboudoir\b", r"\bfetish\b",
]

MEDICAL_CLAIMS = [r"\bcures?\b", r"\bguaranteed (?:results|income)\b", r"\bmiracle\b",
                  r"\bFDA[- ]approved\b", r"\blose \d+ ?(?:kg|lbs) in \d+ days\b"]

FINANCIAL_CLAIMS = [r"\bguaranteed returns?\b", r"\brisk[- ]free\b", r"\bget rich quick\b",
                    r"\bdouble your money\b"]

DISCLOSURE = "AI-generated character. Not a real person."


@dataclass
class Verdict:
    allowed: bool
    tier: str                       # sfw | adult
    reasons: list[str] = field(default_factory=list)
    edits: dict = field(default_factory=dict)
    severity: str = "ok"            # ok | downgraded | blocked

    def as_dict(self) -> dict:
        return {"allowed": self.allowed, "tier": self.tier, "reasons": self.reasons,
                "severity": self.severity, "edits": self.edits}


def _hits(patterns: list[str], text: str) -> list[str]:
    return [p for p in patterns if re.search(p, text, flags=re.IGNORECASE)]


class PolicyEngine:
    def __init__(self, adult_enabled: bool, age_gated_platforms: set[str]):
        self.adult_enabled = adult_enabled
        self.age_gated = set(age_gated_platforms)

    # -- gate 1: anything we are about to send to a generation provider ------
    def check_prompt(self, prompt: str, tier: str) -> Verdict:
        text = prompt or ""
        if _hits(MINOR_TERMS, text):
            return Verdict(False, "sfw", ["minor_depiction_terms"], severity="blocked")
        if _hits(REAL_PERSON_TERMS, text):
            return Verdict(False, "sfw", ["real_person_likeness"], severity="blocked")
        adult_hit = _hits(ADULT_TERMS, text)
        if adult_hit and not self.adult_enabled:
            # Blocked, not "downgraded": suggestive wording cannot be reliably
            # stripped out of a finished item, so the only safe answer is no.
            # `edits.strip` lets an upstream agent regenerate a clean version.
            return Verdict(False, "sfw", ["adult_tier_disabled"],
                           edits={"strip": adult_hit}, severity="blocked")
        return Verdict(True, "adult" if adult_hit else tier, [])

    # -- gate 2: the finished item, per destination -------------------------
    def check_publication(self, text: str, tier: str, platform: str) -> Verdict:
        base = self.check_prompt(text, tier)
        if not base.allowed:
            return base
        reasons = list(base.reasons)
        effective = base.tier
        if effective == "adult" and platform not in self.age_gated:
            return Verdict(False, effective, reasons + [f"adult_content_not_allowed_on:{platform}"],
                           severity="blocked")
        for pat_list, label in ((MEDICAL_CLAIMS, "unsupported_health_claim"),
                                (FINANCIAL_CLAIMS, "unsupported_financial_claim")):
            if _hits(pat_list, text):
                return Verdict(False, effective, reasons + [label], severity="blocked")
        edits = dict(base.edits)
        if DISCLOSURE not in text:
            edits["append_disclosure"] = DISCLOSURE
        return Verdict(True, effective, reasons, edits=edits,
                       severity=base.severity if reasons else "ok")

    # -- gate 3: the persona itself, at creation time -----------------------
    def check_persona(self, name: str, look: str, bio: str, age: int) -> Verdict:
        blob = " ".join([name, look, bio])
        if age < 18:
            return Verdict(False, "sfw", ["persona_under_18"], severity="blocked")
        return self.check_prompt(blob, "sfw")
