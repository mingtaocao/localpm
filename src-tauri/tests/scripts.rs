use local_postman_lib::{
    domain::*,
    http::HttpEngine,
    postman, scripts,
    service::{ExecutionContext, RequestService},
    storage::Storage,
};
use serde_json::{json, Value};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
use tokio_util::sync::CancellationToken;

fn environment(id: &str) -> Environment {
    Environment {
        id: id.into(),
        name: id.into(),
        variables: vec![],
        settings: json!({}),
        metadata: Value::Null,
    }
}
fn request(url: &str, pre: &str, post: &str) -> RequestSpec {
    RequestSpec {
        url: url.into(),
        metadata: json!({"localpmScripts":{"enabled":true,"preRequest":pre,"postResponse":post}}),
        ..Default::default()
    }
}
fn workspace() -> Workspace {
    Workspace {
        environments: vec![environment("dev"), environment("prod")],
        active_environment: Some("dev".into()),
        ..Default::default()
    }
}
async fn server() -> (String, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                break;
            };
            tokio::spawn(async move {
                let mut data = vec![0; 8192];
                let size = socket.read(&mut data).await.unwrap();
                let header = String::from_utf8_lossy(&data[..size]);
                let body = if header.contains("/invalid ") {
                    "not-json".into()
                } else {
                    json!({"data":{"token":"new-value-123"},"request":header}).to_string()
                };
                let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body);
                socket.write_all(response.as_bytes()).await.unwrap();
            });
        }
    });
    (format!("http://{address}"), task)
}
async fn send(service: &RequestService, ws: &Workspace, request: &RequestSpec) -> Result<Response> {
    let context = ExecutionContext::from_workspace(ws, request, "manual");
    service
        .execute(
            scripts::prepare(ws, request, &CancellationToken::new())?,
            uuid::Uuid::new_v4().to_string(),
            context,
        )
        .await
}
#[tokio::test]
async fn two_real_requests_extract_reuse_and_restart() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("db");
    let service = RequestService::new(
        Storage::open(&db).unwrap(),
        HttpEngine::new(dir.path().join("temp")),
    )
    .unwrap();
    let ws = workspace();
    service.save_workspace(ws.clone()).unwrap();
    let (url, task) = server().await;
    let first = request(
        &format!("{url}/login"),
        "",
        r#"const data = pm.response.json(); pm.environment.set("accessToken", data.data.token); pm.test("success", () => pm.response.to.have.status(200)); console.log(data.data.token);"#,
    );
    let response = send(&service, &ws, &first).await.unwrap();
    assert!(
        response.scripts.get("error").is_none(),
        "{}",
        response.scripts
    );
    assert_eq!(response.scripts["tests"][0]["passed"], true);
    assert!(!response.scripts["logs"]
        .to_string()
        .contains("new-value-123"));
    let mut second = request(&format!("{url}/users"), "", "");
    second.headers.push(Pair {
        key: "Authorization".into(),
        value: "Bearer {{accessToken}}".into(),
        ..Default::default()
    });
    let saved = service.storage.load().unwrap();
    assert!(saved.environments[1].variables.is_empty());
    let response = send(&service, &saved, &second).await.unwrap();
    assert!(
        response.body.contains("Bearer new-value-123"),
        "{}",
        response.body
    );
    drop(service);
    let restarted = Storage::open(&db).unwrap().load().unwrap();
    assert_eq!(
        restarted.environments[0].variables[0].value,
        "new-value-123"
    );
    task.abort();
}
#[tokio::test]
async fn pre_scripts_prepare_headers_and_local_variables() {
    let dir = tempfile::tempdir().unwrap();
    let service = RequestService::new(
        Storage::open(&dir.path().join("db")).unwrap(),
        HttpEngine::new(dir.path().join("temp")),
    )
    .unwrap();
    let ws = workspace();
    service.save_workspace(ws.clone()).unwrap();
    let (url, task) = server().await;
    let request = request(
        &format!("{url}/{{{{path}}}}"),
        r#"pm.variables.set("path", "echo"); pm.request.headers.upsert({key:"X-Script", value:"ready"}); pm.environment.set("number",42);"#,
        r#"pm.test("local still exists",()=>pm.expect(pm.variables.get("path")).equal("echo"));"#,
    );
    let response = send(&service, &ws, &request).await.unwrap();
    assert!(response.body.to_lowercase().contains("x-script: ready"));
    assert!(response.body.contains("/echo"));
    assert_eq!(response.scripts["tests"][0]["passed"], true);
    let saved = service.storage.load().unwrap();
    assert_eq!(saved.environments[0].variables[0].value, "42");
    assert!(!json!(saved).to_string().contains("\"key\":\"path\""));
    task.abort();
}
#[tokio::test]
async fn invalid_json_missing_field_and_throw_preserve_response_and_rollback() {
    let dir = tempfile::tempdir().unwrap();
    let service = RequestService::new(
        Storage::open(&dir.path().join("db")).unwrap(),
        HttpEngine::new(dir.path().join("temp")),
    )
    .unwrap();
    let ws = workspace();
    service.save_workspace(ws.clone()).unwrap();
    let (url, task) = server().await;
    for (path, code) in [
        ("invalid", "pm.response.json();"),
        (
            "login",
            "pm.environment.set('missing',pm.response.json().missing);",
        ),
        (
            "login",
            "pm.environment.set('partial','value'); throw new Error('failed');",
        ),
    ] {
        let response = send(&service, &ws, &request(&format!("{url}/{path}"), "", code))
            .await
            .unwrap();
        assert_eq!(response.status, 200);
        assert_eq!(response.scripts["error"]["code"], "SCRIPT_ERROR");
        assert!(service.storage.load().unwrap().environments[0]
            .variables
            .is_empty());
    }
    task.abort();
}
#[tokio::test]
async fn frozen_environment_conflicts_and_stale_saves() {
    let dir = tempfile::tempdir().unwrap();
    let service = RequestService::new(
        Storage::open(&dir.path().join("db")).unwrap(),
        HttpEngine::new(dir.path().join("temp")),
    )
    .unwrap();
    let ws = workspace();
    service.save_workspace(ws.clone()).unwrap();
    let (url, task) = server().await;
    let request = request(&url, "", "pm.environment.set('result','from-script');");
    let prepared = scripts::prepare(&ws, &request, &CancellationToken::new()).unwrap();
    let context = ExecutionContext::from_workspace(&ws, &request, "manual");
    let mut changed = ws.clone();
    changed.active_environment = Some("prod".into());
    changed.environments[0].variables.push(Pair {
        key: "unrelated".into(),
        value: "keep".into(),
        ..Default::default()
    });
    service.save_workspace(changed.clone()).unwrap();
    let response = service
        .execute(prepared, uuid::Uuid::new_v4().to_string(), context)
        .await
        .unwrap();
    assert!(response.scripts.get("error").is_none());
    // A full save queued before the script finished must not wipe its write.
    service.save_workspace(changed).unwrap();
    let saved = service.storage.load().unwrap();
    assert_eq!(saved.active_environment.as_deref(), Some("prod"));
    assert_eq!(saved.environments[0].variables.len(), 2);
    assert!(saved.environments[1].variables.is_empty());
    let prepared = scripts::prepare(&saved, &request, &CancellationToken::new()).unwrap();
    let context = ExecutionContext::from_workspace(&saved, &request, "manual");
    let mut changed = saved.clone();
    changed.environments[1].variables.push(Pair {
        key: "result".into(),
        value: "manual".into(),
        ..Default::default()
    });
    service.save_workspace(changed).unwrap();
    let response = service
        .execute(prepared, uuid::Uuid::new_v4().to_string(), context)
        .await
        .unwrap();
    assert_eq!(
        response.scripts["error"]["code"],
        "SCRIPT_VARIABLE_CONFLICT"
    );
    assert_eq!(
        service.storage.load().unwrap().environments[1].variables[0].value,
        "manual"
    );
    task.abort();
}
#[test]
fn vm_limits_and_pre_errors() {
    let ws = workspace();
    for code in [
        "throw new Error('stop');",
        "pm.sendRequest('https://example.test');",
        "fetch('https://example.test');",
        "Promise.resolve().then(()=>pm.environment.set('x','value'));",
        "pm.environment.set('x', 'a'.repeat(65537));",
    ] {
        assert!(
            scripts::prepare(
                &ws,
                &request("https://example.test", code, ""),
                &CancellationToken::new()
            )
            .is_err(),
            "{code}"
        );
    }
    let start = std::time::Instant::now();
    let result = scripts::prepare(
        &ws,
        &request("https://example.test", "while(true) {}", ""),
        &CancellationToken::new(),
    );
    assert_eq!(result.err().unwrap().code, "SCRIPT_TIMEOUT");
    assert!(start.elapsed().as_secs() < 6);
    assert!(scripts::prepare(
        &ws,
        &request("https://example.test", "pm.variables.set('ok',true);", ""),
        &CancellationToken::new()
    )
    .is_ok());
}
#[test]
fn imported_scripts_require_opt_in_and_export_edited_code() {
    let mut ws = workspace();
    let id=postman::import(json!({"info":{"name":"API","schema":"https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},"item":[{"name":"Login","event":[{"listen":"test","script":{"exec":["pm.environment.set('x','old');"],"extra":"keep"}},{"listen":"other","script":{"exec":["unknown"]}}],"request":{"method":"GET","url":"https://example.test"}}]}),&mut ws).unwrap();
    let request = ws.items[0].request.as_ref().unwrap();
    assert!(!scripts::plan(&ws, request).active());
    ws.items[0].request.as_mut().unwrap().metadata["localpmScripts"] =
        json!({"enabled":true,"preRequest":"","postResponse":"pm.environment.set('x','edited');"});
    let output = postman::export(&ws, &id).unwrap();
    let events = output["item"][0]["event"].as_array().unwrap();
    assert!(events.iter().any(|e| e["listen"] == "other"));
    assert!(events.iter().any(
        |e| e["script"]["exec"][0] == "pm.environment.set('x','edited');"
            && e["script"]["extra"] == "keep"
    ));
    assert!(output["item"][0]["request"].get("localpmScripts").is_none());
}

#[test]
fn imported_internal_flags_cannot_enable_execution() {
    let mut ws = workspace();
    let mut input = json!({"info":{"name":"Untrusted","schema":"https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},"localpmScripts":{"enabled":true,"preRequest":"throw new Error('untrusted')"},"item":[{"name":"A","localpmScripts":{"enabled":true,"preRequest":"throw new Error('untrusted')"},"event":[{"listen":"prerequest","script":{"exec":["throw new Error('untrusted')"]}}],"request":{"url":"https://example.test","method":"GET","localpmScripts":{"enabled":true,"preRequest":"throw new Error('untrusted')"}}}]});
    postman::import(input.take(), &mut ws).unwrap();
    let request = ws.items[0].request.as_ref().unwrap();
    assert!(!scripts::plan(&ws, request).active());
}
#[test]
fn cancellation_interrupts_script_and_next_execution_recovers() {
    let token = CancellationToken::new();
    let cancelled = token.clone();
    let thread = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(30));
        cancelled.cancel();
    });
    let start = std::time::Instant::now();
    let result = scripts::prepare(
        &workspace(),
        &request("https://example.test", "while (true) {}", ""),
        &token,
    );
    assert_eq!(result.err().unwrap().code, "REQUEST_CANCELLED");
    assert!(start.elapsed().as_secs() < 2);
    thread.join().unwrap();
    assert!(scripts::prepare(
        &workspace(),
        &request("https://example.test", "pm.variables.set('ok',1);", ""),
        &CancellationToken::new()
    )
    .is_ok());
}
#[test]
fn inheritance_order_and_scope_precedence() {
    let mut ws = workspace();
    ws.globals.push(Pair {
        key: "same".into(),
        value: "global".into(),
        ..Default::default()
    });
    ws.environments[0].variables.push(Pair {
        key: "same".into(),
        value: "environment".into(),
        ..Default::default()
    });
    let request=request("https://example.test","pm.test('scopes',()=>{pm.expect(pm.variables.get('same')).equal('local');pm.expect(pm.globals.get('same')).equal('global');});console.log('request');","");
    ws.collections.push(Collection{id:"c".into(),name:"Collection".into(),auth:Value::Null,variables:vec![],metadata:json!({"localpmScripts":{"enabled":true,"preRequest":"console.log('collection'); pm.variables.set('same','local');"}})});
    ws.items.push(Item{id:"folder".into(),collection_id:"c".into(),parent_id:None,kind:"folder".into(),name:"Folder".into(),order:0.,auth:Value::Null,request:None,metadata:json!({"event":[{"listen":"prerequest","script":{"exec":["console.log('folder');"]}}]})});
    ws.items.push(Item {
        id: "item".into(),
        collection_id: "c".into(),
        parent_id: Some("folder".into()),
        kind: "request".into(),
        name: request.name.clone(),
        order: 1.,
        auth: Value::Null,
        request: Some(request.clone()),
        metadata: Value::Null,
    });
    let prepared = scripts::prepare(&ws, &request, &CancellationToken::new()).unwrap();
    let plan = prepared.scripts.unwrap();
    assert_eq!(
        plan.report["logs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v["message"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["collection", "folder", "request"]
    );
    assert_eq!(plan.report["tests"][0]["passed"], true);
}
