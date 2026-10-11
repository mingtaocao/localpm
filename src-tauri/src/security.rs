use crate::{domain::*, variables};
use serde_json::Value;
pub fn sensitive_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "authorization"
            | "cookie"
            | "set-cookie"
            | "proxy-authorization"
            | "x-api-key"
            | "api-key"
            | "x-auth-token"
    )
}
pub fn sensitive_key(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "password"
            | "token"
            | "access_token"
            | "refresh_token"
            | "client_secret"
            | "secret"
            | "api_key"
            | "apikey"
            | "api-key"
            | "authorization"
            | "cookie"
            | "set-cookie"
            | "proxy-authorization"
            | "x-api-key"
            | "x-auth-token"
    )
}
pub fn redact_url(input: &str, vars: &Variables) -> String {
    let input = variables::redact(input, vars);
    let Ok(mut url) = url::Url::parse(&input) else {
        return input;
    };
    let _ = url.set_username("");
    let _ = url.set_password(None);
    let pairs: Vec<(String, String)> = url
        .query_pairs()
        .map(|(key, value)| {
            let value = if sensitive_key(&key) {
                "[redacted]".into()
            } else {
                value.into_owned()
            };
            (key.into_owned(), value)
        })
        .collect();
    if url.query().is_some() {
        url.query_pairs_mut().clear().extend_pairs(pairs);
    }
    url.to_string()
}
pub fn redact_text(input: &str, vars: &Variables) -> String {
    let input = variables::redact(input, vars);
    let urls = regex::Regex::new(r#"https?://[^\s\"<>]+"#).expect("static URL pattern");
    urls.replace_all(&input, |caps: &regex::Captures<'_>| {
        redact_url(&caps[0], vars)
    })
    .into_owned()
}
pub fn redact_value(value: &mut Value, vars: &Variables) {
    match value {
        Value::String(s) => *s = redact_text(s, vars),
        Value::Array(a) => {
            for v in a {
                redact_value(v, vars)
            }
        }
        Value::Object(o) => {
            let secret_pair = o.get("isSecret").and_then(Value::as_bool).unwrap_or(false)
                || o.get("key")
                    .and_then(Value::as_str)
                    .is_some_and(sensitive_key);
            if secret_pair && o.contains_key("value") {
                o.insert("value".into(), Value::String("[redacted]".into()));
            }
            o.remove("secretRef");
            for (k, v) in o {
                if sensitive_key(k) {
                    *v = Value::String("[redacted]".into())
                } else {
                    redact_value(v, vars)
                }
            }
        }
        _ => {}
    }
}
pub fn history_snapshot(request: &RequestSpec, vars: &Variables) -> RequestSpec {
    let mut r = request.clone();
    r.metadata = Value::Null;
    r.auth = serde_json::json!({"type":request.auth["type"],"redacted":true});
    for h in r.headers.iter_mut().chain(r.params.iter_mut()) {
        if h.is_secret || sensitive_header(&h.key) || sensitive_key(&h.key) {
            h.value = "[redacted]".into()
        }
        h.secret_ref = None;
    }
    if let Some(raw) = r.body["raw"].as_str() {
        if let Ok(mut parsed) = serde_json::from_str::<Value>(raw) {
            redact_value(&mut parsed, vars);
            r.body["raw"] = Value::String(parsed.to_string());
        }
    }
    let mut v = serde_json::to_value(&r).unwrap();
    redact_value(&mut v, vars);
    serde_json::from_value(v).unwrap()
}
pub fn response_preview(body: &str, vars: &Variables) -> String {
    let mut output = if let Ok(mut value) = serde_json::from_str::<Value>(body) {
        redact_value(&mut value, vars);
        value.to_string()
    } else {
        redact_text(body, vars)
    };
    let mut end = output.len().min(65536);
    while !output.is_char_boundary(end) {
        end -= 1
    }
    output.truncate(end);
    output
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn escaped_secrets_do_not_leak() {
        let secret = "a\"b\\c";
        let vars = [(
            "s".into(),
            VariableValue {
                value: secret.into(),
                scope: "Global".into(),
                secret: true,
            },
        )]
        .into();
        let r = RequestSpec {
            url: format!("https://host/{secret}"),
            body: serde_json::json!({"mode":"raw","raw":secret}),
            ..Default::default()
        };
        let out = history_snapshot(&r, &vars);
        assert!(!out.url.contains(secret));
        assert_eq!(out.body["raw"], "••••••••");
    }
    #[test]
    fn proxy_password_and_auth_redacted() {
        let r = RequestSpec {
            settings: serde_json::json!({"proxy":{"password":"sensitive"}}),
            auth: serde_json::json!({"type":"basic","password":"sensitive"}),
            ..Default::default()
        };
        let out = serde_json::to_string(&history_snapshot(&r, &Variables::new())).unwrap();
        assert!(!out.contains("sensitive"));
    }
    #[test]
    fn literal_pair_credentials_and_raw_json_are_redacted() {
        let r = RequestSpec {
            url: "https://user:url-password@host/path?token=query-secret&search=ok".into(),
            params: vec![Pair {
                key: "access_token".into(),
                value: "pair-secret".into(),
                secret_ref: Some("credential-id".into()),
                ..Default::default()
            }],
            body: serde_json::json!({"mode":"raw","raw":r#"{"password":"body-secret","name":"Jane"}"#}),
            ..Default::default()
        };
        let snapshot = history_snapshot(&r, &Variables::new());
        let out = serde_json::to_string(&snapshot).unwrap();
        for secret in [
            "url-password",
            "query-secret",
            "pair-secret",
            "body-secret",
            "credential-id",
        ] {
            assert!(!out.contains(secret), "leaked {secret}");
        }
        assert!(out.contains("Jane"));
        assert!(snapshot.url.contains("search=ok"));
        let mut form = serde_json::json!({"formdata":[{"key":"token","value":"form-secret"},{"key":"comment","value":"flagged-secret","isSecret":true},{"key":"name","value":"Jane"}]});
        redact_value(&mut form, &Variables::new());
        assert!(!form.to_string().contains("form-secret"));
        assert!(!form.to_string().contains("flagged-secret"));
        assert_eq!(form["formdata"][2]["value"], "Jane");
    }
}
