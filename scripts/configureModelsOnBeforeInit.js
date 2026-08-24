import org.json.JSONObject;

// configure-ai-models addon — settings.fields index map:
// 0: currentModels (displayfield)
// 1: apiKeyHint (displayfield)
// 2: provider (list)
// 3: model (list)
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

function buildStatusMarkup(statusObj, providerModels) {
    var parts = [];
    var defaultModel = readDefaultModel(statusObj);

    if (defaultModel) {
        parts.push("<b>Current default model:</b> " + defaultModel);
    } else {
        parts.push("<b>Current default model:</b> not set");
    }

    if (providerModels && providerModels.length) {
        parts.push("<b>Models for selected provider:</b> " + providerModels.length);
    } else {
        parts.push("No models returned for the selected provider yet.");
    }

    return parts.join("<br/><br/>");
}

function buildModelValues(listJson) {
    var values = [{ value: "auto", caption: "Auto-select (recommended)" }];
    var data = null;
    var models = [];
    var seen = { auto: true };
    var i;
    var model;
    var key;
    var caption;

    try {
        data = toNative(new JSONObject(String(listJson || "{}")));
    } catch (e) {
        return values;
    }

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

var defaultModel = "";
var currentProvider = "";
var selectedProvider = (fields[2] && fields[2].default) || "openai";
var providerId = PROVIDER_ID[selectedProvider] || "openai";
var statusCmd = "docker exec openclaw sh -lc 'openclaw models status --json 2>/dev/null || echo {}'";
var listCmd = "docker exec openclaw sh -lc 'openclaw models list --json --provider " + providerId + " 2>/dev/null || echo {}'";

var respStatus = execOnCp(statusCmd);
if (respStatus.result != 0) return respStatus;

var respList = execOnCp(listCmd);
if (respList.result != 0) return respList;

var statusJson = String(readCommandOutput(respStatus) || "{}").trim();
var listJson = String(readCommandOutput(respList) || "{}").trim();
var statusObj = null;
var providerModels = [];

try {
    statusObj = toNative(new JSONObject(statusJson));
} catch (e) {
    statusObj = null;
}

try {
    providerModels = toNative(new JSONObject(listJson)).models || [];
} catch (e2) {
    providerModels = [];
}

defaultModel = readDefaultModel(statusObj);
currentProvider = providerFromModel(defaultModel);
if (currentProvider) {
    selectedProvider = currentProvider;
    providerId = PROVIDER_ID[selectedProvider] || providerId;
    if (currentProvider !== ((fields[2] && fields[2].default) || "")) {
        listCmd = "docker exec openclaw sh -lc 'openclaw models list --json --provider " + providerId + " 2>/dev/null || echo {}'";
        respList = execOnCp(listCmd);
        if (respList.result != 0) return respList;
        listJson = String(readCommandOutput(respList) || "{}").trim();
        try {
            providerModels = toNative(new JSONObject(listJson)).models || [];
        } catch (e3) {
            providerModels = [];
        }
    }
}

if (fields[0]) {
    fields[0].markup = buildStatusMarkup(statusObj, providerModels);
    fields[0].cls = "info";
}

if (fields[2]) {
    fields[2].default = selectedProvider;
}

if (fields[3]) {
    fields[3].values = buildModelValues(listJson);
    if (defaultModel && providerFromModel(defaultModel) === selectedProvider) {
        fields[3].default = defaultModel;
    } else {
        fields[3].default = "auto";
    }
}

return settings;
