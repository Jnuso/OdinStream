# 4. Prepare collaboration and quality checks

1. Document prerequisites, setup, configuration, run and test commands in the project README. Keep credentials and local databases out of version control; provide a safe example configuration without secrets.
2. Agree on a branching and review approach appropriate to the team. Keep changes focused, review diffs, use descriptive commits and integrate frequently. A separate development branch is optional, not inherently required.
3. Set up automated checks for relevant formatting, static analysis, builds and meaningful tests. Run checks locally and in continuous integration on pull requests and relevant branch updates.
4. Verify the checks actually execute and report failures. Choose runner permissions conservatively and protect secrets from untrusted changes. Document required checks and how to troubleshoot them.
5. If containers improve reproducibility or are required, use a maintained base image, limit build context, keep secrets out of images and document how services and persistent storage are configured. Test the resulting application, not just the image build.

**Output:** reproducible setup instructions, agreed collaboration process and working automated checks.
