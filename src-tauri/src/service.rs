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
    workspace_write: Mutex<()>,
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
            workspace_write: Mutex::new(()),
            active: Mutex::new(HashMap::new()),
            emitter: None,
        })
    }
    pub fn save_workspace(&self, mut workspace: Workspace) -> Result<Workspace> {
        let _guard = self
            .workspace_write
            .lock()
            .map_err(|_| AppError::new("DATABASE_ERROR", "Workspace locked"))?;
        let current = self.storage.load()?;
        if workspace.variable_revision != current.variable_revision {
            return Err(AppError::new(
                "VARIABLE_REVISION_CONFLICT",
                "Variables changed during this edit; reload and merge",
            ));
        }
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
        workspace.variable_revision += 1;
        self.storage.save(&workspace)?;
        Ok(workspace)
    }
    pub fn import(&self, input: Value) -> Result<Workspace> {
        let _guard = self
            .workspace_write
            .lock()
            .map_err(|_| AppError::new("DATABASE_ERROR", "Workspace locked"))?;
        let mut ws = self.storage.load()?;
        crate::postman::import(input, &mut ws)?;
        ws.variable_revision += 1;
        self.storage.save(&ws)?;
        Ok(ws)
    }
    fn commit_script_variables(
        &self,
        changes: &[crate::scripts::Change],
        context: &ExecutionContext,
    ) -> Result<()> {
        if changes.is_empty() {
            return Ok(());
        }
        if context.source == "mcp" && changes.iter().any(|c| c.scope == "global") {
            return Err(AppError::new("MCP_SCRIPT_GLOBAL_WRITE_DENIED", "MCP scripts cannot write workspace globals; use environment or collection variables"));
        }
        let guard = self
            .workspace_write
            .lock()
            .map_err(|_| AppError::new("DATABASE_ERROR", "Workspace locked"))?;
        let mut ws = self.storage.load()?;
        crate::scripts::apply(
            &mut ws,
            changes,
            context.environment_id.as_deref(),
            context.collection_id.as_deref(),
        )?;
        // Stage secret replacements under fresh credential references. A database
        // failure cannot mutate the credential still referenced by the old workspace.
        for change in changes.iter().filter(|c| c.value.is_some()) {
            let rows = match change.scope.as_str() {
                "global" => Some(&mut ws.globals),
                "environment" => ws
                    .environments
                    .iter_mut()
                    .find(|e| Some(&e.id) == context.environment_id.as_ref())
                    .map(|e| &mut e.variables),
                "collection" => ws
                    .collections
                    .iter_mut()
                    .find(|c| Some(&c.id) == context.collection_id.as_ref())
                    .map(|c| &mut c.variables),
                _ => None,
            };
            if let Some(rows) = rows {
                for row in rows
                    .iter_mut()
                    .filter(|p| p.key == change.key && p.is_secret)
                {
                    row.secret_ref = None;
                }
            }
        }
        secure_pairs(&mut ws.globals)?;
        for c in &mut ws.collections {
            secure_pairs(&mut c.variables)?;
            secure_metadata(&mut c.metadata, "variable", &c.variables);
        }
        for e in &mut ws.environments {
            secure_pairs(&mut e.variables)?;
            secure_metadata(&mut e.metadata, "values", &e.variables);
        }
        ws.variable_revision += 1;
        self.storage.save(&ws)?;
        drop(guard);
        // No variable values travel in events; clients fetch the secured workspace.
        self.emit(
            "variables-updated",
            json!({"revision":ws.variable_revision}),
        );
        Ok(())
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
        Ok(preview_prepared(&crate::scripts::prepare(
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
    pub fn cancel(&self, id: &str) {
        if let Ok(active) = self.active.lock() {
            if let Some(token) = active.get(id) {
                token.cancel();
            }
        }
        self.http.cancel(id);
    }
    pub async fn send(
        &self,
        workspace: Workspace,
        request: RequestSpec,
        id: String,
        context: ExecutionContext,
    ) -> Result<Response> {
        self.reserve_execution(&id)?;
        let token = self
            .active
            .lock()
            .map_err(|_| AppError::new("EXECUTION_ERROR", "Execution registry locked"))?
            .get(&id)
            .cloned()
            .unwrap();
        let cancelled = token.clone();
        let prepared = tokio::task::spawn_blocking(move || {
            crate::scripts::prepare_with_cancel(&workspace, &request, &token)
        })
        .await
        .map_err(|e| AppError::new("SCRIPT_RUNTIME", e))
        .and_then(|r| r);
        match prepared {
            Ok(prepared) => self.execute(prepared, id, context).await,
            Err(error) => {
                self.active.lock().ok().map(|mut a| a.remove(&id));
                if cancelled.is_cancelled() {
                    Err(AppError::new("REQUEST_CANCELLED", "Request cancelled"))
                } else {
                    Err(error)
                }
            }
        }
    }
    pub async fn execute(
        &self,
        prepared: PreparedRequest,
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
        let pre_commit = if let Some(scripts) = &prepared.scripts {
            if token.is_cancelled() {
                Err(AppError::new("REQUEST_CANCELLED", "Request cancelled"))
            } else {
                self.commit_script_variables(&scripts.before, &context)
            }
        } else {
            Ok(())
        };
        let mut result = if let Err(error) = pre_commit {
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
        let mut report_vars = prepared.vars.clone();
        if let (Some(scripts), Ok(response)) = (&prepared.scripts, &mut result) {
            let mut report = scripts.report.clone();
            let script_work = scripts.clone();
            let request = prepared.request.clone();
            let received = response.clone();
            let cancelled = token.clone();
            let post = tokio::task::spawn_blocking(move || {
                crate::scripts::post(&script_work, &request, &received, &cancelled)
            })
            .await;
            let outcome = post
                .map_err(|e| AppError::new("SCRIPT_RUNTIME", e))
                .and_then(|r| r);
            match outcome {
                Ok((changes, mut phase)) => {
                    // Include newly extracted secrets when sanitizing logs and execution history.
                    for c in &changes {
                        if let Some(value) = &c.value {
                            let existing_secret = report_vars.get(&c.key).is_some_and(|v| v.secret);
                            if existing_secret || security::sensitive_key(&c.key) {
                                report_vars.insert(
                                    format!("__script_{}", c.key),
                                    VariableValue {
                                        value: value.clone(),
                                        scope: c.scope.clone(),
                                        secret: true,
                                    },
                                );
                            }
                        }
                    }
                    if token.is_cancelled() {
                        phase["status"] = json!("failed");
                        phase["error"] = json!("Script cancelled");
                    } else if let Err(error) = self.commit_script_variables(&changes, &context) {
                        phase["status"] = json!("failed");
                        phase["error"] = json!(error.message);
                    }
                    report["postresponse"] = phase;
                }
                Err(error) => {
                    report["postresponse"] =
                        json!({"status":"failed","error":error.message,"logs":[],"tests":[]})
                }
            }
            security::redact_value(&mut report, &report_vars);
            response.scripts = Some(report);
        }
        let mut history = json!({"executionId":id,"source":context.source,"environmentId":context.environment_id,"environmentName":context.environment_name});
        match &result {
            Ok(response) => {
                record["status"] = json!("completed");
                record["response"] = redacted_response(response, &report_vars);
                record["scripts"] = response.scripts.clone().unwrap_or(Value::Null);
                if response.scripts.as_ref().is_some_and(|s| {
                    s["postresponse"]["status"] == "failed"
                        || ["prerequest", "postresponse"].iter().any(|phase| {
                            s[phase]["tests"]
                                .as_array()
                                .is_some_and(|tests| tests.iter().any(|t| t["passed"] == false))
                        })
                }) {
                    record["status"] = json!("failed");
                    record["error"] = json!({"code":"SCRIPT_POST_RESPONSE_FAILED","message":"Post-response script failed; HTTP response retained"});
                }
                history["status"] = json!(response.status);
                history["duration"] = json!(response.duration);
                history["size"] = json!(response.size);
                history["body"] = record["response"]["body"].clone();
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
    json!({"status":response.status,"statusText":response.status_text,"headers":headers,"body":body,"duration":response.duration,"size":response.size,"contentType":response.content_type,"finalUrl":security::redact_url(&response.final_url,vars),"redirects":response.redirects.iter().map(|url|security::redact_url(url,vars)).collect::<Vec<_>>(),"file":response.file,"truncated":response.truncated||body.len()>=65536,"binary":response.binary,"scripts":response.scripts})
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
