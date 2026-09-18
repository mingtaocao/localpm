//! All certificates in this file are disposable localhost test fixtures.
use local_postman_lib::{
    domain::*,
    http::{prepare, HttpEngine},
};
use serde_json::json;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
use tokio_rustls::{
    rustls::{
        pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer},
        ServerConfig,
    },
    TlsAcceptor,
};
#[tokio::test]
async fn tls_verification_disabled_and_custom_ca() {
    let cert =
        CertificateDer::from(include_bytes!("../../testdata/tls/localhost-test.cert.der").to_vec());
    let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(
        include_bytes!("../../testdata/tls/localhost-test.key.der").to_vec(),
    ));
    let config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(vec![cert], key)
        .unwrap();
    let acceptor = TlsAcceptor::from(std::sync::Arc::new(config));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        loop {
            let (socket, _) = listener.accept().await.unwrap();
            let acceptor = acceptor.clone();
            tokio::spawn(async move {
                if let Ok(mut tls) = acceptor.accept(socket).await {
                    let mut input = [0; 2048];
                    let _ = tls.read(&mut input).await;
                    let _ = tls
                        .write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK",
                        )
                        .await;
                }
            });
        }
    });
    let dir = tempfile::tempdir().unwrap();
    let engine = HttpEngine::new(dir.path().into());
    let w = Workspace::default();
    let mut request = RequestSpec {
        url: format!("https://{address}/"),
        ..Default::default()
    };
    assert!(engine
        .execute(prepare(&w, &request).unwrap(), "verify".into())
        .await
        .is_err());
    request.settings = json!({"verifyTls":false});
    assert_eq!(
        engine
            .execute(prepare(&w, &request).unwrap(), "insecure".into())
            .await
            .unwrap()
            .status,
        200
    );
    request.settings = json!({"caFile":format!("{}/../testdata/tls/localhost-test.cert.pem",env!("CARGO_MANIFEST_DIR"))});
    assert_eq!(
        engine
            .execute(prepare(&w, &request).unwrap(), "custom-ca".into())
            .await
            .unwrap()
            .status,
        200
    );
    server.abort();
}
