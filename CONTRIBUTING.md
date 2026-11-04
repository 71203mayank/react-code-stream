# Contributing to React Code Stream

Bug reports, documentation improvements, tests, and code contributions are welcome!

This project is experimental and under active development. Please open an issue before starting a large feature or changing the public API so we can discuss the approach first. Small fixes and documentation updates can go straight to a pull request.

## Local setup

Use Node.js 24.15 or later in the Node.js 24 release line, with npm.

1. Fork the repository and clone your fork.
2. From the repository root, install dependencies and build the library:

   ```bash
   npm ci
   npm run build:lib
   ```

3. Start the local playground:

   ```bash
   npm run dev
   ```

Open the URL printed by Vite. Rebuild the library after changing its source to try your changes in the playground.

## Where to make changes

- `packages/react-code-stream`: the React component, tokenizer, incremental cache, and tests.
- `apps/docs`: the playground and benchmark demos.
- `docs`: architecture and design notes.

See the [README](README.md) for usage and the [architecture notes](docs/architecture.md) for implementation details.

## Reporting bugs

Please search existing issues before opening a new one. Include:

- What you expected and what actually happened.
- A minimal reproduction or a small code sample.
- Your package, React, and browser or Node.js versions.
- For streaming issues, the language and chunk sequence or timing needed to reproduce the problem.

## Making a pull request

1. Create a branch in your fork for your change.
2. Keep the change focused and follow the conventions in nearby code.
3. Add a regression test for a bug fix, or tests for new behavior where appropriate.
4. Update documentation when changing public APIs or usage.
5. Run the relevant checks below, then open a pull request describing the problem, your solution, and how you verified it. Link related issues and include screenshots for visual changes.

Run library checks from the repository root:

```bash
npm run check --workspace=react-code-stream
```

This runs type checking, tests, the library build, and a package contents preview.

For playground changes, also run:

```bash
npm run lint --workspace=docs
npm run build:docs
```

If you cannot run a check, mention that in your pull request. Maintainers handle package versions and releases; you do not need to bump the version for a contribution.

Please keep discussions respectful and constructive. Contributions are made under the project's [MIT license](LICENSE).
