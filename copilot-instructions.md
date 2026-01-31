# GitHub Copilot Custom Instructions

## 1. General Principles
- **Minimal Intervention**
: Do not refactor existing code unless explicitly requested. Focus only on the specific task or bug fix.
- **Maintain Consistency**: Follow the existing coding style, naming conventions (e.g., camelCase or snake
_case), and architectural patterns found in the repository.
- 
**Do Not Remove Comments**
: Preserve all existing comments. If you add new logic, add clear and concise comments explaining it.

## 2. Safety & Guardrails
- 
**Logic Protection**
: If you encounter complex business logic or hardcoded values, explain their purpose before suggesting any changes. 
- 
**Explain Before Acting**
: For significant changes, provide a brief explanation of *what* you plan to change and *why* before generating the code.
- 
**No Unnecessary Dependencies**
: Do not introduce new libraries or packages unless they are already present in `package.json` or specifically asked for.

## 3. Tech Stack Specifics
- 
**Tailwind CSS**
: Use Tailwind utility classes for all styling. Avoid writing custom CSS in `.css` files unless absolutely necessary.
- 
**State Management**
: Respect the current state management pattern (e.g., React Hooks, Context API) and do not introduce alternative patterns.
- 
**Error Handling**
: Ensure all new asynchronous operations are wrapped in try-catch blocks with meaningful error messages.

## 4. Communication Style
- 
**Be Direct**
: Provide code snippets and explanations concisely.
- 
**Verify Assumptions**
: If a requirement is ambiguous, ask for clarification instead of guessing and overwriting code.
