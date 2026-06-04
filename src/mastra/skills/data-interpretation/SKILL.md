# Skill: Data Interpretation

**ID:** `data-interpretation`
**Version:** 1.0.0
**Applicable Agents:** Writer Agent

---

## Purpose

Teaches the Writer Agent how to read and interpret aggregated dataset rows correctly
before translating them into Arabic narrative prose. Prevents common mistakes such as
misreading "value" as a literal label, treating null as zero, or describing percentage
fields incorrectly.

---

## When It Applies

Load this skill whenever the Writer Agent receives a dataset and must generate either
a `summary` (general question) or `reportSections` (report mode).

---

## What It Provides

- Interpretation rules for the `value`, `percent`, and dimension fields
- Null vs zero distinction and how to handle each in prose
- How to describe trends, comparisons, and rankings from aggregated data
- Rules for empty or near-empty datasets
- Arabic number formatting and unit conventions
- Anti-patterns to avoid when grounding sentences in data

---

## Skill Does NOT Handle

- Chart generation → Chart Planner agent
- Pipeline construction → MongoDB Agent
- Supervisor planning → Supervisor Agent

---

## Maintained By

Mind Platform Analytics Team
