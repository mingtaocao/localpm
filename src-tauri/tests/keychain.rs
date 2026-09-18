use local_postman_lib::{domain::*, variables};
#[test]
#[ignore = "Requires an interactive OS credential store; run explicitly on the native host"]
fn os_secret_store_roundtrip() {
    let id = format!("acceptance-{}", uuid::Uuid::new_v4());
    let entry = keyring::Entry::new("LocalPostman", &id).unwrap();
    entry
        .set_password("local-postman-disposable-test-value")
        .unwrap();
    let mut w = Workspace::default();
    w.globals.push(Pair {
        key: "secret".into(),
        secret_ref: Some(id),
        is_secret: true,
        ..Default::default()
    });
    let vars = variables::context(&w, None).unwrap();
    assert_eq!(
        variables::resolve("{{secret}}", &vars).unwrap(),
        "local-postman-disposable-test-value"
    );
    assert_eq!(
        variables::redact("local-postman-disposable-test-value", &vars),
        "••••••••"
    );
    entry.delete_credential().unwrap();
}
