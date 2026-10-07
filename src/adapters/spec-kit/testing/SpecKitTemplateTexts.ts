/**
 * Literal excerpts of spec-kit 1.1.0's templates (commit 9fb13c1), as `specify init` and its commands copy them into a project, for the
 * reader specs: every line they hold is the template's own, in its order, with the template's examples between.
 */
export const SPEC_TEMPLATE_TEXT = `# Feature Specification: [FEATURE NAME]

**Feature Branch**: \`[###-feature-name]\`

**Created**: [DATE]

**Status**: Draft

**Input**: User description: "$ARGUMENTS"

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
-->

### User Story 1 - [Brief Title] (Priority: P1)

[Describe this user journey in plain language]

---

### User Story 2 - [Brief Title] (Priority: P2)

[Describe this user journey in plain language]

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST [specific capability, e.g., "allow users to create accounts"]
- **FR-002**: System MUST [specific capability, e.g., "validate email addresses"]

*Example of marking unclear requirements:*

- **FR-006**: System MUST authenticate users via [NEEDS CLARIFICATION: auth method not specified - email/password, SSO, OAuth?]
- **FR-007**: System MUST retain user data for [NEEDS CLARIFICATION: retention period not specified]

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: [Measurable metric, e.g., "Users can complete account creation in under 2 minutes"]
- **SC-002**: [Measurable metric, e.g., "System handles 1000 concurrent users without degradation"]
`;

export const PLAN_TEMPLATE_TEXT = `# Implementation Plan: [FEATURE]

**Branch**: \`[###-feature-name]\` | **Date**: [DATE] | **Spec**: [link]

## Technical Context

**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION]

**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]

**Storage**: [if applicable, e.g., PostgreSQL, CoreData, files or N/A]
`;

export const TASKS_TEMPLATE_TEXT = `---

description: "Task list template for feature implementation"
---

# Tasks: [FEATURE NAME]

**Input**: Design documents from \`/specs/[###-feature-name]/\`

## Format: \`[ID] [P?] [Story] Description\`

- **[P]**: Can run in parallel (different files, no dependencies)

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Create project structure per implementation plan
- [ ] T002 Initialize [language] project with [framework] dependencies
- [ ] T003 [P] Configure linting and formatting tools

---

## Phase 2: Foundational (Blocking Prerequisites)

- [ ] T004 Setup database schema and migrations framework
- [ ] T005 [P] Implement authentication/authorization framework

---

## Phase 3: User Story 1 - [Title] (Priority: P1) 🎯 MVP

### Implementation for User Story 1

- [ ] T012 [P] [US1] Create [Entity1] model in src/models/[entity1].py
- [ ] T014 [US1] Implement [Service] in src/services/[service].py (depends on T012, T013)

---

## Phase 4: User Story 2 - [Title] (Priority: P2)

- [ ] T020 [P] [US2] Create [Entity] model in src/models/[entity].py

---

## Phase N: Polish & Cross-Cutting Concerns

- [ ] TXXX [P] Documentation updates in docs/

---

## Parallel Example: User Story 1

\`\`\`bash
# Launch all tests for User Story 1 together (if tests requested):
Task: "Contract test for [endpoint] in tests/contract/test_[name].py"
\`\`\`
`;

export const CHECKLIST_TEMPLATE_TEXT = `# [CHECKLIST TYPE] Checklist: [FEATURE NAME]

**Purpose**: [Brief description of what this checklist covers]

## [Category 1]

- [ ] CHK001 First checklist item with clear action
- [ ] CHK002 Second checklist item

## Notes

- Mark items \`[x]\` only after review confirms the requirement-quality criterion is satisfied
`;

export const CONSTITUTION_TEMPLATE_TEXT = `# [PROJECT_NAME] Constitution
<!-- Example: Spec Constitution, TaskFlow Constitution, etc. -->

## Core Principles

### [PRINCIPLE_1_NAME]
<!-- Example: I. Library-First -->
[PRINCIPLE_1_DESCRIPTION]

### [PRINCIPLE_2_NAME]
<!-- Example: II. CLI Interface -->
[PRINCIPLE_2_DESCRIPTION]

## [SECTION_2_NAME]

[SECTION_2_CONTENT]

## Governance

[GOVERNANCE_RULES]

**Version**: [CONSTITUTION_VERSION] | **Ratified**: [RATIFICATION_DATE] | **Last Amended**: [LAST_AMENDED_DATE]
<!-- Example: Version: 2.1.1 | Ratified: 2025-06-13 | Last Amended: 2025-07-16 -->
`;

/** Text no reader may throw on: empty, binary-looking, and blank. */
export const HOSTILE_TEXTS: ReadonlyArray<readonly [string, string]> = [
  ['empty text', ''],
  ['binary-looking text', '\u0089PNG\r\n\u001a\n\u0000\u0000\u0000\rIHDR�'],
  ['blank lines only', '\n\n\r\n'],
];

const TRUNCATION_STEP_IN_CHARACTERS = 7;

/** Every cut of a text at a fixed step, the way a file read while it is still being written ends early. */
export function truncationsOf(text: string): string[] {
  const truncations: string[] = [];
  for (let length = 0; length < text.length; length += TRUNCATION_STEP_IN_CHARACTERS) truncations.push(text.slice(0, length));
  return truncations;
}
