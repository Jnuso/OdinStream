# 5. Build and integrate

1. Select a small, high-value story and agree on its acceptance criteria. Implement a thin end-to-end path through interface, server and persistence early to expose integration risks.
2. Organize code by responsibility. Implement API contracts with input validation, consistent errors and authorization on the server. Use stubs when useful for parallel work, and clearly mark them as temporary.
3. Implement the data model with constraints and repeatable initialization or migrations. Test with isolated data; never commit real user information, credentials or generated local databases.
4. Build the interface around user journeys. Connect real API responses, handle loading and failure states, and validate input on both client and server. Test keyboard navigation and relevant screen sizes.
5. Add focused tests for important business rules, boundary conditions, permissions and API behavior. Include integration tests that verify persisted state and at least one representative user journey.
6. Replace temporary mocks at integration boundaries where real behavior must be verified. Review changes, run checks, update contracts and diagrams, and repeat with the next prioritized story.

**Output:** working, reviewed increments and updated documentation. Choose frameworks and deployment methods for the project rather than treating a particular stack as mandatory.
