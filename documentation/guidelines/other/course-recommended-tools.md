# Tools mentioned in the course materials

This is a starting point for choosing tools, based on the supplied CSE 2102 materials. Some tools were required for specific course assignments; those requirements do not automatically apply to another project or course. Check current documentation, compatibility, access and team preferences before deciding. A tool listed here is an option, not an instruction to install it.

| Task | Tool or program | How the materials use it | Decision considerations |
| --- | --- | --- | --- |
| Plan and coordinate | Trello | Shared project board with task cards, owners and progress. | A shared board is useful; choose a tool the team will maintain. |
| Design screens and journeys | Figma | Mockups and prototypes for user interfaces. | Useful for agreeing on flows before implementation; retain accessible design links or exports. |
| Model the system | Draw.io (diagrams.net) | Editable use-case, sequence and entity relationship diagrams. | Save editable source files so the team can revise them. Diagrams should reflect the system actually built. |
| Version control and review | Git and GitHub | Repository, branches, commits and reviewed pull requests. | Agree on a simple branch and review process. The course's university-hosted GitHub settings may differ from another repository. |
| Edit code | Cursor and Visual Studio Code | Editors used in lab instructions. | Use the editor each contributor works effectively with; review and understand generated changes. |
| Automate checks | GitHub Actions | Run tests and linting as changes are integrated. | Choose triggers, permissions and runners appropriate to the repository. University self-hosted runner instructions are environment-specific. |
| Design and test APIs | Swagger / OpenAPI, Flasgger, Postman | Describe and explore API contracts; Flasgger generates documentation for Flask; Postman exercises API requests. | Select tools compatible with the chosen backend. A written contract and automated HTTP tests remain useful even without a particular UI. |
| Build a frontend | React, Vite, Node.js and npm | React interfaces, Vite project setup and development server, and JavaScript tooling. | Consider team familiarity, project needs and version compatibility. These are a related stack, not interchangeable tools. |
| Navigate and call APIs | React Router; Fetch or Axios | Navigation and browser requests to backend endpoints. | Choose based on routing and request needs; Fetch and Axios are alternatives, not both required. |
| Style the interface | Bootstrap or React-Bootstrap | Optional UI styling and components. | Consider design flexibility, accessibility and whether an extra component library is needed. |
| Build a backend | Python with FastAPI or Flask | Server-side API frameworks. The supplied group requirements name FastAPI; an older milestone names Flask. | Treat these as alternatives and resolve the discrepancy for the applicable project; don't combine them just because both appear. |
| Store data | SQLite | Local database used in course exercises. | Simple for development and smaller deployments; assess concurrency, hosting and persistence before choosing it for production. |
| Test and analyze Python | pytest and Pylint | Automated tests and static analysis, including tests that send HTTP requests to APIs. | Applicable when using Python; choose appropriate equivalents for other languages. Include meaningful integration and boundary tests. |
| Package and run services | Docker | Containerize frontend and backend for reproducible execution. | Useful if the team needs consistent environments; plan configuration, persistent data and safe secret handling. |

## A practical selection process

1. Start with the team's requirements, experience and existing decisions; note which decisions remain open.
2. Choose one tool per need where possible, check that the tools work together, and try a small end-to-end example.
3. Record the choice, reason, tradeoffs and setup instructions in the project documentation. Revisit it when evidence or requirements change.

**Source context:** CSE 2102 group project requirements, milestones 1–7, Git and GitHub Actions exercises, React lab, and API, frontend and container lecture materials supplied for review. Their individual instructions can differ by year and assignment; they are examples rather than a single verified tool specification.
