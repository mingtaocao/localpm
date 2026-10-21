use crate::{domain::*, security, variables};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ScriptSet {
    pub enabled: bool,
    pub pre_request: String,
    pub post_response: String,
}
#[derive(Clone, Debug)]
pub struct Script {
    pub scope: String,
    pub set: ScriptSet,
}
#[derive(Clone)]
pub struct ScriptPlan {
    pub workspace: Workspace,
    pub baseline: Workspace,
    pub scripts: Vec<Script>,
    pub locals: Value,
    pub report: Value,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VariablePatch {
    pub scope: String,
    pub key: String,
    pub value: Option<String>,
}

pub fn script_set(metadata: &Value) -> ScriptSet {
    if let Some(value) = metadata.get("localpmScripts") {
        return serde_json::from_value(value.clone()).unwrap_or_default();
    }
    let mut set = ScriptSet::default();
    if let Some(events) = metadata["event"].as_array() {
        for event in events.iter().filter(|e| e["disabled"] != true) {
            let code = match &event["script"]["exec"] {
                Value::String(s) => s.clone(),
                Value::Array(a) => a
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join("\n"),
                _ => String::new(),
            };
            let target = match event["listen"].as_str() {
                Some("prerequest") => &mut set.pre_request,
                Some("test") => &mut set.post_response,
                _ => continue,
            };
            if !target.is_empty() {
                target.push('\n');
            }
            target.push_str(&code);
        }
    }
    set
}
pub fn plan(workspace: &Workspace, request: &RequestSpec) -> ScriptPlan {
    let mut scripts = vec![];
    let item = workspace
        .items
        .iter()
        .find(|i| i.request.as_ref().is_some_and(|r| r.id == request.id));
    if let Some(item) = item {
        if let Some(collection) = workspace
            .collections
            .iter()
            .find(|c| c.id == item.collection_id)
        {
            let mut set = script_set(&collection.metadata);
            // A collection-level opt-in also enables its preserved imported events.
            let enabled = set.enabled;
            scripts.push(Script {
                scope: collection.name.clone(),
                set: set.clone(),
            });
            let mut parents = vec![];
            let mut id = item.parent_id.clone();
            let mut seen = HashSet::new();
            while let Some(pid) = id {
                if !seen.insert(pid.clone()) {
                    break;
                }
                let Some(parent) = workspace.items.iter().find(|i| i.id == pid) else {
                    break;
                };
                parents.push(parent);
                id = parent.parent_id.clone();
            }
            for parent in parents.into_iter().rev() {
                set = script_set(&parent.metadata);
                if parent.metadata.get("localpmScripts").is_none() {
                    set.enabled = enabled;
                }
                scripts.push(Script {
                    scope: parent.name.clone(),
                    set,
                });
            }
            set = if request.metadata.get("localpmScripts").is_some() {
                script_set(&request.metadata)
            } else if item.metadata.get("event").is_some() {
                script_set(&item.metadata)
            } else {
                script_set(&request.metadata)
            };
            if request.metadata.get("localpmScripts").is_none() {
                set.enabled = enabled;
            }
            scripts.push(Script {
                scope: request.name.clone(),
                set,
            });
        }
    } else {
        scripts.push(Script {
            scope: request.name.clone(),
            set: script_set(&request.metadata),
        });
    }
    ScriptPlan {
        workspace: workspace.clone(),
        baseline: workspace.clone(),
        scripts,
        locals: json!({}),
        report: json!({"runs":[],"tests":[],"logs":[],"variableUpdates":[]}),
    }
}
impl ScriptPlan {
    pub fn active(&self) -> bool {
        self.scripts.iter().any(|s| {
            s.set.enabled
                && (!s.set.pre_request.trim().is_empty() || !s.set.post_response.trim().is_empty())
        })
    }
    pub fn collection_id(&self, request: &RequestSpec) -> Option<String> {
        self.workspace
            .items
            .iter()
            .find(|i| i.request.as_ref().is_some_and(|r| r.id == request.id))
            .map(|i| i.collection_id.clone())
    }
    pub fn run(
        &mut self,
        request: &mut RequestSpec,
        response: Option<&Response>,
        token: &CancellationToken,
    ) -> Result<()> {
        let phase = if response.is_some() {
            "postResponse"
        } else {
            "preRequest"
        };
        let started = Instant::now();
        for script in self.scripts.clone().into_iter().filter(|s| s.set.enabled) {
            let code = if response.is_some() {
                script.set.post_response
            } else {
                script.set.pre_request
            };
            if code.trim().is_empty() {
                continue;
            }
            if token.is_cancelled() {
                return Err(AppError::new("REQUEST_CANCELLED", "Request cancelled"));
            }
            if started.elapsed() > Duration::from_secs(10) {
                return Err(AppError::new(
                    "SCRIPT_TIMEOUT",
                    "Script phase exceeded 10 seconds",
                ));
            }
            let cid = self.collection_id(request);
            let mut vars = variables::context(&self.workspace, cid.as_deref())?;
            for (key, value) in &mut vars {
                if security::sensitive_key(key) {
                    value.secret = true;
                }
            }
            let mut scopes = json!({"global":{},"collection":{},"environment":{}});
            // Resolve each scope independently; a hidden global value must not become an environment value.
            for (name, pairs) in [
                ("global", Some(&self.workspace.globals)),
                (
                    "collection",
                    self.workspace
                        .collections
                        .iter()
                        .find(|c| Some(&c.id) == cid.as_ref())
                        .map(|c| &c.variables),
                ),
                (
                    "environment",
                    self.workspace
                        .environments
                        .iter()
                        .find(|e| Some(&e.id) == self.workspace.active_environment.as_ref())
                        .map(|e| &e.variables),
                ),
            ] {
                if let Some(pairs) = pairs {
                    for pair in pairs.iter().filter(|p| p.enabled) {
                        let value = variables::pair_value(pair)?;
                        if pair.is_secret || security::sensitive_key(&pair.key) {
                            vars.insert(
                                format!("__scope_{}", vars.len()),
                                VariableValue {
                                    value: value.clone(),
                                    scope: name.into(),
                                    secret: true,
                                },
                            );
                        }
                        scopes[name][&pair.key] = json!(value);
                    }
                }
            }
            if code.len() > 256 * 1024 {
                return Err(AppError::new("SCRIPT_ERROR", "Script exceeds 256 KiB"));
            }
            let mut response_input = json!(response);
            if response.is_some_and(|r| r.body.len() > 5 * 1024 * 1024 || r.binary || r.truncated) {
                response_input["body"] = json!("");
                response_input["truncated"] = json!(true);
            }
            let input = json!({"code":code,"scopes":scopes,"locals":self.locals,"environmentId":self.workspace.active_environment,"collectionId":cid,"request":request,"response":response_input});
            let outcome = evaluate(input, token.clone());
            let mut run = json!({"scope":script.scope,"phase":phase,"passed":outcome.is_ok()});
            let output = match outcome {
                Ok(output) => output,
                Err(error) => {
                    run["error"] = json!(error.message);
                    self.report["runs"].as_array_mut().unwrap().push(run);
                    return Err(error);
                }
            };
            if let Some(redactions) = output["redactions"].as_array() {
                for patch in redactions {
                    let key = patch["key"].as_str().unwrap_or_default();
                    if security::sensitive_key(key) || vars.get(key).is_some_and(|v| v.secret) {
                        if let Some(value) = patch["value"].as_str() {
                            vars.insert(
                                format!("__script_{}", vars.len()),
                                VariableValue {
                                    value: value.into(),
                                    scope: "Script".into(),
                                    secret: true,
                                },
                            );
                        }
                    }
                }
            }
            for field in ["tests", "logs"] {
                if let Some(values) = output[field].as_array() {
                    for value in values {
                        let mut value = value.clone();
                        value["scope"] = json!(script.scope);
                        value["phase"] = json!(phase);
                        security::redact_value(&mut value, &vars);
                        if self.report[field].as_array().unwrap().len() < 200 {
                            self.report[field].as_array_mut().unwrap().push(value);
                        }
                    }
                }
            }
            if let Some(message) = output["error"].as_str() {
                let safe = security::redact_text(message, &vars);
                run["passed"] = json!(false);
                run["error"] = json!(safe);
                self.report["runs"].as_array_mut().unwrap().push(run);
                return Err(AppError::new(
                    "SCRIPT_ERROR",
                    format!("{} ({phase}): {safe}", script.scope),
                ));
            }
            let patches: Vec<VariablePatch> = serde_json::from_value(output["patches"].clone())
                .map_err(|e| AppError::new("SCRIPT_ERROR", e))?;
            for patch in patches {
                let id = if patch.scope == "environment" {
                    self.workspace.active_environment.clone()
                } else {
                    cid.clone()
                };
                let pairs = scope_pairs_mut(&mut self.workspace, &patch.scope, id.as_deref())?;
                apply_pair(pairs, &patch.key, patch.value);
            }
            self.locals = output["locals"].clone();
            let changed: RequestSpec = serde_json::from_value(output["request"].clone())
                .map_err(|e| AppError::new("SCRIPT_ERROR", e))?;
            request.url = changed.url;
            request.params = changed.params;
            request.headers = changed.headers;
            request.body = changed.body;
            self.report["runs"].as_array_mut().unwrap().push(run);
        }
        Ok(())
    }
}
fn evaluate(input: Value, token: CancellationToken) -> Result<Value> {
    let runtime = rquickjs::Runtime::new().map_err(|e| AppError::new("SCRIPT_ERROR", e))?;
    runtime.set_memory_limit(32 * 1024 * 1024);
    runtime.set_max_stack_size(512 * 1024);
    let start = Instant::now();
    let interrupted = token.clone();
    runtime.set_interrupt_handler(Some(Box::new(move || {
        interrupted.is_cancelled() || start.elapsed() > Duration::from_secs(3)
    })));
    let context =
        rquickjs::Context::full(&runtime).map_err(|e| AppError::new("SCRIPT_ERROR", e))?;
    let result = context.with(|ctx| {
        let code = format!("{}\nrunLocalpmScript(JSON.parse({}))", include_str!("script_runtime.js"), serde_json::to_string(&input.to_string()).map_err(|e| AppError::new("SCRIPT_ERROR", e))?);
        let result = ctx.eval::<String, _>(code);
        match result {
            Ok(text) => serde_json::from_str(&text).map_err(|e| AppError::new("SCRIPT_ERROR", e)),
            Err(_) if token.is_cancelled() => Err(AppError::new("REQUEST_CANCELLED", "Request cancelled")),
            Err(_) if start.elapsed() >= Duration::from_secs(3) => Err(AppError::new("SCRIPT_TIMEOUT", "Script exceeded 3 seconds")),
            Err(error) => Err(AppError::new("SCRIPT_ERROR", format!("Script VM failed (syntax error, memory limit, or unsupported async operation): {error}"))),
        }
    });
    if result.is_ok() && runtime.is_job_pending() {
        return Err(AppError::new(
            "SCRIPT_ERROR",
            "Async scripts and Promise callbacks are not supported",
        ));
    }
    result
}
pub fn scope_pairs_mut<'a>(
    workspace: &'a mut Workspace,
    scope: &str,
    id: Option<&str>,
) -> Result<&'a mut Vec<Pair>> {
    match scope {
        "global" => Some(&mut workspace.globals),
        "collection" => workspace
            .collections
            .iter_mut()
            .find(|c| Some(c.id.as_str()) == id)
            .map(|c| &mut c.variables),
        "environment" => workspace
            .environments
            .iter_mut()
            .find(|e| Some(e.id.as_str()) == id)
            .map(|e| &mut e.variables),
        _ => None,
    }
    .ok_or_else(|| {
        AppError::new(
            "SCRIPT_SCOPE_MISSING",
            "Script variable target no longer exists",
        )
    })
}
pub fn apply_pair(pairs: &mut Vec<Pair>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        if let Some(pair) = pairs.iter_mut().find(|p| p.key == key) {
            if value.is_empty() {
                pair.secret_ref = None;
            }
            pair.value = value;
            pair.enabled = true;
        } else {
            pairs.push(Pair {
                key: key.into(),
                value,
                ..Default::default()
            });
        }
    } else {
        pairs.retain(|p| p.key != key);
    }
}

pub fn prepare(
    workspace: &Workspace,
    request: &RequestSpec,
    token: &CancellationToken,
) -> Result<crate::http::PreparedRequest> {
    let mut plan = plan(workspace, request);
    if !plan.active() {
        return crate::http::prepare(workspace, request);
    }
    let mut request = request.clone();
    plan.run(&mut request, None, token)?;
    let mut prepared = crate::http::prepare_with_locals(&plan.workspace, &request, &plan.locals)?;
    for (key, value) in &mut prepared.vars {
        if security::sensitive_key(key) {
            value.secret = true;
        }
    }
    prepared.scripts = Some(plan);
    Ok(prepared)
}
// Preserve unknown Postman events while replacing the two edited stages.
pub fn export_events(metadata: &Value, events: &Value) -> Value {
    if metadata.get("localpmScripts").is_none() {
        return events.clone();
    }
    let set = script_set(metadata);
    let mut result: Vec<Value> = events
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|event| event["listen"] != "prerequest" && event["listen"] != "test")
        .collect();
    for (listen, code) in [("prerequest", set.pre_request), ("test", set.post_response)] {
        if code.is_empty() {
            continue;
        }
        let mut event = events
            .as_array()
            .and_then(|events| events.iter().find(|e| e["listen"] == listen))
            .cloned()
            .unwrap_or_else(|| json!({}));
        event["listen"] = json!(listen);
        event["disabled"] = json!(!set.enabled);
        if !event["script"].is_object() {
            event["script"] = json!({});
        }
        event["script"]["type"] = json!("text/javascript");
        event["script"]["exec"] = json!(code.split('\n').collect::<Vec<_>>());
        result.push(event);
    }
    json!(result)
}

pub fn changes(plan: &ScriptPlan, request: &RequestSpec) -> Vec<Value> {
    let mut updates = vec![];
    let cid = plan.collection_id(request);
    for (scope, id) in [
        ("global", None),
        ("collection", cid.as_deref()),
        ("environment", plan.workspace.active_environment.as_deref()),
    ] {
        let mut before = plan.baseline.clone();
        let mut after = plan.workspace.clone();
        let (Ok(before), Ok(after)) = (
            scope_pairs_mut(&mut before, scope, id),
            scope_pairs_mut(&mut after, scope, id),
        ) else {
            continue;
        };
        let keys: HashSet<_> = before
            .iter()
            .chain(after.iter())
            .map(|p| p.key.clone())
            .collect();
        for key in keys {
            let before = before.iter().find(|p| p.key == key);
            let pair = after.iter().find(|p| p.key == key);
            if json!(before) != json!(pair) {
                updates.push(json!({"scope":scope,"id":id,"key":key,"before":before,"pair":pair}));
            }
        }
    }
    updates
}
pub fn apply_update(workspace: &mut Workspace, update: &Value) -> Result<()> {
    let pairs = scope_pairs_mut(
        workspace,
        update["scope"].as_str().unwrap_or_default(),
        update["id"].as_str(),
    )?;
    let key = update["key"]
        .as_str()
        .ok_or_else(|| AppError::new("SCRIPT_ERROR", "Missing variable key"))?;
    let index = pairs.iter().position(|pair| pair.key == key);
    if !update["pair"].is_null() {
        let pair = serde_json::from_value(update["pair"].clone())
            .map_err(|e| AppError::new("SCRIPT_ERROR", e))?;
        if let Some(index) = index {
            pairs[index] = pair;
        } else {
            pairs.push(pair);
        }
    } else if let Some(index) = index {
        pairs.remove(index);
    }
    Ok(())
}
fn same_target(a: &Value, b: &Value) -> bool {
    a["scope"] == b["scope"] && a["id"] == b["id"] && a["key"] == b["key"]
}
// Pending full-workspace UI saves cannot undo script writes they have not observed.
pub fn merge_stale_variables(incoming: &mut Workspace, current: &Workspace) {
    let versions = current.settings["scriptVariableVersions"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    if versions.is_empty() {
        return;
    }
    let mut incoming_versions = incoming.settings["scriptVariableVersions"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    for version in versions {
        let seen = incoming_versions
            .iter()
            .find(|v| same_target(v, &version))
            .and_then(|v| v["revision"].as_u64())
            .unwrap_or(0);
        if seen >= version["revision"].as_u64().unwrap_or(0) {
            continue;
        }
        let mut snapshot = current.clone();
        if let Ok(pairs) = scope_pairs_mut(
            &mut snapshot,
            version["scope"].as_str().unwrap_or_default(),
            version["id"].as_str(),
        ) {
            let mut update = version.clone();
            update["pair"] = json!(pairs
                .iter()
                .find(|p| Some(p.key.as_str()) == version["key"].as_str()));
            let _ = apply_update(incoming, &update);
        }
        incoming_versions.retain(|v| !same_target(v, &version));
        incoming_versions.push(version);
    }
    incoming.settings["scriptVariableVersions"] = json!(incoming_versions);
    incoming.settings["scriptRevision"] = current.settings["scriptRevision"].clone();
}
pub fn record_versions(workspace: &mut Workspace, updates: &mut [Value]) {
    let revision = workspace.settings["scriptRevision"].as_u64().unwrap_or(0) + 1;
    let mut versions = workspace.settings["scriptVariableVersions"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    for update in updates {
        update["revision"] = json!(revision);
        versions.retain(|v| !same_target(v, update));
        versions.push(json!({"scope":update["scope"],"id":update["id"],"key":update["key"],"revision":revision}));
    }
    workspace.settings["scriptRevision"] = json!(revision);
    workspace.settings["scriptVariableVersions"] = json!(versions);
}
