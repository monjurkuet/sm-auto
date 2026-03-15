# Architecture

## Layers
- `browser`: attaches to Chrome and manages tabs/pages
- `capture`: records sanitized GraphQL response fragments
- `extractors`: owns navigation and collection flow for each Facebook surface
- `parsers`: pure DOM and GraphQL parsing functions
- `normalizers`: merges partial data into stable result contracts
- `storage`: writes outputs and optional artifacts

## Key rule
GraphQL capture is shared infrastructure. Surface-specific assumptions belong in parsers and extractors, not in the transport layer.
