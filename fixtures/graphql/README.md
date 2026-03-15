Store sanitized GraphQL payload fixtures here.

Rules:
- redact `fb_dtsg`, `lsd`, user ids, and other session fields
- keep one file per surface
- prefer minimal payloads that still exercise parser logic
