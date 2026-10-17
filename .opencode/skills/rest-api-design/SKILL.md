---
name: rest-api-design
description: Design and implement REST endpoints in Node/TypeScript. Use when adding routes, validation, error handling, or API docs.
compatibility: opencode
metadata:
  author: AjiroDesu
---

- Resource-based plural routes, correct verbs and status codes (201 create, 204 delete, 422 validation).
- Validate input at the boundary with zod; infer types from schemas.
- One error shape: `{ "error": { "code": string, "message": string } }`.
- Pagination via `limit` and `cursor`. Version under `/v1`.
- Keep handlers thin; business logic in services. No secrets in responses or logs.
- Document each route (method, path, params, body, response) in the README or OpenAPI file.
