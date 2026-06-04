import Anthropic from "@anthropic-ai/sdk";

// Lazily build the client on first use, AFTER .env is loaded - so a module-level
// caller can't capture a missing API key at import time.
let _client: Anthropic | undefined;
export const anthropic = (): Anthropic => (_client ??= new Anthropic());
