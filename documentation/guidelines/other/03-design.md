# 3. Design the experience and system

1. Map the main user journeys and navigation. Sketch screens for core tasks, including empty, loading, validation, error and success states. Review for keyboard access, readable labels, responsive layouts and clear feedback.
2. Identify system components, their responsibilities and how the browser, server, database and external services communicate. Start with the simplest architecture that meets the requirements; split into services only when the benefits justify the operational cost.
3. Describe key interactions with editable diagrams where useful: user interactions, component boundaries and sequence diagrams for complex flows. Include failure paths and trust boundaries.
4. Model persistent entities, attributes, identifiers, relationships and constraints. Consider ownership, lifecycle, retention and migrations. Keep an editable entity relationship diagram or equivalent.
5. Define API contracts before or alongside implementation: method and path, purpose, authorization, input, validation, response, error cases and examples. Avoid putting secrets in URLs or documentation.
6. Identify security and privacy needs: authentication, server-side authorization, data minimization, protected transport, secret management and safe logging. Choose specific controls based on actual risks.
7. Trace designs back to requirements and stories; note unresolved decisions and update artifacts as implementation teaches the team more.

**Output:** journey sketches, architecture and data models, interaction diagrams where useful, API contract and decision log.
