# agent-scf

Plant care chat backend for TRT Nova.

## Current Scope

- `POST /agent/chat`
- Reads device latest/history from MySQL
- Returns rule-based diagnosis and suggestions
- Adds lightweight knowledge augmentation from `plant_library` and protocol snippets
- Read-only advice phase: no device command or todo action is executed from chat

## Structure

- `index.js`: SCF entry and route dispatch
- `lib/http.js`: HTTP event parsing and JSON response helper
- `lib/auth.js`: JWT/openid resolution
- `lib/db.js`: MySQL pool
- `lib/llmClient.js`: optional OpenAI-compatible chat API client
- `lib/safety.js`: read-only Agent safety metadata
- `tools/device.js`: device snapshot/history read tools
- `tools/plant.js`: plant profile search from `plant_library`
- `rules/plantDiagnosis.js`: sensor threshold diagnosis rules
- `rag/knowledgeSearch.js`: lightweight plant/protocol knowledge retrieval
- `agent/chatHandler.js`: chat intent handling and response assembly

## Optional Chat API

普通对话可以通过 OpenAI-compatible Chat Completions 服务试跑。未配置时，`/agent/chat` 会自动回退到本地规则助手。

Required environment variables:

- `LLM_API_ENABLED=true`
- `LLM_API_BASE_URL`
- `LLM_API_KEY`
- `LLM_MODEL`

Optional:

- `LLM_API_PATH=/v1/chat/completions`
- `LLM_TEMPERATURE=0.4`
- `LLM_MAX_TOKENS=500`
- `LLM_TIMEOUT_MS=12000`

## Deploy

1. Run `npm install` in this folder
2. Configure SCF environment variables
3. Upload this folder to SCF and set handler to `index.main` or `index.main_handler`
