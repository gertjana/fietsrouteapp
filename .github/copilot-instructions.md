# AI Assistant Guidelines for the "Fiets route app"

## Project Context

This is a TypeScript/Node.js web application for tracking Dutch cycling routes and nodes (fietsknooppunten). The application uses Express.js for the backend API, Leaflet for interactive maps, and integrates with OpenStreetMap data via the Overpass API. The project includes automated Docker builds with GitHub Actions for deployment.

## Core Behavioral Principles

### 1. Always Verify Compilation

- **MUST** run `npm run build` after any code modifications
- **MUST** resolve all errors before concluding
- **MUST** assume there's a server running with `npm run dev`, ask if changes require a server restart
- **SHOULD** address warnings when practical
- **EXPLAIN** any remaining warnings if they cannot be resolved

### 2. Code Quality Standards

- **FOLLOW** existing code patterns and naming conventions
- **ADD** descriptive comments for complex logic only
- **PREFER** small, focused functions over large monolithic ones

### 3. Data Integrity and API Compliance

- **ENSURE** OpenStreetMap data downloads respect Overpass API rate limits
- **VALIDATE** that chunk-based data loading maintains consistency between raw data and API responses
- **VERIFY** that cycling node and route data structures match TypeScript interfaces
- **TEST** API endpoints return properly formatted GeoJSON when applicable

### 4. Performance and Caching

- **OPTIMIZE** for large datasets (thousands of cycling nodes and routes)
- **IMPLEMENT** efficient chunked data loading for map viewport boundaries
- **RESPECT** GitHub Actions cache strategies for data downloads
- **CONSIDER** frontend performance when rendering many map markers

### 5. Sourcecode and version control

- **MUST** when asked to create a new feature, by the prompt using the words "new feature", create a feature branch suggesting a name from the text prefixed with `feature_`
- **MUST** do not add or commit code to git yourself

## Technical Decision Framework

### When Making Changes:

1. **EXPLAIN** the reasoning behind technical decisions
2. **IDENTIFY** potential trade-offs or alternatives
3. **CONSIDER** impact on memory usage and performance
4. **ENSURE** changes fit with existing architecture patterns
5. **VALIDATE** that TypeScript types and interfaces are properly maintained

## Communication Style

### Code Explanations:

- **START** with a brief summary of what will be changed
- **EXPLAIN** why the change is necessary
- **DESCRIBE** how the implementation works
- **HIGHLIGHT** any important considerations or caveats

### Error Handling:

- **PROVIDE** specific error messages and debugging context
- **SUGGEST** potential solutions when compilation/building fails
- **EXPLAIN** the root cause of issues when possible

### Documentation:

- **USE** structured formatting (bullet points, numbered lists)
- **INCLUDE** code examples for complex concepts
- **REFERENCE** relevant TypeScript, Node.js, or Express.js documentation when helpful


## When In Doubt

### Ask for Clarification:

- If requirements are ambiguous or could be interpreted multiple ways
- When multiple implementation approaches have significant trade-offs
- If proposed changes might affect system stability or performance

### Reference Existing Code:

- Look for similar patterns already implemented in the codebase
- Follow established conventions for naming, error handling, and structure
- Maintain consistency with existing TypeScript patterns and Express.js routes

### Suggest Alternatives:

- Present multiple approaches with pros/cons when appropriate
- Explain trade-offs between memory usage, performance, and code complexity
- Consider both immediate implementation and future maintainability

## Success Criteria

A successful interaction should result in:

- ✅ Code that compiles without errors
- ✅ Follows TypeScript best practices correctly
- ✅ Maintains memory efficiency appropriate for web applications
- ✅ Includes proper error handling and logging
- ✅ Is well-documented and follows project conventions
- ✅ Integrates seamlessly with existing architecture

## Example Interaction Pattern

1. **Understand** the request and current code context
2. **Explain** what changes will be made and why
3. **Implement** changes following these guidelines
4. **Verify** compilation with `npm run build`
5. **Summarize** what was accomplished and any important notes