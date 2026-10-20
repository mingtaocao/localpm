use axum::{extract::State, http::HeaderMap, routing::post, Json, Router};
use local_postman_lib::{
    domain::*,
    http::HttpEngine,
    mcp::{McpConfig, McpController},
    service::RequestService,
    storage::Storage,
};
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tempfile::TempDir;

#[derive(Default)]
struct Target {
    count: AtomicUsize,
    bodies: Mutex<Vec<Value>>,
}
async fn echo(
    State(target): State<Arc<Target>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> (HeaderMap, Json<Value>) {
    target.count.fetch_add(1, Ordering::SeqCst);
    target.bodies.lock().unwrap().push(body.clone());
    let mut output = HeaderMap::new();
    output.insert(
        "set-cookie",
        "session=never-expose-this-cookie".parse().unwrap(),
    );
    (
        output,
        Json(
            json!({"body":body,"environment":headers.get("x-env").unwrap().to_str().unwrap(),
        "authorization":headers.get("authorization").unwrap().to_str().unwrap()}),
        ),
    )
}
async fn slow(
    State(target): State<Arc<Target>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> (HeaderMap, Json<Value>) {
    tokio::time::sleep(Duration::from_secs(5)).await;
    echo(State(target), headers, Json(body)).await
}
struct Fixture {
    _dir: TempDir,
    service: Arc<RequestService>,
    controller: Arc<McpController>,
    port: u16,
    target: Arc<Target>,
    target_task: tokio::task::JoinHandle<()>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.target_task.abort();
    }
}
fn unused_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}
impl Fixture {
    async fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let target = Arc::new(Target::default());
        let app = Router::new()
            .route("/echo", post(echo))
            .route("/slow", post(slow))
            .with_state(target.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let target_url = format!("http://{}", listener.local_addr().unwrap());
        let target_task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let service = Arc::new(
            RequestService::new(
                Storage::open(&dir.path().join("local-postman.db")).unwrap(),
                HttpEngine::new(dir.path().join("temp")),
            )
            .unwrap(),
        );
        let mut workspace = Workspace::default();
        for id in ["read", "write", "hidden"] {
            workspace.collections.push(Collection {
                id: id.into(),
                name: id.into(),
                auth: json!({"type":"bearer","token":"literal-auth-secret"}),
                variables: vec![],
                metadata: Value::Null,
            });
        }
        for id in ["active", "explicit", "hidden-env"] {
            workspace.environments.push(Environment {
                id: id.into(),
                name: id.into(),
                variables: vec![
                    Pair {
                        key: "host".into(),
                        value: target_url.clone(),
                        ..Pair::default()
                    },
                    Pair {
                        key: "environment".into(),
                        value: id.into(),
                        ..Pair::default()
                    },
                ],
                settings: json!({}),
                metadata: Value::Null,
            });
        }
        workspace.active_environment = Some("active".into());
        for id in ["read", "write", "hidden"] {
            let request = RequestSpec {
                id: format!("request-{id}"),
                name: format!("Request {id}"),
                method: "POST".into(),
                url: "{{host}}/echo".into(),
                params: vec![Pair {
                    key: "page".into(),
                    value: "1".into(),
                    ..Pair::default()
                }],
                headers: vec![Pair {
                    key: "X-Env".into(),
                    value: "{{environment}}".into(),
                    ..Pair::default()
                }],
                body: json!({"mode":"raw","raw":"{\"name\":\"original\",\"nested\":{\"count\":1},\"password\":\"literal-body-secret\"}","options":{"raw":{"language":"json"}}}),
                ..RequestSpec::default()
            };
            workspace.items.push(Item {
                id: format!("item-{id}"),
                collection_id: id.into(),
                parent_id: None,
                kind: "request".into(),
                name: request.name.clone(),
                order: 0.0,
                auth: json!({"type":"inherit"}),
                request: Some(request),
                metadata: Value::Null,
            });
        }
        service.save_workspace(workspace).unwrap();
        let controller =
            McpController::new_with_token(service.clone(), "mcp-integration-token".into());
        Self {
            _dir: dir,
            service,
            controller,
            port: unused_port(),
            target,
            target_task,
        }
    }
    fn config(&self) -> McpConfig {
        McpConfig {
            enabled: true,
            port: self.port,
            read_collections: vec!["read".into(), "write".into()],
            execute_collections: vec!["write".into()],
            environments: vec!["explicit".into()],
            allow_no_environment: false,
        }
    }
    async fn enable(&self) {
        self.controller.configure(self.config()).await.unwrap();
    }
    async fn rpc(&self, method: &str, params: Value) -> Value {
        let response = reqwest::Client::new()
            .post(format!("http://127.0.0.1:{}/mcp", self.port))
            .header("Authorization", "Bearer mcp-integration-token")
            .header("Accept", "application/json, text/event-stream")
            .header("MCP-Protocol-Version", "2025-03-26")
            .json(&json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}))
            .send()
            .await
            .unwrap();
        let status = response.status();
        let content = response.text().await.unwrap();
        assert_eq!(status, reqwest::StatusCode::OK, "{content}");
        let value: Value = serde_json::from_str(&content).unwrap();
        assert!(value.get("error").is_none(), "{value}");
        value["result"].clone()
    }
    async fn call(&self, name: &str, args: Value) -> Value {
        self.rpc("tools/call", json!({"name":name,"arguments":args}))
            .await
    }
    async fn value(&self, name: &str, args: Value) -> Value {
        let result = self.call(name, args).await;
        assert_ne!(result["isError"], true, "{result}");
        result["structuredContent"].clone()
    }
    async fn preview(&self, id: &str) -> Value {
        self.value(
            "preview_request",
            json!({"requestId":id,"environmentId":"explicit"}),
        )
        .await
    }
    async fn done(&self, id: &str) -> Value {
        for _ in 0..100 {
            let result = self.value("get_execution", json!({"executionId":id})).await;
            if result["status"] != "running" {
                return result;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("execution did not complete");
    }
    async fn disable(&self) {
        let mut config = self.config();
        config.enabled = false;
        self.controller.configure(config).await.unwrap();
    }
}
#[tokio::test]
async fn official_transport_auth_scopes_and_schema_are_enforced() {
    let fixture = Fixture::new().await;
    assert_eq!(fixture.controller.status()["running"], false);
    assert!(fixture.controller.connection_config().is_err());
    fixture.enable().await;
    let endpoint = fixture.controller.status()["endpoint"]
        .as_str()
        .unwrap()
        .to_owned();
    let client = reqwest::Client::new();
    assert_eq!(
        client.post(&endpoint).send().await.unwrap().status(),
        reqwest::StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        client
            .post(&endpoint)
            .header("Host", "evil.example")
            .header("Authorization", "Bearer mcp-integration-token")
            .send()
            .await
            .unwrap()
            .status(),
        reqwest::StatusCode::FORBIDDEN
    );
    assert_eq!(
        client
            .post(&endpoint)
            .header("Origin", "https://evil.example")
            .header("Authorization", "Bearer mcp-integration-token")
            .send()
            .await
            .unwrap()
            .status(),
        reqwest::StatusCode::FORBIDDEN
    );
    let initialize=fixture.rpc("initialize",json!({"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"integration","version":"1"}})).await;
    assert_eq!(initialize["serverInfo"]["name"], "Local Postman");
    assert_eq!(
        fixture.rpc("tools/list", json!({})).await["tools"]
            .as_array()
            .unwrap()
            .len(),
        7
    );
    let found = fixture.value("search_requests", json!({})).await;
    assert_eq!(found["requests"].as_array().unwrap().len(), 2);
    assert_eq!(
        fixture
            .call("get_request", json!({"requestId":"request-hidden"}))
            .await["isError"],
        true
    );
    let environment = fixture.value("list_environments", json!({})).await;
    assert_eq!(
        environment["environments"],
        json!([{"id":"explicit","name":"explicit"}])
    );
    assert_eq!(
        fixture
            .call(
                "preview_request",
                json!({"requestId":"request-write","environmentId":null})
            )
            .await["structuredContent"]["error"]["code"],
        "MCP_ENVIRONMENT_DENIED"
    );
    assert_eq!(
        fixture
            .call(
                "preview_request",
                json!({"requestId":"request-write","environmentId":"active"})
            )
            .await["isError"],
        true
    );
    let preview = fixture.preview("request-read").await;
    assert_eq!(preview["canExecute"], false);
    assert_eq!(
        fixture
            .call("run_request", json!({"previewId":preview["previewId"]}))
            .await["structuredContent"]["error"]["code"],
        "MCP_EXECUTION_DENIED"
    );
    assert_eq!(fixture.target.count.load(Ordering::SeqCst), 0);
    fixture.disable().await;
}
#[tokio::test]
async fn frozen_preview_uses_explicit_environment_and_repeated_run_sends_once() {
    let fixture = Fixture::new().await;
    fixture.enable().await;
    let preview=fixture.value("preview_request",json!({"requestId":"request-write","environmentId":"explicit","overrides":{"params":{"page":"2"},"body":{"name":"AI name","/nested/count":9}}})).await;
    let mut workspace = fixture.service.storage.load().unwrap();
    workspace
        .items
        .iter_mut()
        .find(|i| i.id == "item-write")
        .unwrap()
        .request
        .as_mut()
        .unwrap()
        .url = "{{host}}/does-not-exist".into();
    workspace
        .environments
        .iter_mut()
        .find(|e| e.id == "explicit")
        .unwrap()
        .variables[1]
        .value = "changed-after-preview".into();
    fixture.service.save_workspace(workspace).unwrap();
    let first = fixture
        .value("run_request", json!({"previewId":preview["previewId"]}))
        .await;
    let second = fixture
        .value("run_request", json!({"previewId":preview["previewId"]}))
        .await;
    assert_eq!(first["executionId"], second["executionId"]);
    let done = fixture.done(first["executionId"].as_str().unwrap()).await;
    assert_eq!(done["status"], "completed");
    assert_eq!(done["environmentId"], "explicit");
    let response: Value = serde_json::from_str(done["response"]["body"].as_str().unwrap()).unwrap();
    assert_eq!(response["environment"], "explicit");
    assert_eq!(response["body"]["name"], "AI name");
    assert_eq!(response["body"]["nested"]["count"], 9);
    assert_eq!(fixture.target.count.load(Ordering::SeqCst), 1);
    assert_eq!(
        fixture
            .service
            .storage
            .load()
            .unwrap()
            .active_environment
            .as_deref(),
        Some("active")
    );
    assert!(done["response"].get("file").is_none());
    let encoded = done.to_string();
    assert!(!encoded.contains("literal-auth-secret"));
    assert!(!encoded.contains("literal-body-secret"));
    assert!(!encoded.contains("never-expose-this-cookie"));
    assert!(!encoded.contains("secretRef"));
    let history = fixture.service.storage.history().unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0]["response"]["source"], "mcp");
    fixture.disable().await;
}
#[tokio::test]
async fn only_existing_text_parameters_and_json_fields_can_be_overridden() {
    let fixture = Fixture::new().await;
    fixture.enable().await;
    for overrides in [
        json!({"url":"https://evil.example"}),
        json!({"headers":{"Authorization":"evil"}}),
        json!({"params":{"new":"value"}}),
        json!({"body":{"new":"value"}}),
        json!({"body":{"/nested/new":2}}),
        json!({"urlencoded":{"name":"value"}}),
    ] {
        let result=fixture.call("preview_request",json!({"requestId":"request-write","environmentId":"explicit","overrides":overrides})).await;
        assert_eq!(result["isError"], true, "{result}");
    }
    let snapshot = fixture
        .value("get_request", json!({"requestId":"request-write"}))
        .await;
    assert!(!snapshot.to_string().contains("literal-body-secret"));
    assert!(!snapshot.to_string().contains("literal-auth-secret"));
    assert_eq!(fixture.target.count.load(Ordering::SeqCst), 0);
    fixture.disable().await;
}
#[tokio::test]
async fn one_ai_execution_runs_at_a_time_and_cancel_is_recorded() {
    let fixture = Fixture::new().await;
    let mut workspace = fixture.service.storage.load().unwrap();
    workspace
        .items
        .iter_mut()
        .find(|i| i.id == "item-write")
        .unwrap()
        .request
        .as_mut()
        .unwrap()
        .url = "{{host}}/slow".into();
    fixture.service.save_workspace(workspace).unwrap();
    fixture.enable().await;
    let preview1 = fixture.preview("request-write").await;
    let preview2 = fixture.preview("request-write").await;
    let first = fixture
        .value("run_request", json!({"previewId":preview1["previewId"]}))
        .await;
    assert_eq!(
        fixture
            .call("run_request", json!({"previewId":preview2["previewId"]}))
            .await["structuredContent"]["error"]["code"],
        "MCP_BUSY"
    );
    let id = first["executionId"].as_str().unwrap();
    fixture
        .value("cancel_execution", json!({"executionId":id}))
        .await;
    assert_eq!(fixture.done(id).await["status"], "cancelled");
    assert_eq!(
        fixture.service.storage.history().unwrap()[0]["response"]["error"]["code"],
        "REQUEST_CANCELLED"
    );
    fixture.disable().await;
}
#[tokio::test]
async fn restart_restores_scope_and_disabling_survives_deleted_authorized_entities() {
    let fixture = Fixture::new().await;
    fixture.enable().await;
    let preview = fixture.preview("request-write").await;
    let config = fixture.config();
    fixture.disable().await;
    fixture
        .service
        .storage
        .save_setting("mcp", &json!(config))
        .unwrap();
    let restored =
        McpController::new_with_token(fixture.service.clone(), "mcp-integration-token".into());
    restored.restore().await;
    assert_eq!(restored.status()["running"], true);
    assert_eq!(
        fixture
            .call("run_request", json!({"previewId":preview["previewId"]}))
            .await["structuredContent"]["error"]["code"],
        "MCP_PREVIEW_UNAVAILABLE"
    );
    let mut workspace = fixture.service.storage.load().unwrap();
    workspace.collections.clear();
    workspace.items.clear();
    workspace.environments.clear();
    workspace.active_environment = None;
    fixture.service.save_workspace(workspace).unwrap();
    let mut disable = fixture.config();
    disable.enabled = false;
    restored.configure(disable).await.unwrap();
    assert_eq!(restored.status()["running"], false);
}

#[tokio::test]
async fn previews_and_request_details_hide_local_paths_unmarked_tokens_and_url_credentials() {
    let fixture = Fixture::new().await;
    let mut workspace = fixture.service.storage.load().unwrap();
    workspace.globals.push(Pair {
        key: "token".into(),
        value: "unmarked-token-secret".into(),
        ..Pair::default()
    });
    workspace.globals.push(Pair {
        key: "public-site".into(),
        value: "https://u:url-password-secret@example.test/?token=url-query-secret".into(),
        ..Pair::default()
    });
    let request = workspace
        .items
        .iter_mut()
        .find(|i| i.id == "item-write")
        .unwrap()
        .request
        .as_mut()
        .unwrap();
    request.settings = json!({"caFile":"/private/never-expose-ca-location.pem"});
    request.url = "{{host}}/echo?token=saved-query-secret".into();
    request.headers.push(Pair {
        key: "X-Secret".into(),
        value: "pair-secret-value".into(),
        is_secret: true,
        secret_ref: Some("private-secret-reference".into()),
        ..Pair::default()
    });
    fixture.service.save_workspace(workspace).unwrap();
    fixture.enable().await;
    let detail = fixture
        .value("get_request", json!({"requestId":"request-write"}))
        .await
        .to_string();
    let preview = fixture.preview("request-write").await.to_string();
    for secret in [
        "never-expose-ca-location",
        "unmarked-token-secret",
        "url-password-secret",
        "url-query-secret",
        "saved-query-secret",
        "pair-secret-value",
        "private-secret-reference",
    ] {
        assert!(!detail.contains(secret), "request detail leaked {secret}");
        assert!(!preview.contains(secret), "preview leaked {secret}");
    }
    assert_eq!(
        fixture
            .value("search_requests", json!({"query":"saved-query-secret"}))
            .await["requests"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
    fixture.disable().await;
}

#[tokio::test]
async fn scripts_preview_is_read_only_and_run_commits_to_the_explicit_environment() {
    let fixture = Fixture::new().await;
    let mut workspace = fixture.service.storage.load().unwrap();
    let request = workspace
        .items
        .iter_mut()
        .find(|i| i.id == "item-write")
        .unwrap()
        .request
        .as_mut()
        .unwrap();
    request.metadata = json!({"localpmScripts":{"enabled":true,"preRequest":"pm.environment.set('fromPre', 'prepared'); pm.request.headers.upsert({key:'X-Script',value:'ready'});","postResponse":"pm.environment.set('fromPost', pm.response.json().environment); pm.test('success', () => pm.response.to.have.status(200));"}});
    fixture.service.save_workspace(workspace).unwrap();
    fixture.enable().await;
    let preview = fixture.preview("request-write").await;
    let workspace = fixture.service.storage.load().unwrap();
    assert!(workspace
        .environments
        .iter()
        .all(|e| !e.variables.iter().any(|p| p.key == "fromPre")));
    let execution = fixture
        .value("run_request", json!({"previewId":preview["previewId"]}))
        .await;
    let done = fixture
        .done(execution["executionId"].as_str().unwrap())
        .await;
    assert_eq!(done["status"], "completed");
    assert_eq!(done["response"]["scripts"]["tests"][0]["passed"], true);
    let saved = fixture.service.storage.load().unwrap();
    assert_eq!(saved.active_environment.as_deref(), Some("active"));
    let environment = saved
        .environments
        .iter()
        .find(|e| e.id == "explicit")
        .unwrap();
    assert!(environment
        .variables
        .iter()
        .any(|p| p.key == "fromPre" && p.value == "prepared"));
    assert!(environment
        .variables
        .iter()
        .any(|p| p.key == "fromPost" && p.value == "explicit"));
    assert!(saved
        .environments
        .iter()
        .find(|e| e.id == "active")
        .unwrap()
        .variables
        .iter()
        .all(|p| p.key != "fromPre" && p.key != "fromPost"));
    fixture.disable().await;
}
