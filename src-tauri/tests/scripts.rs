use local_postman_lib::{
    domain::*,
    http::HttpEngine,
    service::{ExecutionContext, RequestService},
    storage::Storage,
};
use serde_json::json;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
fn request(url: String, code: &str) -> RequestSpec {
    RequestSpec {
        url,
        metadata: json!({"localpmScriptsEnabled":true,"event":[{"listen":"test","script":{"exec":code}}]}),
        ..Default::default()
    }
}
async fn server(body: &'static str) -> (String, tokio::task::JoinHandle<String>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut buf = vec![0u8; 8192];
        let n = stream.read(&mut buf).await.unwrap();
        let response=format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body);
        stream.write_all(response.as_bytes()).await.unwrap();
        String::from_utf8_lossy(&buf[..n]).to_string()
    });
    (format!("http://{address}/"), task)
}
fn service(dir: &std::path::Path) -> RequestService {
    RequestService::new(
        Storage::open(&dir.join("test.db")).unwrap(),
        HttpEngine::new(dir.join("temp")),
    )
    .unwrap()
}
#[tokio::test]
async fn response_token_is_committed_before_completion_reused_on_wire_and_survives_restart() {
    let dir = tempfile::tempdir().unwrap();
    let service = service(dir.path());
    let initial = service.save_workspace(Workspace::default()).unwrap();
    let (url, a) = server(r#"{"data":{"token":"chain-token"}}"#).await;
    let first=request(url,"pm.globals.set('token',pm.response.json().data.token); pm.test('ok',()=>pm.expect(pm.response.code).to.equal(200));");
    let response = service
        .send(
            initial.clone(),
            first,
            "a".into(),
            ExecutionContext::default(),
        )
        .await
        .unwrap();
    a.await.unwrap();
    assert_eq!(
        response.scripts.unwrap()["postresponse"]["status"],
        "passed"
    );
    let saved = service.storage.load().unwrap();
    assert_eq!(saved.globals[0].value, "chain-token");
    assert!(saved.variable_revision > initial.variable_revision);
    assert_eq!(
        service.save_workspace(initial).unwrap_err().code,
        "VARIABLE_REVISION_CONFLICT"
    );
    let (url, b) = server("{}").await;
    let mut second = RequestSpec {
        url,
        ..Default::default()
    };
    second.headers.push(Pair {
        key: "Authorization".into(),
        value: "Bearer {{token}}".into(),
        ..Default::default()
    });
    service
        .send(saved, second, "b".into(), ExecutionContext::default())
        .await
        .unwrap();
    assert!(b
        .await
        .unwrap()
        .to_lowercase()
        .contains("authorization: bearer chain-token"));
    drop(service);
    let reopened = Storage::open(&dir.path().join("test.db")).unwrap();
    assert_eq!(reopened.load().unwrap().globals[0].value, "chain-token");
    let record = reopened.execution("a").unwrap().unwrap();
    assert!(!record.to_string().contains("chain-token"));
}
#[tokio::test]
async fn post_failure_preserves_http_response_rolls_back_variables_and_marks_execution_failed() {
    let dir = tempfile::tempdir().unwrap();
    let service = service(dir.path());
    let ws = service.save_workspace(Workspace::default()).unwrap();
    let (url, wire) = server("{}").await;
    let r = request(
        url,
        "pm.globals.set('x','partial'); throw new Error('missing data');",
    );
    let result = service
        .send(ws, r, "fail".into(), ExecutionContext::default())
        .await
        .unwrap();
    wire.await.unwrap();
    assert_eq!(result.status, 200);
    assert_eq!(result.body, "{}");
    assert_eq!(result.scripts.unwrap()["postresponse"]["status"], "failed");
    assert!(service.storage.load().unwrap().globals.is_empty());
    assert_eq!(
        service.storage.execution("fail").unwrap().unwrap()["status"],
        "failed"
    );
}
#[tokio::test]
async fn environment_switch_during_send_does_not_redirect_script_writes_or_lose_edits() {
    let dir = tempfile::tempdir().unwrap();
    let service = Arc::new(service(dir.path()));
    let mut ws = Workspace::default();
    for id in ["a", "b"] {
        ws.environments.push(Environment {
            id: id.into(),
            name: id.into(),
            variables: vec![],
            settings: json!({}),
            metadata: json!({}),
        });
    }
    ws.active_environment = Some("a".into());
    let ws = service.save_workspace(ws).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = tokio::sync::oneshot::channel();
    let wire = tokio::spawn(async move {
        let (mut s, _) = listener.accept().await.unwrap();
        let mut b = [0; 8192];
        let received = s.read(&mut b).await.unwrap();
        assert!(received > 0);
        ready_tx.send(()).unwrap();
        release_rx.await.unwrap();
        s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}")
            .await
            .unwrap();
    });
    let r = request(
        format!("http://{address}/"),
        "pm.environment.set('id','123')",
    );
    let context = ExecutionContext::from_workspace(&ws, &r, "manual");
    let runner = service.clone();
    let send = tokio::spawn(async move { runner.send(ws, r, "frozen".into(), context).await });
    ready_rx.await.unwrap();
    let mut changed = service.storage.load().unwrap();
    changed.active_environment = Some("b".into());
    changed.settings["unrelated"] = json!("retained");
    service.save_workspace(changed).unwrap();
    release_tx.send(()).unwrap();
    send.await.unwrap().unwrap();
    wire.await.unwrap();
    let saved = service.storage.load().unwrap();
    assert_eq!(saved.active_environment.as_deref(), Some("b"));
    assert_eq!(saved.settings["unrelated"], "retained");
    assert_eq!(saved.environments[0].variables[0].value, "123");
    assert!(saved.environments[1].variables.is_empty());
}
#[tokio::test]
async fn mcp_script_global_writes_are_rejected_and_keep_response() {
    let dir = tempfile::tempdir().unwrap();
    let service = service(dir.path());
    let ws = service.save_workspace(Workspace::default()).unwrap();
    let (url, wire) = server("{}").await;
    let r = request(url, "pm.globals.set('x','forbidden')");
    let result = service
        .send(
            ws,
            r,
            "mcp".into(),
            ExecutionContext {
                source: "mcp".into(),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    wire.await.unwrap();
    assert_eq!(result.scripts.unwrap()["postresponse"]["status"], "failed");
    assert!(service.storage.load().unwrap().globals.is_empty());
}

#[tokio::test]
async fn cancelling_pre_script_stops_execution_without_sending() {
    let dir = tempfile::tempdir().unwrap();
    let service = Arc::new(service(dir.path()));
    let ws = service.save_workspace(Workspace::default()).unwrap();
    let mut r = request("http://127.0.0.1:1/".into(), "");
    r.metadata["event"] = json!([{"listen":"prerequest","script":{"exec":"while(true) {}"}}]);
    let runner = service.clone();
    let task = tokio::spawn(async move {
        runner
            .send(ws, r, "cancel-pre".into(), ExecutionContext::default())
            .await
    });
    tokio::time::sleep(std::time::Duration::from_millis(30)).await;
    service.cancel("cancel-pre");
    let result = tokio::time::timeout(std::time::Duration::from_millis(500), task)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(result.unwrap_err().code, "REQUEST_CANCELLED");
    service.reserve_execution("cancel-pre").unwrap();
}
