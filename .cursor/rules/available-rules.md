---
description: Reminder of available project rules and their purposes
globs: ['**/*']
alwaysApply: true
---

# Available Project Rules

This project has several important rules that should be followed. Always check and follow these rules when working on the codebase:

## @icon-usage.md

- **Purpose**: Icon usage guidelines and requirements
- **Key Points**:
  - Always use the custom `<Icon>` component from `assets/icons`
  - Icons must be pre-configured in `metro.config.js`
  - Use theme colors with `getPrimaryColor()` instead of hardcoded colors
  - Available icon libraries: Material Symbols, Fluent UI, Lucide, Font Awesome 6, etc.
- **When to follow**: Whenever using icons in components

## Other Rules

- Check `.cursor/rules/` directory for additional project-specific rules
- Each rule file contains specific guidance for different aspects of the codebase
- Rules are automatically applied based on file patterns or can be manually invoked with @ruleName

## Rule Compliance

- Always check if there are relevant rules before implementing features
- Follow the established patterns and guidelines in each rule
- When in doubt, reference the specific rule file for detailed guidance
