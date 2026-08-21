#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else "app")
openai = root / "src/api/openai.ts"
server_store = root / "src/store/ServerStore.ts"
remote_sheet = root / "src/components/RemoteModelSheet/RemoteModelSheet.tsx"
server_types = root / "src/utils/serverTypes.ts"


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor in {path}, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


# ---------------------------------------------------------------------------
# OpenAI-compatible transport + native Anthropic protocol routing.
# ---------------------------------------------------------------------------
replace_once(
    openai,
    "import {SSEParser} from './sseParser';\n",
    "import {SSEParser} from './sseParser';\n"
    "import {\n"
    "  fetchAnthropicModelsWithHeaders,\n"
    "  streamAnthropicMessages,\n"
    "  usesAnthropicProtocol,\n"
    "} from './anthropic';\n",
    "Anthropic transport import",
)

replace_once(
    openai,
    "function buildHeaders(apiKey?: string): Record<string, string> {\n"
    "  const headers: Record<string, string> = {\n"
    "    'Content-Type': 'application/json',\n"
    "  };\n"
    "  if (apiKey) {\n"
    "    headers.Authorization = `Bearer ${apiKey}`;\n"
    "  }\n"
    "  return headers;\n"
    "}\n",
    "function buildHeaders(\n"
    "  apiKey?: string,\n"
    "  serverUrl?: string,\n"
    "): Record<string, string> {\n"
    "  const headers: Record<string, string> = {\n"
    "    'Content-Type': 'application/json',\n"
    "  };\n"
    "  if (apiKey) {\n"
    "    headers.Authorization = `Bearer ${apiKey}`;\n"
    "  }\n"
    "  try {\n"
    "    if (serverUrl && new URL(serverUrl).hostname.endsWith('openrouter.ai')) {\n"
    "      headers['HTTP-Referer'] = 'https://github.com/mishaqp/PocketPal-Root-Agent';\n"
    "      headers['X-Title'] = 'PocketPal Root Agent';\n"
    "    }\n"
    "  } catch {\n"
    "    // URL validation is handled by the caller/UI.\n"
    "  }\n"
    "  return headers;\n"
    "}\n",
    "OpenRouter request headers",
)

replace_once(
    openai,
    "function normalizeUrl(serverUrl: string): string {\n"
    "  return serverUrl.replace(/\\/+$/, '');\n"
    "}\n",
    "function normalizeUrl(serverUrl: string): string {\n"
    "  return serverUrl.replace(/\\/+$/, '');\n"
    "}\n\n"
    "/** Append an OpenAI v1 path without producing /v1/v1 for hosted APIs. */\n"
    "function openAIV1Url(serverUrl: string, path: string): string {\n"
    "  const base = normalizeUrl(serverUrl);\n"
    "  const cleanPath = path.replace(/^\\/+/, '');\n"
    "  return base.endsWith('/v1')\n"
    "    ? `${base}/${cleanPath}`\n"
    "    : `${base}/v1/${cleanPath}`;\n"
    "}\n",
    "OpenAI v1 URL normalizer",
)

replace_once(
    openai,
    "export async function fetchModelsWithHeaders(\n"
    "  serverUrl: string,\n"
    "  apiKey?: string,\n"
    "  timeoutMs?: number,\n"
    "): Promise<FetchModelsResult> {\n"
    "  const url = `${normalizeUrl(serverUrl)}/v1/models`;\n",
    "export async function fetchModelsWithHeaders(\n"
    "  serverUrl: string,\n"
    "  apiKey?: string,\n"
    "  timeoutMs?: number,\n"
    "  serverType?: string,\n"
    "): Promise<FetchModelsResult> {\n"
    "  if (usesAnthropicProtocol(serverType)) {\n"
    "    return fetchAnthropicModelsWithHeaders(serverUrl, apiKey, timeoutMs);\n"
    "  }\n"
    "  const url = openAIV1Url(serverUrl, 'models');\n",
    "provider-aware model discovery",
)

# There are two fetch()-based OpenAI-compatible calls (models + props). Both
# have serverUrl in scope, so send it to buildHeaders for OpenRouter metadata.
text = openai.read_text(encoding="utf-8")
text = text.replace("headers: buildHeaders(apiKey),", "headers: buildHeaders(apiKey, serverUrl),")
text = text.replace("const headers = buildHeaders(apiKey);", "const headers = buildHeaders(apiKey, serverUrl);")
openai.write_text(text, encoding="utf-8")

replace_once(
    openai,
    "export async function fetchModels(\n"
    "  serverUrl: string,\n"
    "  apiKey?: string,\n"
    "  timeoutMs?: number,\n"
    "): Promise<RemoteModelInfo[]> {\n"
    "  const {models} = await fetchModelsWithHeaders(serverUrl, apiKey, timeoutMs);\n",
    "export async function fetchModels(\n"
    "  serverUrl: string,\n"
    "  apiKey?: string,\n"
    "  timeoutMs?: number,\n"
    "  serverType?: string,\n"
    "): Promise<RemoteModelInfo[]> {\n"
    "  const {models} = await fetchModelsWithHeaders(\n"
    "    serverUrl,\n"
    "    apiKey,\n"
    "    timeoutMs,\n"
    "    serverType,\n"
    "  );\n",
    "provider-aware fetchModels",
)

replace_once(
    openai,
    "export async function testConnection(\n"
    "  serverUrl: string,\n"
    "  apiKey?: string,\n"
    "  timeoutMs?: number,\n"
    "): Promise<{ok: boolean; modelCount: number; error?: string}> {\n"
    "  try {\n"
    "    const models = await fetchModels(serverUrl, apiKey, timeoutMs);\n",
    "export async function testConnection(\n"
    "  serverUrl: string,\n"
    "  apiKey?: string,\n"
    "  timeoutMs?: number,\n"
    "  serverType?: string,\n"
    "): Promise<{ok: boolean; modelCount: number; error?: string}> {\n"
    "  try {\n"
    "    const models = await fetchModels(serverUrl, apiKey, timeoutMs, serverType);\n",
    "provider-aware connection test",
)

replace_once(
    openai,
    "    case 'OpenAI':\n"
    "      return effort ? {reasoning_effort: effort} : {};\n",
    "    case 'OpenRouter':\n"
    "      if (!enabled) {\n"
    "        return {reasoning: {enabled: false}};\n"
    "      }\n"
    "      return effort\n"
    "        ? {reasoning: {effort}}\n"
    "        : {reasoning: {enabled: true}};\n"
    "    case 'OpenAI':\n"
    "      return effort ? {reasoning_effort: effort} : {};\n",
    "OpenRouter reasoning payload",
)

replace_once(
    openai,
    "  const url = `${normalizeUrl(serverUrl)}/v1/chat/completions`;\n"
    "  const connectionTimeoutMs = resolveTimeout(timeoutMs, CONNECTION_TIMEOUT_MS);\n",
    "  if (usesAnthropicProtocol(serverType)) {\n"
    "    return streamAnthropicMessages(\n"
    "      params,\n"
    "      serverUrl,\n"
    "      apiKey,\n"
    "      signal,\n"
    "      onToken,\n"
    "      timeoutMs,\n"
    "    );\n"
    "  }\n\n"
    "  const url = openAIV1Url(serverUrl, 'chat/completions');\n"
    "  const connectionTimeoutMs = resolveTimeout(timeoutMs, CONNECTION_TIMEOUT_MS);\n",
    "Anthropic stream routing",
)

# ---------------------------------------------------------------------------
# ServerStore: preserve protocol selection for discovery and tests.
# ---------------------------------------------------------------------------
replace_once(
    server_store,
    "      const models = await fetchModels(\n"
    "        server.url,\n"
    "        apiKey,\n"
    "        server.requestTimeoutMs,\n"
    "      );\n",
    "      const models = await fetchModels(\n"
    "        server.url,\n"
    "        apiKey,\n"
    "        server.requestTimeoutMs,\n"
    "        server.serverType,\n"
    "      );\n",
    "ServerStore provider-aware model fetch",
)

replace_once(
    server_store,
    "    return testConnection(server.url, apiKey, server.requestTimeoutMs);\n",
    "    return testConnection(\n"
    "      server.url,\n"
    "      apiKey,\n"
    "      server.requestTimeoutMs,\n"
    "      server.serverType,\n"
    "    );\n",
    "ServerStore provider-aware connection test",
)

# ---------------------------------------------------------------------------
# Provider types + host seeding.
# ---------------------------------------------------------------------------
replace_once(
    server_types,
    "  'OpenAI',\n"
    "  'vLLM',\n"
    "  'unknown',\n",
    "  'OpenAI',\n"
    "  'OpenRouter',\n"
    "  'Anthropic',\n"
    "  'DeepSeek',\n"
    "  'VibeCode',\n"
    "  'vLLM',\n"
    "  'unknown',\n",
    "multi-provider server type options",
)

replace_once(
    server_types,
    "    if (new URL(url).hostname.endsWith('api.openai.com')) {\n"
    "      return 'OpenAI';\n"
    "    }\n",
    "    const host = new URL(url).hostname.toLowerCase();\n"
    "    if (host.endsWith('api.openai.com')) return 'OpenAI';\n"
    "    if (host.endsWith('openrouter.ai')) return 'OpenRouter';\n"
    "    if (host.endsWith('api.anthropic.com')) return 'Anthropic';\n"
    "    if (host.endsWith('api.deepseek.com')) return 'DeepSeek';\n"
    "    if (host === 'vibecode.moe' || host.endsWith('.vibecode.moe')) {\n"
    "      return 'VibeCode';\n"
    "    }\n",
    "provider hostname seeding",
)

# ---------------------------------------------------------------------------
# Remote model sheet: provider presets + manual model ID fallback.
# ---------------------------------------------------------------------------
replace_once(
    remote_sheet,
    "    const [selectedModelId, setSelectedModelId] = useState<string | null>(null);\n",
    "    const [selectedModelId, setSelectedModelId] = useState<string | null>(null);\n"
    "    const [manualModelId, setManualModelId] = useState('');\n",
    "manual model state",
)

replace_once(
    remote_sheet,
    "    const timeoutSecondsRef = useRef(timeoutSeconds);\n"
    "    useEffect(() => {\n"
    "      timeoutSecondsRef.current = timeoutSeconds;\n"
    "    }, [timeoutSeconds]);\n",
    "    const timeoutSecondsRef = useRef(timeoutSeconds);\n"
    "    useEffect(() => {\n"
    "      timeoutSecondsRef.current = timeoutSeconds;\n"
    "    }, [timeoutSeconds]);\n\n"
    "    const serverTypeRef = useRef(serverType);\n"
    "    useEffect(() => {\n"
    "      serverTypeRef.current = serverType;\n"
    "    }, [serverType]);\n",
    "server type ref",
)

replace_once(
    remote_sheet,
    "        setServerType('unknown');\n"
    "        setSecureTextEntry(true);\n",
    "        setServerType('unknown');\n"
    "        serverTypeRef.current = 'unknown';\n"
    "        setSecureTextEntry(true);\n",
    "reset provider type",
)

replace_once(
    remote_sheet,
    "        setSelectedModelId(null);\n"
    "        setSelectedServerId(null);\n",
    "        setSelectedModelId(null);\n"
    "        setManualModelId('');\n"
    "        setSelectedServerId(null);\n",
    "reset manual model",
)

replace_once(
    remote_sheet,
    "          const {models, headers} = await fetchModelsWithHeaders(\n"
    "            trimmedUrl,\n"
    "            key,\n"
    "            timeoutMs,\n"
    "          );\n",
    "          const {models, headers} = await fetchModelsWithHeaders(\n"
    "            trimmedUrl,\n"
    "            key,\n"
    "            timeoutMs,\n"
    "            serverTypeRef.current,\n"
    "          );\n",
    "provider-aware remote probe",
)

replace_once(
    remote_sheet,
    "          const detected = await detectServerType(trimmedUrl, models, headers);\n"
    "          setServerType(seedServerType(detected, trimmedUrl));\n",
    "          const detected = await detectServerType(trimmedUrl, models, headers);\n"
    "          const effectiveType =\n"
    "            serverTypeRef.current !== 'unknown'\n"
    "              ? serverTypeRef.current\n"
    "              : seedServerType(detected, trimmedUrl);\n"
    "          serverTypeRef.current = effectiveType;\n"
    "          setServerType(effectiveType);\n",
    "preserve explicit provider protocol",
)

replace_once(
    remote_sheet,
    "      setServerName(server.name);\n"
    "      setUrl(server.url);\n"
    "      setIsProbing(true);\n",
    "      setServerName(server.name);\n"
    "      setUrl(server.url);\n"
    "      const configuredType = server.serverType ?? 'unknown';\n"
    "      setServerType(configuredType);\n"
    "      serverTypeRef.current = configuredType;\n"
    "      setIsProbing(true);\n",
    "restore known provider type",
)

replace_once(
    remote_sheet,
    "        const models = await fetchModels(\n"
    "          server.url,\n"
    "          key || undefined,\n"
    "          server.requestTimeoutMs,\n"
    "        );\n",
    "        const models = await fetchModels(\n"
    "          server.url,\n"
    "          key || undefined,\n"
    "          server.requestTimeoutMs,\n"
    "          server.serverType,\n"
    "        );\n",
    "known provider model fetch",
)

replace_once(
    remote_sheet,
    "    const handleDeepSeekPreset = useCallback(() => {\n"
    "      setSelectedServerId(null);\n"
    "      setUrl('https://api.deepseek.com');\n"
    "      setServerName('DeepSeek');\n"
    "      setServerType('OpenAI');\n"
    "      setApiKey('');\n"
    "      apiKeyRef.current = '';\n"
    "      setProbeResult(null);\n"
    "      setAvailableModels([]);\n"
    "      setSelectedModelId(null);\n"
    "      setUrlError('');\n"
    "    }, []);\n",
    "    const applyProviderPreset = useCallback(\n"
    "      (name: string, presetUrl: string, type: string) => {\n"
    "        setSelectedServerId(null);\n"
    "        setUrl(presetUrl);\n"
    "        setServerName(name);\n"
    "        setServerType(type);\n"
    "        serverTypeRef.current = type;\n"
    "        setApiKey('');\n"
    "        apiKeyRef.current = '';\n"
    "        setProbeResult(null);\n"
    "        setAvailableModels([]);\n"
    "        setSelectedModelId(null);\n"
    "        setManualModelId('');\n"
    "        setUrlError('');\n"
    "      },\n"
    "      [],\n"
    "    );\n",
    "generic provider preset handler",
)

replace_once(
    remote_sheet,
    "    const handleAddModel = useCallback(async () => {\n"
    "      if (!selectedModelId) {\n"
    "        return;\n"
    "      }\n"
    "      setIsSaving(true);\n",
    "    const handleAddModel = useCallback(async () => {\n"
    "      const effectiveModelId = selectedModelId || manualModelId.trim();\n"
    "      if (!effectiveModelId || !url.trim() || !serverName.trim()) {\n"
    "        return;\n"
    "      }\n"
    "      setIsSaving(true);\n",
    "manual or discovered model selection",
)

replace_once(
    remote_sheet,
    "        serverStore.addUserSelectedModel(serverId, selectedModelId);\n",
    "        serverStore.addUserSelectedModel(serverId, effectiveModelId);\n",
    "save manual model id",
)

replace_once(
    remote_sheet,
    "      selectedModelId,\n"
    "      selectedServerId,\n",
    "      selectedModelId,\n"
    "      manualModelId,\n"
    "      selectedServerId,\n",
    "manual model callback dependency",
)

replace_once(
    remote_sheet,
    "    const showServerFields =\n"
    "      probeResult !== null && !isProbing && !selectedServerId;\n",
    "    const showServerFields =\n"
    "      !selectedServerId &&\n"
    "      ((probeResult !== null && !isProbing) || serverName.trim().length > 0);\n",
    "show provider fields before first successful probe",
)

replace_once(
    remote_sheet,
    "          {!selectedServerId && (\n"
    "            <View style={styles.chipsSection}>\n"
    "              <Text style={styles.chipsSectionLabel}>\n"
    "                {l10n.settings.providerPresets}\n"
    "              </Text>\n"
    "              <View style={styles.chipsRow}>\n"
    "                <Chip\n"
    "                  testID=\"provider-preset-deepseek\"\n"
    "                  selected={url === 'https://api.deepseek.com'}\n"
    "                  onPress={handleDeepSeekPreset}>\n"
    "                  DeepSeek\n"
    "                </Chip>\n"
    "              </View>\n"
    "            </View>\n"
    "          )}\n",
    "          {!selectedServerId && (\n"
    "            <View style={styles.chipsSection}>\n"
    "              <Text style={styles.chipsSectionLabel}>\n"
    "                {l10n.settings.providerPresets}\n"
    "              </Text>\n"
    "              <View style={styles.chipsRow}>\n"
    "                <Chip\n"
    "                  testID=\"provider-preset-openai\"\n"
    "                  selected={serverName === 'OpenAI'}\n"
    "                  onPress={() =>\n"
    "                    applyProviderPreset('OpenAI', 'https://api.openai.com', 'OpenAI')\n"
    "                  }>\n"
    "                  OpenAI\n"
    "                </Chip>\n"
    "                <Chip\n"
    "                  testID=\"provider-preset-openrouter\"\n"
    "                  selected={serverName === 'OpenRouter'}\n"
    "                  onPress={() =>\n"
    "                    applyProviderPreset(\n"
    "                      'OpenRouter',\n"
    "                      'https://openrouter.ai/api/v1',\n"
    "                      'OpenRouter',\n"
    "                    )\n"
    "                  }>\n"
    "                  OpenRouter\n"
    "                </Chip>\n"
    "                <Chip\n"
    "                  testID=\"provider-preset-deepseek\"\n"
    "                  selected={serverName === 'DeepSeek'}\n"
    "                  onPress={() =>\n"
    "                    applyProviderPreset(\n"
    "                      'DeepSeek',\n"
    "                      'https://api.deepseek.com',\n"
    "                      'DeepSeek',\n"
    "                    )\n"
    "                  }>\n"
    "                  DeepSeek\n"
    "                </Chip>\n"
    "                <Chip\n"
    "                  testID=\"provider-preset-anthropic\"\n"
    "                  selected={serverName === 'Anthropic'}\n"
    "                  onPress={() =>\n"
    "                    applyProviderPreset(\n"
    "                      'Anthropic',\n"
    "                      'https://api.anthropic.com',\n"
    "                      'Anthropic',\n"
    "                    )\n"
    "                  }>\n"
    "                  Claude\n"
    "                </Chip>\n"
    "                <Chip\n"
    "                  testID=\"provider-preset-vibecode\"\n"
    "                  selected={serverName === 'VibeCode'}\n"
    "                  onPress={() =>\n"
    "                    applyProviderPreset('VibeCode', '', 'VibeCode')\n"
    "                  }>\n"
    "                  VibeCode\n"
    "                </Chip>\n"
    "                <Chip\n"
    "                  testID=\"provider-preset-custom-openai\"\n"
    "                  selected={serverName === 'Custom OpenAI'}\n"
    "                  onPress={() =>\n"
    "                    applyProviderPreset('Custom OpenAI', '', 'OpenAI')\n"
    "                  }>\n"
    "                  Custom OpenAI\n"
    "                </Chip>\n"
    "                <Chip\n"
    "                  testID=\"provider-preset-custom-anthropic\"\n"
    "                  selected={serverName === 'Custom Anthropic'}\n"
    "                  onPress={() =>\n"
    "                    applyProviderPreset('Custom Anthropic', '', 'Anthropic')\n"
    "                  }>\n"
    "                  Custom Anthropic\n"
    "                </Chip>\n"
    "              </View>\n"
    "              {serverName === 'VibeCode' ? (\n"
    "                <Text style={styles.apiKeyDescription}>\n"
    "                  Вставь API Base URL из панели VibeCode. Адрес намеренно не\n"
    "                  зашит в приложение.\n"
    "                </Text>\n"
    "              ) : null}\n"
    "            </View>\n"
    "          )}\n",
    "multi-provider preset UI",
)

replace_once(
    remote_sheet,
    "                  options={SERVER_TYPE_DROPDOWN_OPTIONS}\n"
    "                  onChange={setServerType}\n",
    "                  options={SERVER_TYPE_DROPDOWN_OPTIONS}\n"
    "                  onChange={value => {\n"
    "                    serverTypeRef.current = value;\n"
    "                    setServerType(value);\n"
    "                  }}\n",
    "provider type dropdown ref",
)

replace_once(
    remote_sheet,
    "          {/* Model Selection */}\n",
    "          {showServerFields && (\n"
    "            <View style={styles.inputSpacing}>\n"
    "              <TextInput\n"
    "                testID=\"remote-manual-model-input\"\n"
    "                label=\"Model ID вручную (необязательно)\"\n"
    "                value={manualModelId}\n"
    "                onChangeText={text => {\n"
    "                  setManualModelId(text);\n"
    "                  if (text.trim()) setSelectedModelId(null);\n"
    "                }}\n"
    "                placeholder=\"например claude-sonnet-4-20250514\"\n"
    "                autoCapitalize=\"none\"\n"
    "                autoCorrect={false}\n"
    "              />\n"
    "              <Text style={styles.apiKeyDescription}>\n"
    "                Нужен для шлюзов, которые не отдают список моделей через API.\n"
    "              </Text>\n"
    "            </View>\n"
    "          )}\n\n"
    "          {/* Model Selection */}\n",
    "manual model ID field",
)

replace_once(
    remote_sheet,
    "              disabled={\n"
    "                isSaving || !selectedModelId || availableModels.length === 0\n"
    "              }\n",
    "              disabled={\n"
    "                isSaving ||\n"
    "                !(selectedModelId || manualModelId.trim()) ||\n"
    "                !url.trim() ||\n"
    "                !serverName.trim()\n"
    "              }\n",
    "allow manual provider model add",
)

print('Applied Multi-Provider API v1 (OpenAI/OpenRouter/DeepSeek/Anthropic/VibeCode/custom)')
