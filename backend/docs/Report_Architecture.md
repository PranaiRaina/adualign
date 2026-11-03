# PRD: Gemini Agent — Architecture Analysis & Implementation Plan
**Project:** Plotalign Financial Platform — Report-Centric Architecture  
**Agent:** Gemini (blank, codebase access)  
**Document version:** 2.0  
**Prepared:** March 2026

---

## 1. Purpose

This document instructs a Gemini agent to analyze the existing Plotalign codebase and produce two deliverables:

1. **Architecture Analysis** — a map of what currently exists, how data flows, and where gaps exist relative to the target design
2. **Implementation Plan** — a phased, ordered set of concrete engineering tasks to move from the current state to the target architecture

The agent should treat this PRD as its complete briefing. No additional human input should be required during the run.

---

## 2. Background & Target Architecture

The following is the agreed target design. The agent must use this as the north star when evaluating the current codebase.

### 2.1 Architectural principle

The **report is the roof of the entire system.** It is not a byproduct of the orchestrator — it is the primary persistent artifact that everything else reads from and writes back to. The orchestrator, agents, and surfaces all serve the report.

### 2.2 System overview

```
┌─────────────────────────────────────────────────────────────┐
│               Report: visible / invisible sections           │
└────────────────┬──────────────────────────┬─────────────────┘
                 │ load on session start     │ update the report
                 ▼                           │
   ┌─────────────────────────┐              │
   │  Query or Context       │              │  [Marketplace — ignore for now]
   │  (report injected here) │              │  ┌──────────────────────────┐
   └────────────┬────────────┘              │  │  Marketplace (report)    │
                │                           │  ├──────────────────────────┤
                ▼                           │  │  Marketplace info edits  │
   ┌────────────────────────┐               │  └──────────────────────────┘
   │      Orchestrator      │ (LangGraph)   │
   └──────────┬─────────────┘               │
              │                             │
       ┌──────┴──────┐                      │
       ▼             ▼                      │
  ┌─────────┐   ┌─────────┐                 │
  │Financial│   │  RAG    │ (LangGraph)      │
  │  Agent  │   │  Agent  │                 │
  └────┬────┘   └────┬────┘                 │
       │             │                      │
       │    ┌────────┘                      │
       ▼    ▼                               │
  ┌──────────────────────────┐              │
  │  Same Conversation       ├──────────────┘
  │  History                 │  fill new information into same report
  └──────────────────────────┘
```

### 2.3 The structured report

The report is a JSON document with two layers:

```json
{
  "meta": {
    "version": 1,
    "last_modified": "2026-03-13T10:00:00Z",
    "project_id": "..."
  },
  "visible": {
    "goals": "...",
    "risk_profile": "...",
    "portfolio_summary": "...",
    "recommendations": "..."
  },
  "context": {
    "key_questions": "...",
    "implicit_preferences": "...",
    "notable_signals": "...",
    "citation_metadata": [
      { "doc_id": "...", "page": 12, "chunk_id": "447", "answer_ref": "..." }
    ]
  }
}
```

- The `visible` layer is rendered to the user
- The `context` layer is injected into the model on session load but **never shown to the user**. It must be delimited clearly in the prompt with `## CONTEXT: NOT SHOWN TO USER ##`. Keep this section under 2,000 tokens. Place most recent signals at the top — LLMs weight earlier context more heavily in long windows.
- Citation metadata records which pre-installed document chunks informed which answers. Raw document content is never stored in the report.

### 2.4 Session load flow (left side of diagram)

When a user opens or resumes a project:

1. The report is fetched from the report store
2. Both `visible` and `context` layers are composed into the system prompt — this is the **"Query or Context (report)"** node
3. The hydrated context is passed to the orchestrator
4. The orchestrator is ready to receive the user's first message with full situational awareness
5. No chat history retrieval occurs — the report replaces it entirely

### 2.5 Conversation and report update flow

During an active session:

1. User sends a message
2. Orchestrator (LangGraph) routes to Financial Agent or RAG Agent
3. Response is returned and appended to the **Same Conversation History** node (in-session state only, not persisted long-term)
4. After each meaningful exchange, the conversation history is used to fill new information into the same report — the feedback arrow back up to the report
5. Only the affected report section(s) are regenerated (delta update, not full regeneration)
6. The updated report is written back to the report store

### 2.6 KV cache placement

The KV cache sits **inside the RAG agent**, between it and the pre-installed document store:

```
RAG Agent
    │
    ├── KV Cache (CAG: preloaded static docs)
    │       └── Hit → return directly, no vector search
    │
    └── Vector DB (RAG: dynamic / large corpus queries)
            └── Miss → retrieve chunks, write citation metadata to report
```

The report never touches the KV cache directly. The RAG agent manages cache/vector routing internally.

### 2.7 Marketplace (deferred — do not implement yet)

The marketplace surfaces exist in the architecture and are shown in the diagram, but are explicitly deferred from the current implementation scope. The agent must:

- Note the marketplace as a planned future surface in the architecture analysis
- Include it as a placeholder phase at the end of the implementation plan
- **Not** include any marketplace tasks in the active implementation phases

When eventually implemented, marketplace tile edits will trigger the same delta update pipeline as chat edits — writing back to the same report via the "update the report" feedback arrow.

### 2.8 LangGraph usage

The diagram annotates LangGraph on the following nodes:

- **Orchestrator** — built as a LangGraph graph with routing logic as conditional edges
- **Financial Agent** — a LangGraph node
- **RAG Agent** — a LangGraph node

The agent should identify whether LangGraph is already present in the codebase and how it is currently used.

### 2.9 Conflict resolution

- Each report version carries a `last_modified` timestamp in `meta`
- On save, check: if incoming `last_modified` < stored `last_modified`, reject and surface a merge conflict
- This is a v2 concern. v1 assumes single-session editing.

---

## 3. Agent Instructions

### 3.1 Phase 1 — Codebase ingestion

The agent must begin by reading and mapping the existing codebase. It must not make assumptions about what exists. Discover:

**3.1.1 Entry points**
- Identify all API route handlers or server entry points
- Map which routes serve the chat interface and which serve marketplace tiles
- Identify any existing orchestration or routing logic

**3.1.2 Data models**
- Find all database schemas, ORM models, or type definitions
- Identify where conversation/chat history is currently stored
- Identify where marketplace tile data is currently stored
- Note whether any report or summary object currently exists

**3.1.3 LLM integrations**
- Find all LLM API calls (API clients, prompt construction, response parsing)
- Identify which models are called and for what purposes
- Note how context/history is currently passed to the model
- Identify whether LangGraph is in use and how it is wired

**3.1.4 RAG pipeline**
- Find the vector database client and embedding calls
- Identify how documents are chunked, indexed, and retrieved
- Note whether citation metadata is currently tracked anywhere
- Confirm that documents are pre-installed (not user-uploaded)
- Estimate the total token size of the static document corpus (flag if under 150k tokens — CAG viable)

**3.1.5 Frontend surfaces**
- Identify the chat UI component tree
- Identify the marketplace tile component tree
- Note how each surface currently reads and writes data

**3.1.6 State management**
- Identify how state is shared (or not) between chat and marketplace
- Note any existing shared stores, context providers, or APIs both surfaces consume

### 3.2 Phase 2 — Gap analysis

Compare the current state against the target architecture (section 2) and produce a gap analysis:

**3.2.1 Missing components**
For each component in section 2 that does not exist, note:
- What currently fills that role (if anything)
- Build from scratch vs. refactor

**3.2.2 Data model gaps**
- Does the report JSON model exist?
- Is the visible/context layer separation implemented?
- Is citation metadata tracked in the report?
- Is report versioning present?

**3.2.3 Session load gaps**
- Does a "Query or Context" hydration step exist?
- Is the report injected into the system prompt on session start?
- Is the invisible context section properly delimited in prompts?

**3.2.4 Orchestrator gaps**
- Does a LangGraph orchestrator exist routing between Financial and RAG agents?
- Does it support delta report updates after each exchange?
- Does it write conversation history to the same conversation history store?

**3.2.5 RAG / KV cache gaps**
- Does the RAG agent have a KV cache layer for static docs?
- Are citations written back to the report's `context.citation_metadata`?
- What is the estimated static corpus token size?

**3.2.6 Marketplace gaps (document only, no implementation tasks)**
- Note current state of marketplace surfaces
- Flag what would need to connect to the delta update pipeline when the time comes

### 3.3 Phase 3 — Implementation plan

Produce a phased implementation plan. Each phase must follow this structure:

```
## Phase N — [Name]

**Goal:** One sentence
**Depends on:** Prior phases required (or "none")
**Estimated complexity:** Low / Medium / High

### Tasks
1. [Task name]
   - File(s) affected: [real paths from codebase]
   - What to do: [precise description]
   - Acceptance criteria: [how to verify]

### What does NOT change in this phase
[Explicit list]
```

Phases must be in this order:

**Phase 1 — Report data model**
Define the report JSON schema (visible, context, meta layers), storage model, and versioning. This is the foundation for everything else.

**Phase 2 — Report generation pipeline**
Implement: full chat history → Claude Sonnet → structured report JSON. Include the system prompt template with the invisible section delimiter (`## CONTEXT: NOT SHOWN TO USER ##`). Keep context section under 2,000 tokens.

**Phase 3 — Session load (Query or Context node)**
Implement the session hydration step: fetch report → compose visible + context into system prompt → pass to orchestrator. This is the "Query or Context (report)" node in the diagram.

**Phase 4 — LangGraph orchestrator**
Build or refactor the LangGraph orchestrator with conditional routing to Financial Agent and RAG Agent. Wire it to receive the hydrated context from Phase 3.

**Phase 5 — Conversation history store**
Implement the Same Conversation History node as in-session state. Define how it accumulates during a session and when it triggers a delta report update.

**Phase 6 — Delta update pipeline**
Given a conversation exchange, identify affected report section(s), run a targeted prompt to regenerate only that section, merge back into the stored report. This is the "fill new information into the same report" feedback arrow.

**Phase 7 — RAG agent + KV cache layer**
If static corpus is under 150k tokens: implement KV cache preloading as the first lookup layer inside the RAG agent. If over: document why vector retrieval remains appropriate and skip. Ensure citation metadata is written to `context.citation_metadata` on every RAG response.

**Phase 8 — Marketplace integration (placeholder)**
Do not implement. Document the integration point: marketplace tile edits → delta update pipeline → report write-back. List the specific hooks that will need to be built when this phase is activated.

**Phase 9 — Conflict guard**
Implement `last_modified` timestamp check on report save. Surface merge conflicts in UI.

---

## 4. Output format

The agent must produce a single Markdown document:

```
# Architecture Analysis & Implementation Plan — Plotalign

## Executive summary

## Current architecture map
[Subsections per 3.1, with file paths and code references]

## Gap analysis
[Subsections per 3.2, severity: Critical / Important / Nice-to-have]

## Implementation plan
[All 9 phases per structure in 3.3]

## Open questions
[Anything undeterminable from codebase alone]

## Appendix A: Report JSON schema
[Full annotated target schema]

## Appendix B: LangGraph graph definition (sketch)
[Pseudocode or node/edge map for the orchestrator graph]
```

---

## 5. Constraints & guardrails

- Do not modify any files. Read-and-analyze only.
- Do not hallucinate file paths. Only reference files that exist in the codebase.
- If a section is ambiguous, say so explicitly rather than guessing.
- Prioritize specificity — precise findings on 5 files beat vague summaries of 20.
- Implementation plan tasks must reference real file paths from Phase 1, not placeholders.
- Flag any existing patterns that conflict with the target architecture and would require breaking changes.
- Marketplace tasks must not appear in active implementation phases. Phase 8 is a placeholder only.

---

## 6. Success criteria

A mid-level engineer unfamiliar with the codebase can read the implementation plan and begin Phase 1 tasks without asking any clarifying questions about architecture intent.