//! Bounded JavaScript runtime shared by manual requests and frozen MCP previews.
use crate::{domain::*, http::PreparedRequest, variables};
use rquickjs::{context::EvalOptions, Context, Function, Runtime};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Change {
    pub scope: String,
    pub key: String,
    pub value: Option<String>,
}
#[derive(Clone)]
pub struct Execution {
    pub workspace: Workspace,
    pub before: Vec<Change>,
    pub report: Value,
    pub local: Value,
}
#[derive(Default, Deserialize)]
struct Output {
    changes: Vec<Change>,
    logs: Vec<Value>,
    tests: Vec<Value>,
    #[serde(default)]
    local: Value,
}

pub fn enabled(r: &RequestSpec) -> bool {
    r.metadata["localpmScriptsEnabled"] == true
}
fn events(metadata: &Value, phase: &str, label: &str, out: &mut Vec<(String, String)>) {
    if let Some(events) = metadata["event"].as_array() {
        for event in events
            .iter()
            .filter(|e| e["listen"] == phase && e["disabled"] != true)
        {
            let exec = &event["script"]["exec"];
            let code = exec.as_str().map(str::to_string).unwrap_or_else(|| {
                exec.as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(Value::as_str)
                            .collect::<Vec<_>>()
                            .join("\n")
                    })
                    .unwrap_or_default()
            });
            if !code.trim().is_empty() {
                out.push((label.into(), code));
            }
        }
    }
}
fn sources(ws: &Workspace, r: &RequestSpec, phase: &str) -> Vec<(String, String)> {
    let mut out = vec![];
    let item = ws
        .items
        .iter()
        .find(|i| i.request.as_ref().is_some_and(|x| x.id == r.id));
    if let Some(item) = item {
        if let Some(c) = ws.collections.iter().find(|c| c.id == item.collection_id) {
            events(&c.metadata, phase, &c.name, &mut out);
        }
        let mut parents = vec![];
        let mut next = item.parent_id.clone();
        let mut seen = HashSet::new();
        while let Some(id) = next {
            if !seen.insert(id.clone()) {
                break;
            }
            if let Some(parent) = ws.items.iter().find(|i| i.id == id) {
                parents.push(parent);
                next = parent.parent_id.clone();
            } else {
                break;
            }
        }
        for parent in parents.into_iter().rev() {
            events(&parent.metadata, phase, &parent.name, &mut out);
        }
    }
    // Request editor overrides imported item-level event data, including an empty list.
    if r.metadata.get("event").is_some() {
        events(&r.metadata, phase, &r.name, &mut out);
    } else if let Some(item) = item {
        events(&item.metadata, phase, &r.name, &mut out);
    }
    out
}
fn scope_values(rows: &[Pair]) -> Result<Value> {
    let mut ws = Workspace {
        globals: rows.to_vec(),
        ..Default::default()
    };
    for p in &mut ws.globals {
        if !p.value.is_empty() {
            p.secret_ref = None;
        }
    }
    Ok(Value::Object(
        variables::context(&ws, None)?
            .into_iter()
            .map(|(k, v)| (k, json!(v.value)))
            .collect(),
    ))
}
fn runtime_error(ctx: &rquickjs::Ctx<'_>, error: rquickjs::Error) -> String {
    if error.is_exception() {
        let caught = ctx.catch();
        if let Some(obj) = caught.as_object() {
            let message = obj
                .get::<_, String>("message")
                .unwrap_or_else(|_| "Script error".into());
            let stack = obj.get::<_, String>("stack").unwrap_or_default();
            return format!("{message}\n{stack}").chars().take(4096).collect();
        }
        caught
            .as_string()
            .and_then(|s| s.to_string().ok())
            .unwrap_or_else(|| "Script exception".into())
    } else {
        error.to_string()
    }
}
fn run(
    ws: &Workspace,
    r: &RequestSpec,
    phase: &str,
    response: Option<&Response>,
    local: Value,
    cancel: &CancellationToken,
) -> Result<(Output, Value)> {
    let scripts = sources(ws, r, phase);
    if scripts.is_empty() {
        return Ok((
            Output {
                local,
                ..Default::default()
            },
            json!({"phase":phase,"status":"skipped","logs":[],"tests":[]}),
        ));
    }
    let item = ws
        .items
        .iter()
        .find(|i| i.request.as_ref().is_some_and(|x| x.id == r.id));
    let collection = item.and_then(|i| ws.collections.iter().find(|c| c.id == i.collection_id));
    let environment = ws
        .environments
        .iter()
        .find(|e| Some(&e.id) == ws.active_environment.as_ref());
    let input = json!({"phase":phase,"request":r,"response":response,"environmentId":ws.active_environment,"collectionId":collection.map(|c|&c.id),"scopes":{"global":scope_values(&ws.globals)?,"collection":scope_values(collection.map(|c|c.variables.as_slice()).unwrap_or_default())?,"environment":scope_values(environment.map(|e|e.variables.as_slice()).unwrap_or_default())?,"local":local}});
    let rt = Runtime::new().map_err(|e| AppError::new("SCRIPT_RUNTIME", e))?;
    rt.set_memory_limit(64 * 1024 * 1024);
    rt.set_max_stack_size(512 * 1024);
    let deadline = Instant::now() + Duration::from_secs(1);
    let token = cancel.clone();
    rt.set_interrupt_handler(Some(Box::new(move || {
        token.is_cancelled() || Instant::now() >= deadline
    })));
    let used_async = std::rc::Rc::new(std::cell::Cell::new(false));
    let async_capture = used_async.clone();
    rt.set_promise_hook(Some(Box::new(move |_, _, _, _| async_capture.set(true))));
    let ctx = Context::full(&rt).map_err(|e| AppError::new("SCRIPT_RUNTIME", e))?;
    ctx.with(|ctx| {
        let bootstrap: Function = ctx.eval(include_str!("script_runtime.js")).map_err(|e|AppError::new("SCRIPT_RUNTIME",runtime_error(&ctx,e)))?;
        let output: Function = bootstrap.call((input.to_string(),)).map_err(|e|AppError::new("SCRIPT_RUNTIME",runtime_error(&ctx,e)))?;
        used_async.set(false);
        let mut failure = None;
        for (label,code) in scripts {
            if code.len()>256*1024 { failure=Some(format!("{label}: Script exceeds 256 KB")); break; }
            // A function scope allows top-level return and isolates declarations between levels.
            let mut options=EvalOptions::default(); options.filename=Some(format!("{phase}: {label}"));
            match ctx.eval_with_options::<rquickjs::Value,_>(format!("(function(){{{code}\n}}).call(undefined);"),options) {
                Err(e) => { failure=Some(format!("{label}: {}",runtime_error(&ctx,e))); break; },
                Ok(value) if value.is_promise() => { failure=Some("Asynchronous scripts are not supported".into()); break; },
                _ => {}
            }
            if cancel.is_cancelled() || Instant::now()>=deadline { failure=Some("Script cancelled or timed out".into()); break; }
            if used_async.get() { failure=Some("Asynchronous scripts are not supported".into()); break; }
        }
        if cancel.is_cancelled() || Instant::now()>=deadline {
            return Ok((Output::default(),json!({"phase":phase,"status":"failed","error":if cancel.is_cancelled(){"Script cancelled"}else{"Script exceeded 1000 ms"},"logs":[],"tests":[]})));
        }
        let raw: String = output.call(()).map_err(|e|AppError::new("SCRIPT_RUNTIME",runtime_error(&ctx,e)))?;
        let mut result: Output = serde_json::from_str(&raw).map_err(|e|AppError::new("SCRIPT_RUNTIME",e))?;
        let mut report = json!({"phase":phase,"status":if failure.is_some(){"failed"}else{"passed"},"error":failure,"logs":result.logs,"tests":result.tests});
        let mut secrets=variables::context(ws,collection.map(|c|c.id.as_str()))?;
        for c in &result.changes {
            if crate::security::sensitive_key(&c.key) || secrets.get(&c.key).is_some_and(|v|v.secret) {
                if let Some(value)=&c.value { secrets.insert(format!("__script_{}",c.key),VariableValue {value:value.clone(),scope:c.scope.clone(),secret:true}); }
            }
        }
        for (key,value) in secrets.iter_mut() { if crate::security::sensitive_key(key) { value.secret=true; } }
        crate::security::redact_value(&mut report,&secrets);
        if failure.is_some() { result.changes.clear(); }
        Ok((result,report))
    })
}
pub fn apply(
    ws: &mut Workspace,
    changes: &[Change],
    environment: Option<&str>,
    collection: Option<&str>,
) -> Result<()> {
    if changes.len() > 1000 {
        return Err(AppError::new("SCRIPT_LIMIT", "Too many variable changes"));
    }
    for c in changes {
        if c.key.trim().is_empty()
            || c.key.len() > 4096
            || c.value.as_ref().is_some_and(|v| v.len() > 1024 * 1024)
        {
            return Err(AppError::new(
                "SCRIPT_LIMIT",
                "Variable name or value exceeds limit",
            ));
        }
        let rows = match c.scope.as_str() {
            "global" => &mut ws.globals,
            "environment" => {
                &mut ws
                    .environments
                    .iter_mut()
                    .find(|e| Some(e.id.as_str()) == environment)
                    .ok_or_else(|| {
                        AppError::new(
                            "SCRIPT_SCOPE_MISSING",
                            "Script environment no longer exists",
                        )
                    })?
                    .variables
            }
            "collection" => {
                &mut ws
                    .collections
                    .iter_mut()
                    .find(|e| Some(e.id.as_str()) == collection)
                    .ok_or_else(|| {
                        AppError::new("SCRIPT_SCOPE_MISSING", "Script collection no longer exists")
                    })?
                    .variables
            }
            _ => {
                return Err(AppError::new(
                    "SCRIPT_SCOPE_INVALID",
                    "Unknown script variable scope",
                ))
            }
        };
        if let Some(value) = &c.value {
            if let Some(pair) = rows.iter_mut().find(|p| p.key == c.key) {
                pair.value = value.clone();
                pair.enabled = true;
            } else {
                rows.push(Pair {
                    key: c.key.clone(),
                    value: value.clone(),
                    ..Default::default()
                });
            }
        } else {
            rows.retain(|p| p.key != c.key);
        }
    }
    Ok(())
}
pub fn collection_id(ws: &Workspace, r: &RequestSpec) -> Option<String> {
    ws.items
        .iter()
        .find(|i| i.request.as_ref().is_some_and(|x| x.id == r.id))
        .map(|i| i.collection_id.clone())
}
pub fn prepare(ws: &Workspace, r: &RequestSpec) -> Result<PreparedRequest> {
    prepare_with_cancel(ws, r, &CancellationToken::new())
}
pub fn prepare_with_cancel(
    ws: &Workspace,
    r: &RequestSpec,
    cancel: &CancellationToken,
) -> Result<PreparedRequest> {
    if !enabled(r) {
        return crate::http::prepare(ws, r);
    }
    // Frozen MCP previews retain only this request's scopes and ancestry.
    let cid = collection_id(ws, r);
    let mut ancestry = HashSet::new();
    let mut current = ws
        .items
        .iter()
        .find(|i| i.request.as_ref().is_some_and(|x| x.id == r.id));
    while let Some(item) = current {
        if !ancestry.insert(item.id.clone()) {
            break;
        }
        current = item
            .parent_id
            .as_ref()
            .and_then(|id| ws.items.iter().find(|i| &i.id == id));
    }
    let snapshot = Workspace {
        variable_revision: ws.variable_revision,
        collections: ws
            .collections
            .iter()
            .filter(|c| Some(&c.id) == cid.as_ref())
            .cloned()
            .collect(),
        items: ws
            .items
            .iter()
            .filter(|i| ancestry.contains(&i.id))
            .cloned()
            .collect(),
        environments: ws
            .environments
            .iter()
            .filter(|e| Some(&e.id) == ws.active_environment.as_ref())
            .cloned()
            .collect(),
        globals: ws.globals.clone(),
        settings: ws.settings.clone(),
        active_environment: ws.active_environment.clone(),
    };
    let ws = &snapshot;
    let (out, report) = run(ws, r, "prerequest", None, json!({}), cancel)?;
    if report["status"] == "failed" {
        let mut error = AppError::new(
            "SCRIPT_PRE_REQUEST_FAILED",
            report["error"]
                .as_str()
                .unwrap_or("Pre-request script failed"),
        );
        error.details = Some(json!({"scripts":{"prerequest":report}}));
        return Err(error);
    }
    let mut working = ws.clone();
    let cid = collection_id(ws, r);
    apply(
        &mut working,
        &out.changes,
        ws.active_environment.as_deref(),
        cid.as_deref(),
    )?;
    // Local variables override persistent scopes only for this execution.
    if let Some(values) = out.local.as_object() {
        let rows = values
            .iter()
            .map(|(k, v)| Pair {
                key: k.clone(),
                value: v.as_str().unwrap_or_default().into(),
                ..Default::default()
            })
            .collect::<Vec<_>>();
        if let Some(e) = working
            .environments
            .iter_mut()
            .find(|e| Some(&e.id) == working.active_environment.as_ref())
        {
            e.variables.extend(rows);
        } else if let Some(c) = working
            .collections
            .iter_mut()
            .find(|c| Some(&c.id) == cid.as_ref())
        {
            c.variables.extend(rows);
        } else {
            working.globals.extend(rows);
        }
    }
    for rows in std::iter::once(&mut working.globals)
        .chain(working.collections.iter_mut().map(|c| &mut c.variables))
        .chain(working.environments.iter_mut().map(|e| &mut e.variables))
    {
        for pair in rows {
            if !pair.value.is_empty() {
                pair.secret_ref = None;
            }
        }
    }
    let mut prepared = crate::http::prepare(&working, r)?;
    for (key, value) in prepared.vars.iter_mut() {
        if crate::security::sensitive_key(key) {
            value.secret = true;
        }
    }
    // Keep persistent scope snapshots free of the ephemeral overrides.
    let mut persistent = ws.clone();
    apply(
        &mut persistent,
        &out.changes,
        ws.active_environment.as_deref(),
        cid.as_deref(),
    )?;
    prepared.scripts = Some(Execution {
        workspace: persistent,
        before: out.changes,
        report: json!({"prerequest":report}),
        local: out.local,
    });
    Ok(prepared)
}
pub fn post(
    execution: &Execution,
    r: &RequestSpec,
    response: &Response,
    cancel: &CancellationToken,
) -> Result<(Vec<Change>, Value)> {
    let (out, report) = run(
        &execution.workspace,
        r,
        "test",
        Some(response),
        execution.local.clone(),
        cancel,
    )?;
    Ok((out.changes, report))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(pre: &str, post: &str) -> RequestSpec {
        RequestSpec {
            url: "http://localhost/{{name}}".into(),
            metadata: json!({"localpmScriptsEnabled":true,"event":[{"listen":"prerequest","script":{"exec":pre}},{"listen":"test","script":{"exec":post}}]}),
            ..Default::default()
        }
    }
    fn workspace() -> Workspace {
        let mut ws = Workspace::default();
        ws.globals.push(Pair {
            key: "name".into(),
            value: "original".into(),
            ..Default::default()
        });
        ws
    }
    fn response() -> Response {
        serde_json::from_value(json!({"status":200,"statusText":"OK","headers":[["X-Token","header-token"]],"body":"{\"data\":{\"token\":\"new-token\"}}","duration":1,"size":31,"contentType":"application/json","finalUrl":"http://localhost/","redirects":[],"file":"","truncated":false,"binary":false})).unwrap()
    }
    #[test]
    fn pre_local_overrides_without_persisting_and_post_extracts_json() {
        let r=request("pm.globals.set('name','persistent'); pm.variables.set('name','local');", "const body=pm.response.json(); pm.globals.set('token',body.data.token); pm.test('status',()=>pm.expect(pm.response.code).to.equal(200)); console.log('received',body.data.token);");
        let prepared = prepare(&workspace(), &r).unwrap();
        assert_eq!(prepared.url, "http://localhost/local");
        let execution = prepared.scripts.unwrap();
        assert_eq!(execution.workspace.globals[0].value, "persistent");
        let (changes, report) =
            post(&execution, &r, &response(), &CancellationToken::new()).unwrap();
        assert_eq!(changes[0].value.as_deref(), Some("new-token"));
        assert_eq!(report["tests"][0]["passed"], true);
        assert!(!report.to_string().contains("new-token"));
    }
    #[test]
    fn failure_discards_phase_writes_and_preserves_error() {
        let r=request("", "pm.globals.set('token','private-token'); console.log('private-token'); throw new Error('private-token');");
        let p = prepare(&workspace(), &r).unwrap();
        let (changes, report) = post(
            p.scripts.as_ref().unwrap(),
            &r,
            &response(),
            &CancellationToken::new(),
        )
        .unwrap();
        assert!(changes.is_empty());
        assert_eq!(report["status"], "failed");
        assert!(!report.to_string().contains("private-token"));
    }
    #[test]
    fn stops_infinite_loop_and_rejects_host_access_and_async() {
        let start = Instant::now();
        assert!(prepare(&workspace(), &request("while(true) {}", "")).is_err());
        assert!(start.elapsed() < Duration::from_secs(3));
        for code in [
            "require('fs')",
            "fetch('http://localhost')",
            "return Promise.resolve(1)",
            "Promise.reject(new Error('async'));",
            "(async()=>{await 1; pm.globals.set('x','bad')})()",
        ] {
            assert!(prepare(&workspace(), &request(code, "")).is_err(), "{code}");
        }
        let token = CancellationToken::new();
        token.cancel();
        assert!(prepare_with_cancel(&workspace(), &request("while(true) {}", ""), &token).is_err());
    }
    #[test]
    fn imported_scripts_are_disabled_until_opted_in_and_exports_use_edits() {
        let mut ws = Workspace::default();
        crate::postman::import(json!({"info":{"name":"scripts","schema":"https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},"item":[{"name":"A","request":{"url":"http://localhost/","method":"GET"},"event":[{"listen":"test","script":{"exec":["throw new Error('do not execute')"]}}]}]}),&mut ws).unwrap();
        let mut r = ws.items[0].request.clone().unwrap();
        assert!(prepare(&ws, &r).unwrap().scripts.is_none());
        r.metadata["event"] =
            json!([{"listen":"test","script":{"exec":["pm.globals.set('a','b')"]}}]);
        r.metadata["localpmScriptsEnabled"] = json!(true);
        ws.items[0].request = Some(r);
        let exported = crate::postman::export(&ws, &ws.collections[0].id).unwrap();
        assert_eq!(
            exported["item"][0]["event"][0]["script"]["exec"][0],
            "pm.globals.set('a','b')"
        );
        assert!(exported["item"][0]["request"].get("event").is_none());
        assert!(exported["item"][0]["request"]
            .get("localpmScriptsEnabled")
            .is_none());
    }
    #[test]
    fn hierarchical_order_and_environment_scope_are_frozen() {
        let mut ws = workspace();
        let mut r = request(
            "pm.globals.set('name',pm.globals.get('name')+'-request');",
            "",
        );
        ws.collections.push(Collection {id:"c".into(),name:"C".into(),auth:json!({}),variables:vec![],metadata:json!({"event":[{"listen":"prerequest","script":{"exec":"pm.globals.set('name','collection')"}}]})});
        ws.items.push(Item {id:"folder".into(),collection_id:"c".into(),parent_id:None,kind:"folder".into(),name:"F".into(),order:0.,auth:json!({}),request:None,metadata:json!({"event":[{"listen":"prerequest","script":{"exec":"pm.globals.set('name',pm.globals.get('name')+'-folder')"}}]})});
        ws.items.push(Item {
            id: "item".into(),
            collection_id: "c".into(),
            parent_id: Some("folder".into()),
            kind: "request".into(),
            name: "R".into(),
            order: 0.,
            auth: json!({}),
            request: Some(r.clone()),
            metadata: json!({}),
        });
        assert_eq!(
            prepare(&ws, &r).unwrap().url,
            "http://localhost/collection-folder-request"
        );
        r.metadata["event"] =
            json!([{"listen":"prerequest","script":{"exec":"pm.environment.set('name','env')"}}]);
        assert!(prepare(&ws, &r).is_err());
        ws.environments.push(Environment {
            id: "e".into(),
            name: "E".into(),
            variables: vec![],
            settings: json!({}),
            metadata: json!({}),
        });
        ws.active_environment = Some("e".into());
        assert_eq!(prepare(&ws, &r).unwrap().url, "http://localhost/env");
    }
    #[test]
    fn synchronous_assertions_record_failures_and_continue() {
        let r=request("", "pm.test('deep',()=>pm.expect({b:2,a:1}).to.deep.equal({a:1,b:2})); pm.test('types',()=>{pm.expect([1]).to.be.an('array');pm.expect(true).to.be.true;pm.expect(1).to.be.below(3)});pm.test('failed',()=>pm.expect(1).to.equal(2));pm.test('after',()=>pm.response.to.have.status(200));");
        let p = prepare(&workspace(), &r).unwrap();
        let (_, report) = post(
            p.scripts.as_ref().unwrap(),
            &r,
            &response(),
            &CancellationToken::new(),
        )
        .unwrap();
        assert_eq!(report["status"], "passed");
        assert_eq!(report["tests"][0]["passed"], true);
        assert_eq!(report["tests"][1]["passed"], true);
        assert_eq!(report["tests"][2]["passed"], false);
        assert_eq!(report["tests"][3]["passed"], true);
    }
    #[test]
    fn binary_and_truncated_response_json_is_rejected() {
        let r = request("", "pm.response.json()");
        let p = prepare(&workspace(), &r).unwrap();
        let mut response = response();
        response.truncated = true;
        assert_eq!(
            post(
                p.scripts.as_ref().unwrap(),
                &r,
                &response,
                &CancellationToken::new()
            )
            .unwrap()
            .1["status"],
            "failed"
        );
    }
}
