// steam_connect — "Connect Steam for quarter matches" (tray item). Coin actions on the server need a PROVEN
// SteamID; the silent /register only binds a CLAIMED one. This is the native-app sign-in of RFC 8252 (loopback
// redirect) + RFC 7636 (PKCE), bound to one network on the server side:
//
//   1. bind 127.0.0.1:<ephemeral> (loopback only — never 0.0.0.0); draw a verifier and a state (OS RNG, hex)
//   2. POST {SERVER}/auth/steam/app-start {port, challenge = hex sha256(verifier), state} — the server records
//      this PC's public IP; the browser that signs in, and our exchange, must come from that same network
//   3. open the browser at {SERVER}/auth/steam/login?app_login=<id> -> a consent page -> Steam
//   4. the server redirects the browser to 127.0.0.1:<port>/steam-connected?code=…&state=…; we answer only a
//      request whose Host is our loopback address and whose state is ours (anything else: 404, keep waiting)
//   5. POST {code, verifier} to {SERVER}/auth/steam/exchange for a verified token
//   6. adopt it ONLY if the proven SteamID is the Steam account running the game on this PC
//
// The verifier never leaves this process and is never logged. Everything runs on its own thread; the tray
// never blocks.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

/// A connect attempt is in flight (the tray greys the item and shows "finish in your browser").
pub static CONNECTING: AtomicBool = AtomicBool::new(false);

const WAIT_FOR_BROWSER: Duration = Duration::from_secs(5 * 60);
const MAX_REQUEST: usize = 8 * 1024;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// 32 bytes from the OS RNG as 64 hex chars (inside RFC 7636's 43..=128 unreserved-char verifier).
fn new_secret() -> Result<String, String> {
    let mut b = [0u8; 32];
    getrandom::getrandom(&mut b).map_err(|e| format!("no OS randomness: {e}"))?;
    Ok(hex(&b))
}

pub(crate) fn challenge_for(verifier: &str) -> String {
    hex(&Sha256::digest(verifier.as_bytes()))
}

fn query_param<'a>(query: &'a str, key: &str) -> Option<&'a str> {
    query.split('&').find_map(|pair| pair.strip_prefix(key)?.strip_prefix('='))
}

/// The code from `GET /steam-connected?code=<alnum>&state=<ours> HTTP/1.1`, only when the request's Host is
/// exactly our loopback address (blocks DNS rebinding) and its state is the one we sent. Anything else: None.
pub(crate) fn code_from_request(head: &str, port: u16, state: &str) -> Option<String> {
    let mut lines = head.lines();
    let mut parts = lines.next()?.split_whitespace();
    if parts.next()? != "GET" {
        return None;
    }
    let query = parts.next()?.strip_prefix("/steam-connected?")?;
    let want_host = format!("127.0.0.1:{port}");
    let host_ok = lines
        .filter_map(|l| l.split_once(':'))
        .any(|(k, v)| k.trim().eq_ignore_ascii_case("host") && v.trim() == want_host);
    if !host_ok || query_param(query, "state")? != state {
        return None;
    }
    let code = query_param(query, "code")?;
    let ok = !code.is_empty() && code.len() <= 128 && code.bytes().all(|b| b.is_ascii_alphanumeric());
    ok.then(|| code.to_string())
}

fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let resp = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
}

fn page(title: &str, line: &str) -> String {
    format!(
        "<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width\"><title>{title}</title>\
         <body style=\"font-family:system-ui,sans-serif;background:#111;color:#eee;display:grid;place-items:center;min-height:90vh;text-align:center;padding:0 16px\">\
         <div><h1 style=\"font-size:1.6rem\">{title}</h1><p>{line}</p></div></body>"
    )
}

/// Wait (bounded) for the one browser request that carries our code. Other requests (favicon, a stray tab, a
/// forged callback) get a 404 and we keep waiting.
fn wait_for_code(listener: &TcpListener, port: u16, state: &str) -> Result<(String, TcpStream), String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + WAIT_FOR_BROWSER;
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, peer)) => {
                if !peer.ip().is_loopback() {
                    continue; // bound to 127.0.0.1, so this cannot happen — belt and braces
                }
                let _ = stream.set_nonblocking(false);
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let mut buf = vec![0u8; MAX_REQUEST];
                let mut n = 0;
                while n < buf.len() {
                    match stream.read(&mut buf[n..]) {
                        Ok(0) => break,
                        Ok(k) => {
                            n += k;
                            if buf[..n].windows(4).any(|w| w == b"\r\n\r\n") {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
                let text = String::from_utf8_lossy(&buf[..n]);
                match code_from_request(&text, port, state) {
                    Some(code) => return Ok((code, stream)),
                    None => respond(&mut stream, "404 Not Found", ""),
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(150)),
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("no answer from the browser within 5 minutes".into())
}

/// Start a connect attempt on its own thread. A second click while one is running does nothing.
pub fn start() {
    if CONNECTING.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = std::thread::Builder::new().name("steam-connect".into()).spawn(|| {
        let outcome = run_once();
        CONNECTING.store(false, Ordering::SeqCst);
        match outcome {
            Ok(name) => crate::updater::toast("Steam connected", &format!("{name} can now put quarters up.")),
            Err(why) => {
                eprintln!("[steam-connect] {why}");
                crate::updater::toast("Steam not connected", &why);
            }
        }
    });
}

fn server_error(e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(_, r) => r
            .into_json::<serde_json::Value>()
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_string))
            .unwrap_or_else(|| "the server refused".into()),
        other => format!("couldn't reach Retro Receipts: {other}"),
    }
}

fn run_once() -> Result<String, String> {
    let local = crate::reader::local_steamid().ok_or("Open Steam first — we connect the account that runs the game.")?;
    let verifier = new_secret()?;
    let state = new_secret()?;
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| format!("could not listen on this PC: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let start: serde_json::Value = ureq::post(&format!("{}/auth/steam/app-start", crate::config::SERVER_BASE))
        .timeout(Duration::from_secs(10))
        .send_json(serde_json::json!({ "port": port, "challenge": challenge_for(&verifier), "state": state }))
        .map_err(server_error)?
        .into_json()
        .map_err(|e| e.to_string())?;
    let login = start
        .get("login")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric()))
        .ok_or("the server didn't start the sign-in")?
        .to_string();
    let url = format!("{}/auth/steam/login?app_login={}", crate::config::SERVER_BASE, login);
    open::that_detached(&url).map_err(|e| format!("could not open the browser: {e}"))?;
    let (code, mut stream) = wait_for_code(&listener, port, &state)?;
    drop(listener); // one sign-in per attempt
    let resp: serde_json::Value = match ureq::post(&format!("{}/auth/steam/exchange", crate::config::SERVER_BASE))
        .timeout(Duration::from_secs(10))
        .send_json(serde_json::json!({ "code": code, "verifier": verifier }))
    {
        Ok(r) => r.into_json().map_err(|e| e.to_string())?,
        Err(e) => {
            let why = server_error(e);
            respond(&mut stream, "200 OK", &page("Not connected", "Something went wrong — try Connect Steam again from the tray."));
            return Err(format!("sign-in refused: {why}"));
        }
    };
    let token = resp.get("token").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let proven = resp.get("steamid").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if token.is_empty() || proven.len() != 17 {
        respond(&mut stream, "200 OK", &page("Not connected", "Something went wrong — try again from the tray."));
        return Err("the server's answer was incomplete".into());
    }
    if proven != local {
        respond(
            &mut stream,
            "200 OK",
            &page(
                "Different Steam account",
                "You signed in with a different Steam account than the one running the game on this PC. Sign in with that one instead.",
            ),
        );
        return Err("you signed in with a different Steam account than the one running the game".into());
    }
    crate::reader::adopt_verified(token, proven)?;
    respond(&mut stream, "200 OK", &page("Steam connected", "You can close this tab and go put a quarter up."));
    Ok(crate::reader::signed_in_name().unwrap_or_else(|| "Your account".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn challenge_is_hex_sha256() {
        assert_eq!(challenge_for("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    #[test]
    fn secrets_are_64_hex_and_fresh() {
        let v = new_secret().unwrap();
        assert_eq!(v.len(), 64);
        assert!(v.bytes().all(|b| b.is_ascii_hexdigit()));
        assert_ne!(v, new_secret().unwrap());
    }

    #[test]
    fn only_our_callback_carries_a_code() {
        let st = "s".repeat(64);
        let req = |line: &str, host: &str| format!("{line}\r\nHost: {host}\r\nAccept: */*\r\n\r\n");
        let good = format!("GET /steam-connected?code=abc123&state={st} HTTP/1.1");
        assert_eq!(code_from_request(&req(&good, "127.0.0.1:5000"), 5000, &st), Some("abc123".into()));
        assert_eq!(code_from_request(&req(&good, "evil.example:5000"), 5000, &st), None, "DNS rebinding: wrong Host");
        assert_eq!(code_from_request(&req(&good, "127.0.0.1:5001"), 5000, &st), None, "other port");
        let forged = "GET /steam-connected?code=abc123&state=other HTTP/1.1";
        assert_eq!(code_from_request(&req(forged, "127.0.0.1:5000"), 5000, &st), None, "foreign state");
        let nostate = "GET /steam-connected?code=abc123 HTTP/1.1";
        assert_eq!(code_from_request(&req(nostate, "127.0.0.1:5000"), 5000, &st), None);
        assert_eq!(code_from_request(&req("GET /favicon.ico HTTP/1.1", "127.0.0.1:5000"), 5000, &st), None);
        let post = format!("POST /steam-connected?code=abc&state={st} HTTP/1.1");
        assert_eq!(code_from_request(&req(&post, "127.0.0.1:5000"), 5000, &st), None);
        let bad = format!("GET /steam-connected?code=a%20b&state={st} HTTP/1.1");
        assert_eq!(code_from_request(&req(&bad, "127.0.0.1:5000"), 5000, &st), None);
    }
}
