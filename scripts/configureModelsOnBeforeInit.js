import org.json.JSONObject;

// configure-ai-models addon — settings.fields index map:
// 0: currentModels (displayfield)
// 1: apiKeyHint (displayfield)
// 2: provider (list)
// 3: apiKey (string)
// 4: onboardAuthChoice (hidden list)
// 5: envVarName (hidden list)

var settings = jps.settings || { fields: [] };
var fields = settings.fields || (settings.main && settings.main.fields) || [];
var cpNodeId = ${nodes.cp.master.id};
var envName = "${env.name}";

var PROVIDER_PREFIX = {
    openai: "openai/",
    openrouter: "openrouter/",
    anthropic: "anthropic/",
    gemini: "google/",
    grok: "xai/"
};

function execOnCp(command) {
    return api.env.control.ExecCmdById(
        envName,
        session,
        cpNodeId,
        toJSON([{ command: command, params: "" }]),
        false,
        "root"
    );
}

function readDefaultModel(statusObj) {
    if (!statusObj) return "";

    if (statusObj.defaultModel) return String(statusObj.defaultModel);
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

function buildStatusMarkup(statusObj, configuredModels) {
    var parts = [];
    var defaultModel = readDefaultModel(statusObj);

    if (defaultModel) {
        parts.push("<b>Current default model:</b> " + defaultModel);
    } else {
        parts.push("<b>Current default model:</b> not set");
    }

    if (configuredModels) {
        parts.push("<b>Configured models:</b><br/>" + String(configuredModels).replace(/\n/g, "<br/>"));
    } else {
        parts.push("No configured models yet. Select a provider and add an API key below.");
    }

    return parts.join("<br/><br/>");
}

function setWarning(markup) {
    if (!fields[0]) return;
    fields[0].markup = markup;
    fields[0].cls = "warning";
}

var containerCheckCmd = "docker inspect -f '{{.State.Running}}' openclaw 2>/dev/null || echo false";
var respCheck = execOnCp(containerCheckCmd);
if (respCheck.result != 0) return respCheck;

if (String(respCheck.responses[0].out || "").trim() !== "true") {
    setWarning("OpenClaw container is not running. Start the environment before configuring models.");
    return { result: 0, settings: settings };
}

var listCmd = "docker exec openclaw sh -lc 'openclaw models list --plain 2>/dev/null || true'";
var statusCmd = "docker exec openclaw sh -lc 'openclaw models status --json 2>/dev/null || echo {}'";

var respList = execOnCp(listCmd);
if (respList.result != 0) return respList;

var respStatus = execOnCp(statusCmd);
if (respStatus.result != 0) return respStatus;

var configuredOut = String(respList.responses[0].out || "").trim();
var statusJson = String(respStatus.responses[0].out || "{}").trim();

var statusObj = null;
try {
    statusObj = toNative(new JSONObject(statusJson));
} catch (e) {
    statusObj = null;
}

if (fields[0]) {
    fields[0].markup = buildStatusMarkup(statusObj, configuredOut);
    fields[0].cls = "info";
}

var currentProvider = providerFromModel(readDefaultModel(statusObj));
if (currentProvider && fields[2]) {
    fields[2].default = currentProvider;
}

return { result: 0, settings: settings };
