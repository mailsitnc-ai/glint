/**
 * Provider registry for Glint : Caelix IDE.
 *
 * Every provider is spoken to through the OpenAI-compatible chat-completions
 * wire format, so a single code path covers nearly all of them.
 *
 * Auth styles:
 *   none         - works with no credentials
 *   optional     - works anonymously, better with a key
 *   required     - a key is mandatory
 */

const PROVIDERS = [
  /* ---------------------------------------------------------------- */
  /* Keyless                                                           */
  /* ---------------------------------------------------------------- */
  {
    id: 'kilo',
    label: 'Kilo Code Gateway',
    description: '470 models with 9 free tiers. Anonymous access works for :free models. Also supports FIM completions.',
    baseUrl: 'https://ai-gateway.kilo.ai/api/v1',
    auth: 'optional',
    keyField: 'kiloKey',
    docs: 'https://kilo.ai/docs/gateway',
    signup: 'https://kilo.ai',
    supportsFIM: true,
    fimEndpoint: '/fim/completions',
    defaultModel: 'nvidia/nemotron-3.5-lightning:free',
    freeModelSuffix: ':free',
    rateLimit: { requestsPerHour: 200, scope: 'ip' },
    extraHeaders: {
      'HTTP-Referer': 'https://github.com/mailsitnc-ai/glint',
      'X-OpenRouter-Title': 'Glint : Caelix IDE',
    },
    notes: 'Free models are tagged with ":free". FIM (fill-in-the-middle) requires an API key.',
  },
  {
    id: 'pollinations',
    label: 'Pollinations.ai',
    description: 'Zero setup, no key needed. Runs open-weight models for free. Anonymous text is limited to one request every 45 seconds.',
    baseUrl: 'https://text.pollinations.ai/openai',
    auth: 'optional',
    keyField: 'pollinationsKey',
    docs: 'https://pollinations.ai/docs',
    signup: 'https://enter.pollinations.ai',
    supportsFIM: false,
    defaultModel: 'openai',
    // Pollinations only exposes this one model on its anonymous tier.
    allowedModels: ['openai', 'openai-fast', 'gpt-oss', 'gpt-oss-20b', 'ovh-reasoning'],
    rateLimit: { minIntervalMs: 45000, scope: 'ip' },
    authHeader: 'both',
    notes: 'Anonymous requests are spaced 45 seconds apart. A free key from enter.pollinations.ai removes that limit.',
  },
  {
    id: 'zen',
    label: 'OpenCode Zen',
    description: '104 models including free flash models. No key needed for the model list; free models work anonymously.',
    baseUrl: 'https://opencode.ai/zen/v1',
    auth: 'optional',
    keyField: 'zenKey',
    docs: 'https://opencode.ai/zen',
    signup: 'https://opencode.ai/zen',
    supportsFIM: false,
    defaultModel: 'mimo-v2.6-flash-free',
    freeModelSuffix: '-free',
    rateLimit: { requestsPerHour: 100, scope: 'ip' },
    notes: 'Models ending in "-free" run without a key. Add a key for the paid catalogue.',
  },
  {
    id: 'coarena',
    label: 'CoArena',
    description: '20 frontier models (Claude, GPT, Gemini, DeepSeek). The model list is public; a key is needed to chat.',
    baseUrl: 'https://coarena.ai/api/v1',
    auth: 'optional',
    chatNeedsKey: true,
    keyField: 'coarenaKey',
    docs: 'https://coarena.ai/account/api',
    signup: 'https://coarena.ai/account/api',
    supportsFIM: false,
    defaultModel: 'deepseek-v4-1-flash-1017',
    editableBase: true,
    rateLimit: { requestsPerHour: 100, scope: 'ip' },
    notes: 'The model list is public without a key, but chatting requires one. Create a key at coarena.ai/account/api. The base URL is editable.',
  },

  /* ---------------------------------------------------------------- */
  /* Key required                                                      */
  /* ---------------------------------------------------------------- */
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'Unified gateway with 1,000 free-model requests per day and a free-model router that picks a free model automatically.',
    baseUrl: 'https://openrouter.ai/api/v1',
    auth: 'required',
    keyField: 'openrouterKey',
    docs: 'https://openrouter.ai/docs/quickstart',
    signup: 'https://openrouter.ai/keys',
    supportsFIM: false,
    defaultModel: 'openrouter/free',
    freeModelSuffix: ':free',
    rateLimit: { requestsPerDay: 1000, scope: 'account' },
    extraHeaders: {
      'HTTP-Referer': 'https://github.com/mailsitnc-ai/glint',
      'X-OpenRouter-Title': 'Glint : Caelix IDE',
    },
    notes: 'Use the model id "openrouter/free" to have OpenRouter route each request to a free model.',
  },
  {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    description: 'Fast inference for open models including Kimi, Mistral Large and Gemma 4. Free developer tier available.',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    auth: 'required',
    keyField: 'nvidiaKey',
    docs: 'https://docs.api.nvidia.com/',
    signup: 'https://build.nvidia.com/',
    supportsFIM: false,
    defaultModel: 'meta/muse-glimmer-30b',
    rateLimit: { requestsPerMinute: 40, scope: 'key' },
    notes: 'The model list is public, but inference requires a key from build.nvidia.com.',
  },
  {
    id: 'deepinfra',
    label: 'DeepInfra',
    description: 'Broad catalogue of 170+ open models with simple per-token pricing and a free tier.',
    baseUrl: 'https://api.deepinfra.com/v1/openai',
    auth: 'required',
    keyField: 'deepinfraKey',
    docs: 'https://deepinfra.com/docs/openai_api',
    signup: 'https://deepinfra.com/login',
    supportsFIM: false,
    defaultModel: 'Qwen/Qwen3.6-35B-A3B',
    rateLimit: { requestsPerMinute: 30, scope: 'key' },
    notes: 'Model ids are case sensitive, e.g. "Qwen/Qwen3.6-35B-A3B".',
  },
  {
    id: 'groq',
    label: 'Groq',
    description: 'Extremely fast inference on LPU hardware. Excellent for ghost text and fast autocomplete.',
    baseUrl: 'https://api.groq.com/openai/v1',
    auth: 'required',
    keyField: 'groqKey',
    docs: 'https://console.groq.com/docs/overview',
    signup: 'https://console.groq.com/keys',
    supportsFIM: false,
    defaultModel: 'llama-3.3-70b-versatile',
    rateLimit: { requestsPerMinute: 30, scope: 'key' },
    notes: 'Very low latency — the best choice for inline completions once a key is added.',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    description: 'Google AI Studio models with very large context windows and a generous free tier.',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    auth: 'required',
    keyField: 'geminiKey',
    docs: 'https://ai.google.dev/gemini-api/docs/openai',
    signup: 'https://aistudio.google.com/apikey',
    supportsFIM: false,
    defaultModel: 'gemini-2.5-pro',
    rateLimit: { requestsPerMinute: 15, scope: 'key' },
    notes: 'Keys look like "AIza…". Model listing uses the v1beta models endpoint.',
  },
  {
    id: 'numes',
    label: 'Numes',
    description: 'Additional model provider with an OpenAI-compatible API.',
    baseUrl: 'https://api.numes.ai/api/v1',
    auth: 'required',
    keyField: 'numesKey',
    docs: 'https://numes.ai/dashboard/keys',
    signup: 'https://numes.ai/dashboard/keys',
    supportsFIM: false,
    defaultModel: '',
    rateLimit: null,
    notes: 'Create a key at numes.ai/dashboard/keys.',
  },
  {
    id: 'abliteration',
    label: 'Abliteration AI',
    description: 'Uncensored-capable model provider with an OpenAI-compatible API.',
    baseUrl: 'https://api.abliteration.ai/v1',
    auth: 'required',
    keyField: 'abliterationKey',
    docs: 'https://abliteration.ai',
    signup: 'https://abliteration.ai',
    supportsFIM: false,
    defaultModel: '',
    rateLimit: null,
    notes: 'An alternative provider with relaxed content policies.',
  },

  /* ---------------------------------------------------------------- */
  /* Virtual / local                                                   */
  /* ---------------------------------------------------------------- */
  {
    id: 'omniroute',
    label: 'OmniRoute',
    description: 'Routes across your connected providers by objective. Picks the best model for coding, speed, quality or cost, and falls back automatically.',
    baseUrl: '',
    auth: 'optional',
    keyField: 'omnirouteKey',
    docs: 'https://github.com/mailsitnc-ai/glint',
    signup: null,
    supportsFIM: false,
    virtual: true,
    editableBase: true,
    defaultModel: 'auto',
    rateLimit: null,
    notes: 'Works with no key by routing across the providers you have connected. Point the base URL at a self-hosted OmniRoute server to use one.',
  },
  {
    id: 'local',
    label: 'Local (Ollama / LM Studio)',
    description: 'Run models on your own machine. Nothing leaves the computer.',
    baseUrl: 'http://127.0.0.1:11434',
    auth: 'none',
    keyField: '',
    docs: 'https://ollama.com/',
    signup: null,
    supportsFIM: false,
    defaultModel: 'llama3.2',
    rateLimit: null,
    notes: 'Any OpenAI-compatible local server works — point the endpoint at Ollama, LM Studio or llama.cpp.',
  },
  {
    id: 'custom',
    label: 'Custom OpenAI-compatible',
    description: 'Any endpoint that speaks the OpenAI chat-completions API.',
    baseUrl: 'https://api.openai.com/v1',
    auth: 'optional',
    keyField: 'customKey',
    docs: null,
    signup: null,
    supportsFIM: false,
    editableBase: true,
    defaultModel: 'gpt-4o-mini',
    rateLimit: null,
    notes: 'Use this for any other provider, including self-hosted gateways.',
  },
];

/** OmniRoute objectives available for routing. */
const OMNI_OBJECTIVES = [
  { id: 'auto', label: 'Auto', desc: 'Balances quality and speed across connected providers' },
  { id: 'auto/coding', label: 'Coding', desc: 'Prefers code-specialised models (Qwen Coder, Codestral, Devstral)' },
  { id: 'auto/smart', label: 'Quality', desc: 'Prefers the strongest reasoning models' },
  { id: 'auto/fast', label: 'Speed', desc: 'Prefers the lowest-latency models' },
  { id: 'auto/cheap', label: 'Cheapest', desc: 'Prefers free and inexpensive models' },
];

/** Look up a provider definition by id. */
function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id) || null;
}

/** Public, serialisable description of every provider (for the UI). */
function listProviders() {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    description: p.description,
    baseUrl: p.baseUrl,
    auth: p.auth,
    requiresKey: p.auth === 'required',
    supportsFIM: p.supportsFIM,
    virtual: !!p.virtual,
    editableBase: !!p.editableBase,
    defaultModel: p.defaultModel,
    freeModelSuffix: p.freeModelSuffix || null,
    authHeader: p.authHeader || 'bearer',
    chatNeedsKey: !!p.chatNeedsKey,
    allowedModels: p.allowedModels || null,
    keyField: p.keyField || null,
    docs: p.docs,
    signup: p.signup,
    notes: p.notes,
    rateLimit: p.rateLimit,
  }));
}

module.exports = { PROVIDERS, OMNI_OBJECTIVES, getProvider, listProviders };
