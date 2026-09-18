use local_postman_lib::{
    domain::*,
    http::{prepare, HttpEngine},
};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
async fn server(proxy: bool) -> (String, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let handle = tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                break;
            };
            tokio::spawn(async move {
                let mut input = vec![];
                let mut chunk = [0; 8192];
                let head_end;
                loop {
                    let n = socket.read(&mut chunk).await.unwrap_or(0);
                    if n == 0 {
                        return;
                    }
                    input.extend_from_slice(&chunk[..n]);
                    if let Some(pos) = input.windows(4).position(|s| s == b"\r\n\r\n") {
                        head_end = pos + 4;
                        break;
                    }
                }
                let header = String::from_utf8_lossy(&input[..head_end]).into_owned();
                let len = header
                    .lines()
                    .find_map(|l| {
                        l.to_lowercase()
                            .strip_prefix("content-length:")
                            .and_then(|s| s.trim().parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                while input.len() < head_end + len {
                    let n = socket.read(&mut chunk).await.unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    input.extend_from_slice(&chunk[..n]);
                }
                let path = header.split_whitespace().nth(1).unwrap_or("/");
                if path.contains("/delay") {
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await
                }
                let mut status = "200 OK";
                let mut extra = String::new();
                let mut body=json!({"request":header,"body":String::from_utf8_lossy(&input[head_end..]),"proxy":proxy}).to_string();
                if path == "/redirect" {
                    status = "302 Found";
                    extra = "Location: /echo\r\n".into()
                }
                if path == "/cookie" {
                    extra = "Set-Cookie: session=abc; Path=/; HttpOnly; SameSite=Lax\r\n".into()
                }
                if path == "/large" {
                    body = "x".repeat(21 * 1024 * 1024)
                }
                if path == "/status/418" {
                    status = "418 I'm a teapot"
                }
                if path.contains("/proxy-auth")
                    && !header.to_lowercase().contains("proxy-authorization")
                {
                    status = "407 Proxy Authentication Required"
                }
                let response=format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{extra}Connection: close\r\n\r\n{body}",body.len());
                let _ = socket.write_all(response.as_bytes()).await;
            });
        }
    });
    (format!("http://{addr}"), handle)
}
fn request(url: String) -> RequestSpec {
    RequestSpec {
        url,
        ..Default::default()
    }
}
async fn execute(engine: &HttpEngine, w: &Workspace, r: &RequestSpec) -> Result<Response> {
    engine
        .execute(prepare(w, r)?, uuid::Uuid::new_v4().to_string())
        .await
}
#[tokio::test]
async fn methods_headers_query_and_raw_body() {
    let (url, server) = server(false).await;
    let dir = tempfile::tempdir().unwrap();
    let engine = HttpEngine::new(dir.path().into());
    for method in ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "CUSTOM"] {
        let r = RequestSpec {
            method: method.into(),
            url: format!("{url}/echo"),
            params: vec![Pair {
                key: "q".into(),
                value: "a b".into(),
                ..Default::default()
            }],
            headers: vec![Pair {
                key: "X-Test".into(),
                value: "yes".into(),
                ..Default::default()
            }],
            body: json!({"mode":"raw","raw":"{\"value\":42}","options":{"raw":{"language":"json"}}}),
            ..Default::default()
        };
        let result = execute(&engine, &Workspace::default(), &r).await.unwrap();
        assert_eq!(result.status, 200);
        let v: Value = serde_json::from_str(&result.body).unwrap();
        assert!(v["request"]
            .as_str()
            .unwrap()
            .starts_with(&format!("{method} /echo?q=a+b")));
        assert!(v["request"].as_str().unwrap().contains("x-test: yes"));
        assert_eq!(v["body"], "{\"value\":42}");
    }
    server.abort();
}
#[tokio::test]
async fn form_and_streaming_files() {
    let (url, server) = server(false).await;
    let dir = tempfile::tempdir().unwrap();
    let engine = HttpEngine::new(dir.path().into());
    let file = dir.path().join("upload.txt");
    std::fs::write(&file, "streamed contents").unwrap();
    for body in [
        json!({"mode":"urlencoded","urlencoded":[{"key":"q","value":"a b"},{"key":"hidden","value":"no","disabled":true}]}),
        json!({"mode":"formdata","formdata":[{"key":"message","value":"hello","type":"text"},{"key":"upload","type":"file","src":file}]}),
        json!({"mode":"file","file":{"src":file}}),
    ] {
        let r = RequestSpec {
            method: "POST".into(),
            url: format!("{url}/upload"),
            body: body.clone(),
            ..Default::default()
        };
        let response = execute(&engine, &Workspace::default(), &r).await.unwrap();
        let v: Value = serde_json::from_str(&response.body).unwrap();
        let text = v["body"].as_str().unwrap();
        match body["mode"].as_str().unwrap() {
            "urlencoded" => assert_eq!(text, "q=a+b"),
            "formdata" => {
                assert!(text.contains("streamed contents"));
                assert!(text.contains("hello"));
            }
            _ => assert_eq!(text, "streamed contents"),
        }
    }
    server.abort();
}
#[tokio::test]
async fn redirects_cookies_explicit_override() {
    let (url, server) = server(false).await;
    let dir = tempfile::tempdir().unwrap();
    let e = HttpEngine::new(dir.path().into());
    let w = Workspace::default();
    let result = execute(&e, &w, &request(format!("{url}/redirect")))
        .await
        .unwrap();
    assert_eq!(result.status, 200);
    assert_eq!(result.redirects.len(), 2);
    let mut r = request(format!("{url}/redirect"));
    r.settings = json!({"followRedirect":false});
    assert_eq!(execute(&e, &w, &r).await.unwrap().status, 302);
    execute(&e, &w, &request(format!("{url}/cookie")))
        .await
        .unwrap();
    let mut r = request(format!("{url}/echo"));
    assert!(execute(&e, &w, &r)
        .await
        .unwrap()
        .body
        .contains("session=abc"));
    r.headers.push(Pair {
        key: "Cookie".into(),
        value: "manual=1".into(),
        ..Default::default()
    });
    let response = execute(&e, &w, &r).await.unwrap();
    assert!(response.body.contains("manual=1"));
    assert!(!response.body.contains("session=abc"));
    server.abort();
}
#[tokio::test]
async fn timeout_and_cancel() {
    let (url, server) = server(false).await;
    let dir = tempfile::tempdir().unwrap();
    let engine = Arc::new(HttpEngine::new(dir.path().into()));
    let mut r = request(format!("{url}/delay"));
    r.settings = json!({"timeout":20});
    assert_eq!(
        execute(&engine, &Workspace::default(), &r)
            .await
            .unwrap_err()
            .code,
        "REQUEST_TIMEOUT"
    );
    r.settings = json!({"timeout":1000});
    let p = prepare(&Workspace::default(), &r).unwrap();
    let e = engine.clone();
    let task = tokio::spawn(async move { e.execute(p, "cancel-me".into()).await });
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    engine.cancel("cancel-me");
    assert_eq!(task.await.unwrap().unwrap_err().code, "REQUEST_CANCELLED");
    server.abort();
}
#[tokio::test]
async fn manual_proxy_no_proxy_and_unavailable() {
    let (proxy, proxy_server) = server(true).await;
    let (url, server) = server(false).await;
    let dir = tempfile::tempdir().unwrap();
    let engine = HttpEngine::new(dir.path().into());
    let mut r = request(format!("{url}/echo"));
    r.settings = json!({"proxy":{"mode":"manual","url":proxy}});
    assert!(execute(&engine, &Workspace::default(), &r)
        .await
        .unwrap()
        .body
        .contains("\"proxy\":true"));
    r.settings["proxy"]["noProxy"] = json!("127.0.0.*");
    assert!(execute(&engine, &Workspace::default(), &r)
        .await
        .unwrap()
        .body
        .contains("\"proxy\":false"));
    r.settings = json!({"proxy":{"mode":"manual","url":"http://127.0.0.1:1"}});
    assert_eq!(
        execute(&engine, &Workspace::default(), &r)
            .await
            .unwrap_err()
            .code,
        "PROXY_CONNECT_FAILED"
    );
    r.url = format!("{url}/proxy-auth");
    r.settings = json!({"proxy":{"mode":"manual","url":proxy}});
    assert_eq!(
        execute(&engine, &Workspace::default(), &r)
            .await
            .unwrap_err()
            .code,
        "PROXY_AUTHENTICATION_FAILED"
    );
    r.settings["proxy"]["username"] = json!("test-user");
    assert_eq!(
        execute(&engine, &Workspace::default(), &r)
            .await
            .unwrap()
            .status,
        200
    );
    server.abort();
    proxy_server.abort();
}
#[tokio::test]
async fn large_response_is_saved_without_preview() {
    let (url, server) = server(false).await;
    let dir = tempfile::tempdir().unwrap();
    let engine = HttpEngine::new(dir.path().into());
    let response = execute(
        &engine,
        &Workspace::default(),
        &request(format!("{url}/large")),
    )
    .await
    .unwrap();
    assert!(response.truncated);
    assert!(response.body.is_empty());
    assert_eq!(
        std::fs::metadata(response.file).unwrap().len(),
        21 * 1024 * 1024
    );
    server.abort();
}
#[tokio::test]
async fn imported_request_executes() {
    let (url, server) = server(false).await;
    let mut w = Workspace::default();
    local_postman_lib::postman::import(json!({"info":{"name":"Test","schema":"https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},"variable":[{"key":"host","value":url}],"item":[{"name":"Echo","request":{"method":"GET","url":"{{host}}/echo","auth":{"type":"bearer","bearer":[{"key":"token","value":"example-token"}]}}}]}),&mut w).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let engine = HttpEngine::new(dir.path().into());
    let response = execute(&engine, &w, w.items[0].request.as_ref().unwrap())
        .await
        .unwrap();
    assert!(response.body.contains("Bearer example-token"));
    server.abort();
}

#[tokio::test]
async fn all_variable_scopes_auth_inheritance_and_environment_switch() {
    let (url, server) = server(false).await;
    let mut w = Workspace::default();
    local_postman_lib::postman::import(json!({"info":{"name":"Scopes","schema":"https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},"auth":{"type":"bearer","bearer":[{"key":"token","value":"collection-token"}]},"variable":[{"key":"collection","value":"C"},{"key":"priority","value":"collection"}],"item":[{"name":"Folder","auth":{"type":"basic","basic":[{"key":"username","value":"u"},{"key":"password","value":"p"}]},"item":[{"name":"Request","request":{"method":"POST","url":"{{host}}/echo","header":[{"key":"X-Global","value":"{{global}}"},{"key":"X-Collection","value":"{{collection}}"},{"key":"X-Priority","value":"{{priority}}"}],"body":{"mode":"raw","raw":"{{global}}/{{collection}}/{{environment}}"}}}]}]}),&mut w).unwrap();
    w.globals = vec![
        Pair {
            key: "global".into(),
            value: "G".into(),
            ..Default::default()
        },
        Pair {
            key: "priority".into(),
            value: "global".into(),
            ..Default::default()
        },
    ];
    w.environments.push(Environment {
        id: "dev".into(),
        name: "DEV".into(),
        variables: vec![
            Pair {
                key: "host".into(),
                value: url.clone(),
                ..Default::default()
            },
            Pair {
                key: "environment".into(),
                value: "DEV".into(),
                ..Default::default()
            },
            Pair {
                key: "priority".into(),
                value: "environment".into(),
                ..Default::default()
            },
        ],
        settings: json!({}),
        metadata: Value::Null,
    });
    let mut test = w.environments[0].clone();
    test.id = "test".into();
    test.variables[1].value = "TEST".into();
    w.environments.push(test);
    w.active_environment = Some("dev".into());
    let r = w.items.iter().find_map(|i| i.request.clone()).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let engine = HttpEngine::new(dir.path().into());
    let response = execute(&engine, &w, &r).await.unwrap();
    assert!(response.body.contains("G/C/DEV"));
    assert!(response.body.contains("Basic dTpw"));
    assert!(response.body.contains("x-priority: environment"));
    w.active_environment = Some("test".into());
    assert!(execute(&engine, &w, &r)
        .await
        .unwrap()
        .body
        .contains("G/C/TEST"));
    let mut r = r;
    r.auth = json!({"type":"apikey","key":"api_key","value":"key123","in":"query"});
    assert!(execute(&engine, &w, &r)
        .await
        .unwrap()
        .body
        .contains("api_key=key123"));
    r.auth = json!({"type":"apikey","key":"X-API-Key","value":"key123","in":"header"});
    assert!(execute(&engine, &w, &r)
        .await
        .unwrap()
        .body
        .contains("x-api-key: key123"));
    server.abort();
}
