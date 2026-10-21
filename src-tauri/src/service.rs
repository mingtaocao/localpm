use crate::{
    domain::*,
    http::{HttpEngine, PreparedRequest},
    security,
    storage::Storage,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tokio_util::sync::CancellationToken;

fn secure_metadata(metadata: &mut Value, field: &str, pairs: &[Pair]) {
    if let Some(entries) = metadata[field].as_array_mut() {
        for entry in entries {
            if pairs.iter().any(|p| p.is_secret && entry["key"] == p.key) {
                entry["value"] = json!("")
            }
        }
    }
}
fn secure_pairs(pairs: &mut [Pair]) -> Result<()> {
    for p in pairs {
        if p.is_secret && !p.value.is_empty() {
            let r = p
                .secret_ref
                .clone()
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            keyring::Entry::new("LocalPostman", &r)
                .and_then(|e| e.set_password(&p.value))
                .map_err(|_| {
                    AppError::new(
                        "SECRET_STORE_FAILED",
                        "Could not save secret to OS credential store",
                    )
                })?;
            p.secret_ref = Some(r);
            p.secret_version = Some(uuid::Uuid::new_v4().to_string());
            p.value.clear()
        }
    }
    Ok(())
}
fn secure_proxy(settings: &mut Value) -> Result<()> {
    if let Some(address) = settings["proxy"]["url"].as_str() {
        if let Ok(parsed) = url::Url::parse(address) {
            if !parsed.username().is_empty() || parsed.password().is_some() {
                return Err(AppError::new(
                    "INVALID_PROXY",
                    "Use the dedicated proxy username and password fields",
                ));
            }
        }
    }

    if let Some(p) = settings["proxy"]["password"]
        .as_str()
        .filter(|s| !s.is_empty())
    {
        let r = settings["proxy"]["secretRef"]
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        keyring::Entry::new("LocalPostman", &r)
            .and_then(|e| e.set_password(p))
            .map_err(|_| AppError::new("SECRET_STORE_FAILED", "Could not save proxy password"))?;
        settings["proxy"]["secretRef"] = json!(r);
        settings["proxy"]["credentialVersion"] = json!(uuid::Uuid::new_v4().to_string());
        settings["proxy"]
            .as_object_mut()
            .unwrap()
            .remove("password");
    }
    Ok(())
}

pub type EventSink = Arc<dyn Fn(&str, Value) + Send + Sync>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionContext {
    pub source: String,
    pub environment_id: Option<String>,
    pub environment_name: String,
    pub collection_id: Option<String>,
    pub history_limit: i64,
}
impl Default for ExecutionContext {
    fn default() -> Self {
        Self {
            source: "manual".into(),
            environment_id: None,
            environment_name: "No environment".into(),
            collection_id: None,
            history_limit: 1000,
        }
    }
}
impl ExecutionContext {
    pub fn from_workspace(workspace: &Workspace, request: &RequestSpec, source: &str) -> Self {
        Self {
            source: source.into(),
            environment_id: workspace.active_environment.clone(),
            environment_name: workspace
                .environments
                .iter()
                .find(|e| Some(&e.id) == workspace.active_environment.as_ref())
                .map(|e| e.name.clone())
                .unwrap_or_else(|| "No environment".into()),
            collection_id: workspace
                .items
                .iter()
                .find(|i| i.request.as_ref().is_some_and(|r| r.id == request.id))
                .map(|i| i.collection_id.clone()),
            history_limit: workspace.settings["historyLimit"].as_i64().unwrap_or(1000),
        }
    }
}

pub struct RequestService {
    pub storage: Storage,
    pub http: HttpEngine,
    active: Mutex<HashMap<String, CancellationToken>>,
    emitter: Option<EventSink>,
}
impl RequestService {
    pub fn new(storage: Storage, http: HttpEngine) -> Result<Self> {
        *http
            .jar
            .lock()
            .map_err(|_| AppError::new("COOKIE_ERROR", "Cookie store locked"))? =
            storage.cookies()?;
        storage.interrupt_executions()?;
        Ok(Self {
            storage,
            http,
            active: Mutex::new(HashMap::new()),
            emitter: None,
        })
    }
    pub fn save_workspace(&self, mut workspace: Workspace) -> Result<Workspace> {
        secure_pairs(&mut workspace.globals)?;
        secure_proxy(&mut workspace.settings)?;
        for collection in &mut workspace.collections {
            secure_pairs(&mut collection.variables)?;
            secure_metadata(&mut collection.metadata, "variable", &collection.variables);
        }
        for environment in &mut workspace.environments {
            secure_pairs(&mut environment.variables)?;
            secure_metadata(&mut environment.metadata, "values", &environment.variables);
            secure_proxy(&mut environment.settings)?;
        }
        for item in &mut workspace.items {
            if let Some(request) = &mut item.request {
                secure_proxy(&mut request.settings)?;
            }
        }
        self.storage.update_workspace(|current| {
            crate::scripts::merge_stale_variables(&mut workspace, current);
            *current = workspace.clone();
            Ok(())
        })
    }
    pub fn save_draft(&self, id: &str, mut request: Option<RequestSpec>) -> Result<()> {
        if let Some(request) = &mut request {
            secure_proxy(&mut request.settings)?;
        }
        self.storage.draft(id, request.as_ref())
    }
    pub fn with_emitter(mut self, emitter: EventSink) -> Self {
        self.emitter = Some(emitter);
        self
    }
    fn emit(&self, event: &str, value: Value) {
        if let Some(emit) = &self.emitter {
            emit(event, value);
        }
    }
    pub fn preview(&self, request: &RequestSpec) -> Result<Value> {
        Ok(preview_prepared(&crate::http::prepare(
            &self.storage.load()?,
            request,
        )?))
    }
    pub fn reserve_execution(&self, id: &str) -> Result<()> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| AppError::new("EXECUTION_ERROR", "Execution registry locked"))?;
        if active.contains_key(id) {
            return Err(AppError::new(
                "EXECUTION_EXISTS",
                "Execution already exists",
            ));
        }
        active.insert(id.into(), CancellationToken::new());
        Ok(())
    }
    pub fn execution_token(&self, id: &str) -> Result<CancellationToken> {
        self.active
            .lock()
            .map_err(|_| AppError::new("EXECUTION_ERROR", "Execution registry locked"))?
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::new("EXECUTION_ERROR", "Execution not registered"))
    }
    pub fn forget_execution(&self, id: &str) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(id);
        }
    }
    fn commit_script_variables(
        &self,
        plan: &mut crate::scripts::ScriptPlan,
        request: &RequestSpec,
        source: &str,
    ) -> Result<()> {
        let mut updates = crate::scripts::changes(plan, request);
        if updates.is_empty() {
            return Ok(());
        }
        // MCP execution permissions cover the selected collection/environment, not workspace globals.
        if source == "mcp" && updates.iter().any(|u| u["scope"] == "global") {
            return Err(AppError::new(
                "SCRIPT_SCOPE_DENIED",
                "MCP scripts cannot modify workspace global variables",
            ));
        }
        let workspace = self.storage.update_workspace(|workspace| {
            for update in &updates {
                let pairs = crate::scripts::scope_pairs_mut(
                    workspace,
                    update["scope"].as_str().unwrap(),
                    update["id"].as_str(),
                )?;
                let current = json!(pairs
                    .iter()
                    .find(|p| Some(p.key.as_str()) == update["key"].as_str()));
                if current != update["before"] {
                    return Err(AppError::new(
                        "SCRIPT_VARIABLE_CONFLICT",
                        format!(
                            "Variable changed during execution: {}",
                            update["key"].as_str().unwrap_or_default()
                        ),
                    ));
                }
            }
            for update in &mut updates {
                crate::scripts::apply_update(workspace, update)?;
                let pairs = crate::scripts::scope_pairs_mut(
                    workspace,
                    update["scope"].as_str().unwrap(),
                    update["id"].as_str(),
                )?;
                // Stage new secret credentials so a later failed write cannot change the old reference.
                if let Some(pair) = pairs
                    .iter_mut()
                    .find(|p| Some(p.key.as_str()) == update["key"].as_str())
                {
                    if pair.is_secret && !pair.value.is_empty() {
                        pair.secret_ref = None;
                    }
                }
                secure_pairs(pairs)?;
                update["pair"] = json!(pairs
                    .iter()
                    .find(|p| Some(p.key.as_str()) == update["key"].as_str()));
                // The old value is needed only for conflict detection; never emit it.
                update.as_object_mut().unwrap().remove("before");
            }
            crate::scripts::record_versions(workspace, &mut updates);
            Ok(())
        })?;
        // Continue with the execution's frozen scopes; only refresh its committed variable metadata.
        for update in &updates {
            crate::scripts::apply_update(&mut plan.workspace, update)?;
        }
        plan.workspace.settings["scriptRevision"] = workspace.settings["scriptRevision"].clone();
        plan.workspace.settings["scriptVariableVersions"] =
            workspace.settings["scriptVariableVersions"].clone();
        plan.baseline = plan.workspace.clone();
        plan.report["variableUpdates"]
            .as_array_mut()
            .unwrap()
            .extend(updates.clone());
        self.emit("script-variables-updated", json!(updates));
        Ok(())
    }
    pub fn cancel(&self, id: &str) {
        if let Ok(active) = self.active.lock() {
            if let Some(token) = active.get(id) {
                token.cancel();
            }
        }
        self.http.cancel(id);
    }
    pub async fn execute(
        &self,
        mut prepared: PreparedRequest,
        id: String,
        context: ExecutionContext,
    ) -> Result<Response> {
        let token = {
            let mut active = self
                .active
                .lock()
                .map_err(|_| AppError::new("EXECUTION_ERROR", "Execution registry locked"))?;
            active.entry(id.clone()).or_default().clone()
        };
        let preparation_error = if !token.is_cancelled() {
            prepared.scripts.as_mut().and_then(|plan| {
                self.commit_script_variables(plan, &prepared.request, &context.source)
                    .err()
            })
        } else {
            None
        };
        let request = security::history_snapshot(&prepared.request, &prepared.vars);
        let started = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let mut record = json!({"id":id,"source":context.source,"collectionId":context.collection_id,"environmentId":context.environment_id,"environmentName":context.environment_name,"startedAt":started,"status":"running","request":request});
        if let Err(error) = self.storage.save_execution(&record, context.history_limit) {
            self.active.lock().ok().map(|mut active| active.remove(&id));
            return Err(error);
        }
        self.emit("execution-updated", record.clone());
        let emit = |mut diagnostic: Value| {
            if context.source == "mcp" {
                security::redact_value(&mut diagnostic, &prepared.vars);
                if let Some(headers) = diagnostic["headers"].as_array_mut() {
                    for header in headers {
                        if header[0].as_str().is_some_and(security::sensitive_header) {
                            header[1] = json!("[redacted]");
                        }
                    }
                }
                if prepared.body["mode"] == "raw" {
                    // Redact JSON before truncation, even when it exceeds the diagnostic limit.
                    diagnostic["bodyPreview"] = json!(security::response_preview(
                        prepared.body["raw"].as_str().unwrap_or_default(),
                        &prepared.vars
                    ));
                } else if prepared.body["mode"] == "urlencoded" {
                    let mut body = prepared.body.clone();
                    security::redact_value(&mut body, &prepared.vars);
                    diagnostic["bodyPreview"] = json!(security::response_preview(
                        &body.to_string(),
                        &prepared.vars
                    ));
                }
            }
            self.emit("request-diagnostic", diagnostic);
        };
        let execution =
            self.http
                .execute_with_diagnostics(prepared.clone(), id.clone(), Some(&emit));
        tokio::pin!(execution);
        let mut result = if let Some(error) = preparation_error {
            Err(error)
        } else if token.is_cancelled() {
            Err(AppError::new("REQUEST_CANCELLED", "Request cancelled"))
        } else {
            tokio::select! {
                biased;
                result=&mut execution=>result,
                _=token.cancelled()=>{ self.http.cancel(&id); execution.await }
            }
        };
        let cookies = self
            .http
            .jar
            .lock()
            .map_err(|_| AppError::new("COOKIE_ERROR", "Cookie store locked"))
            .and_then(|jar| self.storage.save_cookies(&jar));
        if let Err(error) = cookies {
            if result.is_ok() {
                result = Err(error);
            }
        }
        let mut redaction_vars = prepared.vars.clone();
        if let Some(mut plan) = prepared.scripts.take() {
            if let Ok(response) = &result {
                if !token.is_cancelled() {
                    let mut script_request = prepared.request.clone();
                    let response = response.clone();
                    let script_token = token.clone();
                    let run = tokio::task::spawn_blocking(move || {
                        let outcome = plan.run(&mut script_request, Some(&response), &script_token);
                        (plan, outcome)
                    })
                    .await;
                    match run {
                        Ok((mut completed, outcome)) => {
                            let commit = if token.is_cancelled() {
                                Err(AppError::new("REQUEST_CANCELLED", "Request cancelled"))
                            } else {
                                self.commit_script_variables(
                                    &mut completed,
                                    &prepared.request,
                                    &context.source,
                                )
                            };
                            if let Err(error) = outcome.and(commit) {
                                completed.report["error"] = json!(error);
                            }
                            // Newly extracted values must also be covered by diagnostic redaction.
                            if let Ok(vars) = crate::variables::context(
                                &completed.workspace,
                                context.collection_id.as_deref(),
                            ) {
                                for (key, mut value) in vars {
                                    if security::sensitive_key(&key) {
                                        value.secret = true;
                                    }
                                    redaction_vars.insert(format!("__script_final_{key}"), value);
                                }
                            }
                            if let Ok(response) = &mut result {
                                response.scripts = completed.report;
                            }
                        }
                        Err(error) => {
                            if let Ok(response) = &mut result {
                                response.scripts = json!({"error":{"code":"SCRIPT_ERROR","message":error.to_string()}});
                            }
                        }
                    }
                }
            }
        }
        let mut history = json!({"executionId":id,"source":context.source,"environmentId":context.environment_id,"environmentName":context.environment_name});
        match &result {
            Ok(response) => {
                record["status"] = json!("completed");
                record["response"] = redacted_response(response, &redaction_vars);
                history["status"] = json!(response.status);
                history["duration"] = json!(response.duration);
                history["size"] = json!(response.size);
                history["body"] = record["response"]["body"].clone();
                if !response.scripts.is_null() {
                    history["scripts"] = record["response"]["scripts"].clone();
                }
            }
            Err(error) => {
                let mut safe = serde_json::to_value(error).unwrap_or(Value::Null);
                security::redact_value(&mut safe, &prepared.vars);
                record["status"] = json!(if error.code == "REQUEST_CANCELLED" {
                    "cancelled"
                } else {
                    "failed"
                });
                record["error"] = safe.clone();
                history["error"] = safe;
            }
        }
        // Never hold a registry or database lock across network I/O.
        let persisted = self
            .storage
            .save_execution(&record, context.history_limit)
            .and_then(|_| {
                self.storage
                    .add_history(&request, &history, context.history_limit)
            });
        self.active.lock().ok().map(|mut active| active.remove(&id));
        self.emit("execution-updated", record);
        persisted?;
        result
    }
}

pub fn preview_prepared(prepared: &PreparedRequest) -> Value {
    let headers: Vec<_> = prepared
        .headers
        .iter()
        .map(|(key, value)| {
            (
                key.clone(),
                if security::sensitive_header(key) {
                    "[redacted]".into()
                } else {
                    security::redact_text(value, &prepared.vars)
                },
            )
        })
        .collect();
    let sources:Value=prepared.vars.iter().filter(|(key,_)|!key.starts_with("__auth_")).map(|(key,value)|(key.clone(),json!({"scope":value.scope,"value":if value.secret||security::sensitive_key(key){"[redacted]".into()}else{security::redact_text(&value.value,&prepared.vars)}}))).collect();
    let mut body = prepared.body.clone();
    security::redact_value(&mut body, &prepared.vars);
    if let Some(raw) = body["raw"].as_str() {
        body["raw"] = json!(security::response_preview(raw, &prepared.vars));
    }
    json!({"url":security::redact_url(&prepared.url,&prepared.vars),"headers":headers,"body":body,"variables":sources,"proxy":prepared.settings["proxy"]["mode"]})
}

pub fn redacted_response(response: &Response, vars: &Variables) -> Value {
    let headers: Vec<_> = response
        .headers
        .iter()
        .map(|(key, value)| {
            (
                key.clone(),
                if security::sensitive_header(key) {
                    "[redacted]".into()
                } else {
                    security::redact_text(value, vars)
                },
            )
        })
        .collect();
    let body = security::response_preview(&response.body, vars);
    let mut output = json!({"status":response.status,"statusText":response.status_text,"headers":headers,"body":body,"duration":response.duration,"size":response.size,"contentType":response.content_type,"finalUrl":security::redact_url(&response.final_url,vars),"redirects":response.redirects.iter().map(|url|security::redact_url(url,vars)).collect::<Vec<_>>(),"file":response.file,"truncated":response.truncated||body.len()>=65536,"binary":response.binary});
    if !response.scripts.is_null() {
        let mut scripts = response.scripts.clone();
        security::redact_value(&mut scripts, vars);
        output["scripts"] = scripts;
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn shared_execution_persists_sanitized_result_history_and_cookies() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 4096];
            let _ = stream.read(&mut request).await;
            let body = r#"{"token":"response-secret","ok":true}"#;
            let response=format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nSet-Cookie: session=private; Path=/; Max-Age=3600\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body);
            stream.write_all(response.as_bytes()).await.unwrap();
        });
        let dir = tempfile::tempdir().unwrap();
        let events = Arc::new(Mutex::new(Vec::<Value>::new()));
        let capture = events.clone();
        let service = RequestService::new(
            Storage::open(&dir.path().join("db")).unwrap(),
            HttpEngine::new(dir.path().join("temp")),
        )
        .unwrap()
        .with_emitter(Arc::new(move |_, value| {
            capture.lock().unwrap().push(value)
        }));
        let request = RequestSpec {
            url: format!("http://{address}/users?access_token=url-secret"),
            headers: vec![Pair {
                key: "Authorization".into(),
                value: "Bearer header-secret".into(),
                ..Default::default()
            }],
            ..Default::default()
        };
        let workspace = Workspace::default();
        let prepared = crate::http::prepare(&workspace, &request).unwrap();
        let response = service
            .execute(
                prepared,
                "test-execution".into(),
                ExecutionContext {
                    source: "mcp".into(),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(response.status, 200);
        let record = service
            .storage
            .execution("test-execution")
            .unwrap()
            .unwrap();
        let serialized = record.to_string();
        assert!(!serialized.contains("response-secret"));
        assert!(!serialized.contains("url-secret"));
        assert!(!serialized.contains("session=private"));
        let emitted = serde_json::to_string(&*events.lock().unwrap()).unwrap();
        assert!(!emitted.contains("url-secret"));
        assert!(!emitted.contains("header-secret"));
        assert!(!emitted.contains("response-secret"));
        assert_eq!(record["status"], "completed");
        let history = service.storage.history().unwrap();
        assert_eq!(history[0]["response"]["executionId"], "test-execution");
        assert_eq!(history[0]["response"]["source"], "mcp");
        assert_eq!(
            service.storage.cookies().unwrap().iter_unexpired().count(),
            1
        );
    }

    #[tokio::test]
    async fn cancel_before_task_starts_prevents_network_send_and_records_cancellation() {
        let dir = tempfile::tempdir().unwrap();
        let service = RequestService::new(
            Storage::open(&dir.path().join("db")).unwrap(),
            HttpEngine::new(dir.path().join("temp")),
        )
        .unwrap();
        let request = RequestSpec {
            url: "http://127.0.0.1:1/never-send".into(),
            ..Default::default()
        };
        let prepared = crate::http::prepare(&Workspace::default(), &request).unwrap();
        service.reserve_execution("cancel-before-start").unwrap();
        service.cancel("cancel-before-start");
        let error = service
            .execute(
                prepared,
                "cancel-before-start".into(),
                ExecutionContext::default(),
            )
            .await
            .unwrap_err();
        assert_eq!(error.code, "REQUEST_CANCELLED");
        assert_eq!(
            service
                .storage
                .execution("cancel-before-start")
                .unwrap()
                .unwrap()["status"],
            "cancelled"
        );
        assert_eq!(service.storage.history().unwrap().len(), 1);
    }
}
