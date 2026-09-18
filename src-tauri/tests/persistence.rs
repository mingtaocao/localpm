use local_postman_lib::{domain::*, postman, storage::Storage};
use serde_json::json;
#[test]
fn complete_workspace_survives_restart_and_backup() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db");
    let mut w = Workspace::default();
    postman::import(json!({"info":{"name":"Persistent","schema":"https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},"variable":[{"key":"collection","value":"C"}],"item":[{"name":"Folder","item":[{"name":"Echo","request":{"method":"POST","url":"{{host}}/echo","body":{"mode":"raw","raw":"{}"}}}]}]}),&mut w).unwrap();
    postman::import(
        json!({"name":"DEV","values":[{"key":"host","value":"http://localhost"}]}),
        &mut w,
    )
    .unwrap();
    w.globals.push(Pair {
        key: "global".into(),
        value: "G".into(),
        ..Default::default()
    });
    w.active_environment = Some(w.environments[0].id.clone());
    let r = w.items[1].request.as_ref().unwrap();
    {
        let s = Storage::open(&path).unwrap();
        s.save(&w).unwrap();
        s.draft(&r.id, Some(r)).unwrap();
        s.add_history(r, &json!({"status":200}), 1000).unwrap();
        let mut cookies = reqwest_cookie_store::CookieStore::default();
        cookies
            .parse(
                "persistent=value; Max-Age=86400; HttpOnly; SameSite=Strict",
                &url::Url::parse("http://localhost/").unwrap(),
            )
            .unwrap();
        s.save_cookies(&cookies).unwrap();
        s.backup(&dir.path().join("backup.db")).unwrap();
    }
    let s = Storage::open(&path).unwrap();
    assert_eq!(
        serde_json::to_value(s.load().unwrap()).unwrap(),
        serde_json::to_value(w).unwrap()
    );
    assert_eq!(s.drafts().unwrap().len(), 1);
    assert_eq!(s.history().unwrap()[0]["response"]["status"], 200);
    assert_eq!(s.cookies().unwrap().iter_unexpired().count(), 1);
    let backup = Storage::open(&dir.path().join("backup.db")).unwrap();
    assert_eq!(backup.load().unwrap().collections[0].name, "Persistent");
}
