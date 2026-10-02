import org.json.JSONObject;

// configure-ai-models addon — settings.fields index map:
// 0: currentModels (displayfield)
// 1: apiKeyHint (displayfield)
// 2: provider (list)
// 3: model (list, dependsOn provider)
// 4: apiKey (string)

var fields = settings.fields || [];

var PROVIDER_PREFIX = {
    openai: "openai/",
    openrouter: "openrouter/",
    anthropic: "anthropic/",
    gemini: "google/",
    grok: "xai/"
};

var PROVIDER_ID = {
    openai: "openai",
    openrouter: "openrouter",
    anthropic: "anthropic",
    gemini: "google",
    grok: "xai"
};

var PROVIDER_KEYS = ["openai", "openrouter", "anthropic", "gemini", "grok"];

function execOnCp(command) {
    return api.env.control.ExecCmdById(
        "${env.name}",
        session,
        ${targetNodes.master.id},
        toJSON([{ command: command, params: "" }]),
        false,
        "root"
    );
}

function readCommandOutput(resp) {
    if (!resp || !resp.responses || !resp.responses.length) {
        return "";
    }
    return String(resp.responses[0].out || "");
}

function readDefaultModel(statusObj) {
    if (!statusObj) return "";

    if (statusObj.defaultModel) return String(statusObj.defaultModel);
    if (statusObj.resolvedDefault) return String(statusObj.resolvedDefault);
    if (statusObj.default) return String(statusObj.default);
    if (statusObj.model) return String(statusObj.model);
    if (statusObj.primary) return String(statusObj.primary);
    return "";
}

function providerFromModel(modelId) {
    var id = String(modelId || "");
    var key;

    for (key in PROVIDER_PREFIX) {
        if (!PROVIDER_PREFIX.hasOwnProperty(key)) continue;
        if (id.indexOf(PROVIDER_PREFIX[key]) === 0) {
            return key;
        }
    }

    return "";
}

function buildStatusMarkup(totalModels) {
    return "Loaded model catalogs: " + totalModels + " entries across providers.";
}

function buildModelValuesFromData(data) {
    var models = [];
    var values = [];
    var seen = {};
    var i;
    var model;
    var key;
    var caption;

    if (data && data.models && data.models.length) {
        models = data.models;
    }

    for (i = 0; i < models.length; i++) {
        model = models[i];
        if (!model || !model.key) continue;
        key = String(model.key);
        if (seen[key]) continue;
        seen[key] = true;
        caption = model.name ? String(model.name) + " (" + key + ")" : key;
        if (model.available === false) {
            caption = caption + " (needs API key)";
        }
        values.push({ value: key, caption: caption });
    }

    return values;
}

function buildModelValues(listJson) {
    try {
        return buildModelValuesFromData(toNative(new JSONObject(String(listJson || "{}"))));
    } catch (e) {
        return [];
    }
}

function extractJsonObject(text) {
    var raw = String(text || "");
    var start = raw.indexOf("{");
    var end = raw.lastIndexOf("}");
    if (start < 0 || end < start) return "";
    return raw.substring(start, end + 1);
}

// models list omits OpenRouter and xAI until an API key exists.
// Their selectable models still ship in the installed OpenClaw package.
var bundledCatalogs = null;

function readBundledCatalogs() {
    var bundledCmd = "docker exec openclaw node --input-type=module -e '" +
        "const out={};" +
        "function modelKey(providerId,modelId){const p=String(providerId||\"\").trim();const m=String(modelId||\"\").trim();if(!p)return m;if(!m)return p;return m.toLowerCase().startsWith(p.toLowerCase()+\"/\")?m:p+\"/\"+m;}" +
        "try{const {buildXaiCatalogModels}=await import(\"/usr/local/lib/node_modules/openclaw/dist/extensions/xai/model-definitions.js\");out.grok={models:buildXaiCatalogModels().map((model)=>({key:modelKey(\"xai\",model.id),name:model.name,available:false}))}}catch(e){}" +
        "try{const {buildOpenrouterProvider}=await import(\"/usr/local/lib/node_modules/openclaw/dist/extensions/openrouter/provider-catalog.js\");out.openrouter={models:buildOpenrouterProvider().models.map((model)=>({key:modelKey(\"openrouter\",model.id),name:model.name,available:false}))}}catch(e){}" +
        "process.stdout.write(JSON.stringify(out));" +
        "' 2>/dev/null || echo {}";
    var resp = execOnCp(bundledCmd);
    var json;

    if (!resp || resp.result != 0) return {};
    json = extractJsonObject(readCommandOutput(resp));
    if (!json) return {};

    try {
        return toNative(new JSONObject(json)) || {};
    } catch (e) {
        return {};
    }
}

function bundledModelValues(providerKey) {
    var entry;

    if (providerKey !== "openrouter" && providerKey !== "grok") return [];
    if (!bundledCatalogs) bundledCatalogs = readBundledCatalogs();
    entry = providerKey === "grok" ? bundledCatalogs.grok : bundledCatalogs.openrouter;
    if (!entry) return [];
    return buildModelValuesFromData(entry);
}

function listHasModel(providerList, modelId) {
    var i;

    if (!providerList || !modelId) return false;

    for (i = 0; i < providerList.length; i++) {
        if (providerList[i] && providerList[i].value === modelId) {
            return true;
        }
    }

    return false;
}

function setWarning(markup) {
    if (!fields[0]) return;
    fields[0].markup = markup;
    fields[0].cls = "warning";
}

var containerCheckCmd = "docker inspect -f '{{.State.Running}}' openclaw 2>/dev/null || echo false";
var respCheck = execOnCp(containerCheckCmd);
if (respCheck.result != 0) return respCheck;

if (String(readCommandOutput(respCheck)).trim() !== "true") {
    setWarning("OpenClaw container is not running. Start the environment before configuring models.");
    return settings;
}

var statusCmd = "docker exec openclaw sh -lc 'openclaw models status --json 2>/dev/null || echo {}'";
var respStatus = execOnCp(statusCmd);
if (respStatus.result != 0) return respStatus;

var statusJson = String(readCommandOutput(respStatus) || "{}").trim();
var statusObj = null;
var modelsByProvider = {};
var totalModels = 0;
var defaultModel = "";
var selectedProvider = "openai";
var providerList = [];
var i;
var providerKey;
var providerId;
var listCmd;
var respList;
var listJson;

try {
    statusObj = toNative(new JSONObject(statusJson));
} catch (e) {
    statusObj = null;
}

defaultModel = readDefaultModel(statusObj);
if (providerFromModel(defaultModel)) {
    selectedProvider = providerFromModel(defaultModel);
}

for (i = 0; i < PROVIDER_KEYS.length; i++) {
    providerKey = PROVIDER_KEYS[i];
    providerId = PROVIDER_ID[providerKey];
    listCmd = "docker exec openclaw sh -lc 'openclaw models list --json --provider " + providerId + " 2>/dev/null || echo {}'";
    respList = execOnCp(listCmd);
    if (respList.result != 0) return respList;
    listJson = String(readCommandOutput(respList) || "{}").trim();
    modelsByProvider[providerKey] = buildModelValues(listJson);
    if (!modelsByProvider[providerKey].length) {
        modelsByProvider[providerKey] = bundledModelValues(providerKey);
    }
    totalModels += modelsByProvider[providerKey].length;
}

providerList = modelsByProvider[selectedProvider] || [];

if (fields[0]) {
    fields[0].markup = buildStatusMarkup(totalModels);
    fields[0].cls = "info";
}

if (fields[2]) {
    fields[2].default = selectedProvider;
}

if (fields[3]) {
    fields[3].dependsOn = { provider: modelsByProvider };
    fields[3].values = providerList;
    if (listHasModel(providerList, defaultModel)) {
        fields[3].default = defaultModel;
    }
}

return settings;
