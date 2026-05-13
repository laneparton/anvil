# Anvil Brand Direction

## Positioning

Anvil is a desktop workbench for serious code review.

The name should move the product away from prototype language like "lab" and away from generic PR-dashboard language. An anvil suggests pressure, craft, shaping, durability, and judgment. That fits the app's direction: the tool is not a chat surface and not a magical AI reviewer. It is a local review instrument that helps a human inspect, decide, and ship.

The brand promise:

```text
Bring the change here. Put pressure on it. Leave with a sharper review.
```

## Personality

Anvil should feel:

- grounded
- quiet
- exact
- durable
- local-first
- engineering-led

It should not feel:

- playful
- magical
- agent-first
- marketing-heavy
- SaaS-generic
- decorative

## Visual Direction

The UI should feel like a careful desktop tool, not a web landing page.

Use a restrained workbench palette:

- Background: warm off-white `#F7F5F0`
- Surface: muted stone `#EFEEE8`
- Border: stone gray `#D8D4C8`
- Primary text: near-black olive `#181A16`
- Secondary text: weathered gray `#666960`
- Primary/action: deep green `#0F6B4F`
- Attention/review accent: brass amber `#B7791F`
- Danger/blocking: muted red `#B42318`
- Info/source links: steel blue `#2F5F8F`

The palette should avoid the default dark-blue developer-tool look and the purple AI-product look. Green, amber, and red should map to review state: ready, needs attention, blocked.

## Typography

The app should use typography that supports long review sessions.

- Interface text should be compact, neutral, and highly legible.
- Code should be visually dominant.
- Headings should be functional, not editorial.
- Avoid oversized hero-scale text inside the app.
- Use monospaced text for event logs, refs, paths, command output, and code.

## Layout Principles

Anvil should be shaped around review workflow:

- Left: repository, PR, slice queue, and state.
- Center: diff and code context.
- Right: findings, comments, evidence, and actions.
- Bottom or collapsible panel: runtime event stream and diagnostics.

The interface should favor split panes, resizable regions, sticky headers, and dense lists. Cards should be used only for repeated items like comments, findings, sessions, or modals. Avoid nested cards and marketing-style sections.

## Interaction Principles

Review is a decision loop, not a reading exercise.

Key actions should be first-class:

- mark slice reviewed
- convert finding to PR comment
- dismiss finding with reason
- jump to next finding
- inspect full file context
- open the local worktree in an agent or terminal
- cancel or restart a review session

The app should make progress explicit without making the user watch machinery. Event logs are important for trust and debugging, but they should collapse once the review is ready.

## AI Presence

The AI should feel like part of the bench, not the brand.

Do not lead with "AI-powered." Lead with review quality, local context, and controlled workflow. The agent can prepare slices, surface risks, and draft comments, but the human owns the review.

Preferred language:

- "Review slices"
- "Findings"
- "Evidence"
- "Questions"
- "Prepared worktree"
- "Open in agent"

Avoid language like:

- "Magic"
- "Autonomous reviewer"
- "Instant approval"
- "AI copilot for pull requests"

## Logo Direction

The logo can be abstract, but it should imply weight and precision.

Good directions:

- a compact anvil silhouette reduced to two or three geometric planes
- a monogram `A` with a flat top and grounded base
- a small mark that reads well at toolbar size
- a hard-edged symbol with slight asymmetry, like a tool stamped into metal

Avoid:

- mascots
- sparks
- hammers
- cartoon metal
- gradients
- literal blacksmith imagery

## Product Naming

Use:

```text
Anvil
```

Possible descriptive line:

```text
Desktop code review workbench
```

Avoid over-explaining the name in-product. The interface should make the metaphor obvious through behavior: changes come in, get inspected under pressure, and leave with sharper comments.

## Design North Star

Anvil should feel like a tool an experienced engineer keeps open all day.

The best version is quiet until something matters, dense without being cramped, and opinionated about getting from diff to decision.
