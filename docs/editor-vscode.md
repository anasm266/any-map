# Editor integration (VS Code)

There is no bundled LSP in v2. You can invoke the CLI from a task or keybinding:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "any-map trace symbol",
      "type": "shell",
      "command": "npx any-map@2 trace ${file}:${lineNumber}:1 ${workspaceFolder}",
      "problemMatcher": []
    }
  ]
}
```

Replace `${lineNumber}` with the cursor line in a custom extension or use the integrated terminal:

```bash
npx any-map trace src/foo.ts:42:5 .
```

A dedicated VS Code extension may land in a future minor release.
