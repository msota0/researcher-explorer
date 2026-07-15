"""Lossless de-duplication of authors that are really the same person.

OpenAlex fragments one real person across many author IDs and often fails to
link them. We never delete rows; instead, at read time, we compute one
**canonical** id per person plus **merged stats**, so the directory and graph
show a single entry without losing any real works/citations.

Two kinds of fragment are folded together, both scoped to the UM dataset:

1. **Shared ORCID** — definitive. Records that carry the same ORCID are the same
   person (this also covers corrupt "phantom" records: works but 0 citations and
   0 h-index, which are dropped from the stat merge so they can't inject fake
   works).

2. **Name variants with no ORCID** — OpenAlex frequently splits a prolific author
   into dozens of IDs spelled differently ("Ikhlas A. Khan", "Ikhlas Khan",
   "IA Khan", "I. A. Khan"…), only one of which carries an ORCID. We fold the
   ORCID-less variants into that ORCID-bearing **anchor** when the name is
   compatible (same surname, matching first name / initials, no conflicting
   middle initial) AND the anchor is the *only* compatible one for that surname
   — so an ambiguous bare-initials record next to two different anchors is left
   alone. Because the dataset is already UM-only, same-name collisions are rare,
   which makes this safe; the rule still keeps genuinely different people apart
   (e.g. "Ikhlas H. Khan" or "Shabana I. Khan" never merge into "Ikhlas A. Khan").

The map is derived from static post-import data, so it is built once and cached.
"""
from __future__ import annotations

import re
from collections import defaultdict
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import UM_INSTITUTION_NAME
from .db_models import Author

# Cap on how many of a person's fragment IDs we fetch collaborators for when
# expanding them in the graph. De-duplication of *other* people's collaborator
# lists never needs this (it's a pure id remap); this only bounds the work when
# expanding the merged person directly.
MAX_MERGE_FETCH = 6

_VOWELS = set("aeiou")


class MergeMap:
    def __init__(self) -> None:
        # every member id -> its canonical id
        self.alias_to_canonical: dict[str, str] = {}
        # canonical id -> merged stat overrides {works_count, cited_by_count, h_index}
        self.stats: dict[str, dict] = {}
        # canonical id -> member ids to fetch collaborators for (graph union)
        self.members: dict[str, list[str]] = {}
        # non-canonical member ids, hidden from listings
        self.alias_ids: set[str] = set()

    def canonical(self, author_id: str) -> str:
        return self.alias_to_canonical.get(author_id, author_id)


def _is_phantom(a: Author) -> bool:
    """A record with works but no impact at all — a corrupt OpenAlex stub."""
    return (a.cited_by_count or 0) == 0 and (a.h_index or 0) == 0


# ---------- name parsing / compatibility ----------

def _tokens(name: str) -> list[str]:
    return [t for t in re.sub(r"[^a-z\s]", " ", (name or "").lower()).split() if t]


def _surname(name: str) -> str:
    toks = _tokens(name)
    return toks[-1] if toks else ""


def _given(name: str) -> list[str]:
    return _tokens(name)[:-1]


def _is_name_word(t: str) -> bool:
    """A spelled-out given name vs. an initial / initials-blob like 'ia'."""
    return len(t) >= 3 and any(c in _VOWELS for c in t)


def _given_profile(given: list[str]) -> tuple[Optional[str], str]:
    """(first spelled-out name or None, initials signature).

    'ikhlas a'  -> ('ikhlas', 'ia')   ·  'ia' -> (None, 'ia')
    'i a'       -> (None, 'ia')        ·  'ikhlas h' -> ('ikhlas', 'ih')
    """
    first = next((t for t in given if _is_name_word(t)), None)
    init: list[str] = []
    for t in given:
        if _is_name_word(t) or len(t) == 1:
            init.append(t[0])
        else:
            init.extend(list(t))  # concatenated initials, e.g. 'ia' -> i, a
    return first, "".join(init)


def _name_compatible(anchor_name: str, cand_name: str) -> bool:
    """Whether `cand_name` is a plausible spelling of `anchor_name` (same surname
    assumed). Conservative: conflicting first names or middle initials fail."""
    fa, ia = _given_profile(_given(anchor_name))
    fc, ic = _given_profile(_given(cand_name))
    # Full first names, when both present, must be prefix-compatible.
    if fa and fc and not (fa.startswith(fc) or fc.startswith(fa)):
        return False
    # Initials must agree up to the shorter one (a variant may simply omit a
    # middle initial, but must never contradict one: 'ia' vs 'ih' conflicts).
    n = min(len(ia), len(ic))
    if n and ia[:n] != ic[:n]:
        return False
    # Require at least a first-letter match so unrelated names never pass.
    if ia and ic and ia[0] != ic[0]:
        return False
    return True


# ---------- map construction ----------

def _build(db: Session) -> MergeMap:
    m = MergeMap()
    rows = db.scalars(
        select(Author).where(Author.last_known_institution_name == UM_INSTITUTION_NAME)
    ).all()
    by_id = {r.id: r for r in rows}

    # canonical id -> set of member ids in that person's cluster
    clusters: dict[str, set[str]] = defaultdict(set)

    # Phase 1 — ORCID groups (definitive: same ORCID == same person).
    orcid_groups: dict[str, list[Author]] = defaultdict(list)
    for r in rows:
        if r.orcid:
            orcid_groups[r.orcid].append(r)
    anchors: list[str] = []  # one canonical id per ORCID group
    for members in orcid_groups.values():
        real = [r for r in members if not _is_phantom(r)]
        contrib = real or members
        canon = max(
            contrib,
            key=lambda r: (r.cited_by_count or 0, r.works_count or 0, r.h_index or 0, r.id),
        )
        for r in members:
            clusters[canon.id].add(r.id)
        anchors.append(canon.id)

    # Phase 1b — consolidate anchors that are one person under two ORCIDs
    # (OpenAlex sometimes mints a second ORCID). Only when both names are spelled
    # out and compatible, so two genuinely different same-initial people stay apart.
    parent = {a: a for a in anchors}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra == rb:
            return
        A, B = by_id[ra], by_id[rb]
        ka = (A.cited_by_count or 0, A.works_count or 0, A.id)
        kb = (B.cited_by_count or 0, B.works_count or 0, B.id)
        keep, drop = (ra, rb) if ka >= kb else (rb, ra)
        parent[drop] = keep

    by_surname: dict[str, list[str]] = defaultdict(list)
    for a in anchors:
        by_surname[_surname(by_id[a].display_name)].append(a)
    for ids in by_surname.values():
        for i in range(len(ids)):
            fi, _ = _given_profile(_given(by_id[ids[i]].display_name))
            for j in range(i + 1, len(ids)):
                fj, _ = _given_profile(_given(by_id[ids[j]].display_name))
                # Merging two established (ORCID) identities is high-stakes, so
                # require an EXACT first-name match — keeps 'Sara' and 'Sarah'
                # apart — plus middle-initial compatibility via _name_compatible.
                if fi and fj and fi == fj and _name_compatible(
                    by_id[ids[i]].display_name, by_id[ids[j]].display_name
                ):
                    union(ids[i], ids[j])

    if any(find(a) != a for a in anchors):
        merged: dict[str, set[str]] = defaultdict(set)
        for canon_id, members in clusters.items():
            merged[find(canon_id)] |= members
        clusters = merged

    # Phase 2 — fold ORCID-less name variants into the single anchor for that name.
    anchors_by_surname: dict[str, list[Author]] = defaultdict(list)
    for canon_id in {find(a) for a in anchors}:
        a = by_id[canon_id]
        sur = _surname(a.display_name)
        if sur:
            anchors_by_surname[sur].append(a)

    for r in rows:
        if r.orcid:
            continue  # only ORCID-less records are name-merge candidates
        matches = [
            a
            for a in anchors_by_surname.get(_surname(r.display_name), [])
            if _name_compatible(a.display_name, r.display_name)
        ]
        if len(matches) == 1:  # unambiguous
            clusters[matches[0].id].add(r.id)

    # Build the final alias map + merged stats.
    for canon_id, member_ids in clusters.items():
        if len(member_ids) <= 1:
            continue
        members = [by_id[i] for i in member_ids if i in by_id]
        real = [r for r in members if not _is_phantom(r)]
        contrib = real or members
        m.stats[canon_id] = {
            "works_count": sum(r.works_count or 0 for r in contrib),
            "cited_by_count": sum(r.cited_by_count or 0 for r in contrib),
            "h_index": max((r.h_index or 0) for r in contrib) or None,
        }
        # Fetch collaborators only for the heaviest members (bounds graph latency).
        fetch = sorted(real or members, key=lambda r: r.works_count or 0, reverse=True)
        m.members[canon_id] = [r.id for r in fetch[:MAX_MERGE_FETCH]]
        for r in members:
            m.alias_to_canonical[r.id] = canon_id
            if r.id != canon_id:
                m.alias_ids.add(r.id)
    return m


_cache: Optional[MergeMap] = None


def get_merge_map(db: Session) -> MergeMap:
    global _cache
    if _cache is None:
        _cache = _build(db)
    return _cache


def reset_cache() -> None:
    global _cache
    _cache = None
