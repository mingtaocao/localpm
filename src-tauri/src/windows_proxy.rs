//! Windows system proxy/PAC resolution.
//! This uses the active interactive user's WinINet settings and asks WinHTTP
//! to evaluate PAC/WPAD for each target URL.

#[cfg(target_os = "windows")]
mod imp {
    use std::{ffi::c_void, ptr};

    type Bool = i32;
    type Dword = u32;
    type HInternet = *mut c_void;

    const WINHTTP_ACCESS_TYPE_NO_PROXY: Dword = 1;
    const WINHTTP_ACCESS_TYPE_NAMED_PROXY: Dword = 3;
    const WINHTTP_AUTOPROXY_AUTO_DETECT: Dword = 0x0000_0001;
    const WINHTTP_AUTOPROXY_CONFIG_URL: Dword = 0x0000_0002;
    const WINHTTP_AUTO_DETECT_TYPE_DHCP: Dword = 0x0000_0001;
    const WINHTTP_AUTO_DETECT_TYPE_DNS_A: Dword = 0x0000_0002;

    #[repr(C)]
    struct CurrentUserProxyConfig {
        auto_detect: Bool,
        auto_config_url: *mut u16,
        proxy: *mut u16,
        proxy_bypass: *mut u16,
    }

    #[repr(C)]
    struct AutoProxyOptions {
        flags: Dword,
        auto_detect_flags: Dword,
        auto_config_url: *const u16,
        reserved: *mut c_void,
        reserved_flags: Dword,
        auto_logon_if_challenged: Bool,
    }

    #[repr(C)]
    struct ProxyInfo {
        access_type: Dword,
        proxy: *mut u16,
        proxy_bypass: *mut u16,
    }

    #[link(name = "winhttp")]
    unsafe extern "system" {
        fn WinHttpOpen(
            user_agent: *const u16,
            access_type: Dword,
            proxy_name: *const u16,
            proxy_bypass: *const u16,
            flags: Dword,
        ) -> HInternet;
        fn WinHttpCloseHandle(handle: HInternet) -> Bool;
        fn WinHttpGetIEProxyConfigForCurrentUser(config: *mut CurrentUserProxyConfig) -> Bool;
        fn WinHttpGetProxyForUrl(
            session: HInternet,
            url: *const u16,
            options: *mut AutoProxyOptions,
            info: *mut ProxyInfo,
        ) -> Bool;
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GlobalFree(memory: *mut c_void) -> *mut c_void;
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub enum SystemProxy {
        Direct,
        Proxy(String),
    }

    unsafe fn wide_string(value: *const u16) -> Option<String> {
        if value.is_null() {
            return None;
        }
        let mut length = 0usize;
        while unsafe { *value.add(length) } != 0 {
            length += 1;
        }
        Some(String::from_utf16_lossy(unsafe {
            std::slice::from_raw_parts(value, length)
        }))
    }

    unsafe fn free(value: *mut u16) {
        if !value.is_null() {
            let _ = unsafe { GlobalFree(value.cast()) };
        }
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn select_proxy(raw: &str, scheme: &str) -> Option<String> {
        let entries: Vec<_> = raw
            .split(';')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .collect();

        for entry in &entries {
            if let Some((key, value)) = entry.split_once('=') {
                if key.eq_ignore_ascii_case(scheme) {
                    return normalize(value);
                }
            }
        }
        entries.into_iter().find_map(normalize)
    }

    fn normalize(value: &str) -> Option<String> {
        let value = value.trim();
        if value.eq_ignore_ascii_case("DIRECT") {
            return None;
        }
        let address = value
            .strip_prefix("PROXY ")
            .or_else(|| value.strip_prefix("proxy "))
            .or_else(|| value.strip_prefix("HTTPS "))
            .or_else(|| value.strip_prefix("https "))
            .or_else(|| value.strip_prefix("HTTP "))
            .or_else(|| value.strip_prefix("http "))
            .unwrap_or(value)
            .trim();
        if address.is_empty() || address.to_ascii_uppercase().starts_with("SOCKS") {
            None
        } else if address.contains("://") {
            Some(address.to_string())
        } else {
            Some(format!("http://{address}"))
        }
    }

    pub fn resolve(url: &str) -> Option<SystemProxy> {
        let mut config = CurrentUserProxyConfig {
            auto_detect: 0,
            auto_config_url: ptr::null_mut(),
            proxy: ptr::null_mut(),
            proxy_bypass: ptr::null_mut(),
        };
        if unsafe { WinHttpGetIEProxyConfigForCurrentUser(&mut config) } == 0 {
            return None;
        }

        let result = resolve_with_config(url, &config);

        unsafe {
            free(config.auto_config_url);
            free(config.proxy);
            free(config.proxy_bypass);
        }
        result
    }

    fn resolve_with_config(url: &str, config: &CurrentUserProxyConfig) -> Option<SystemProxy> {
        let has_pac = !config.auto_config_url.is_null();
        if config.auto_detect == 0 && !has_pac {
            return None;
        }

        let agent = wide("LocalPostman/0.3");
        let session = unsafe {
            WinHttpOpen(
                agent.as_ptr(),
                WINHTTP_ACCESS_TYPE_NO_PROXY,
                ptr::null(),
                ptr::null(),
                0,
            )
        };
        if session.is_null() {
            return None;
        }

        let mut options = AutoProxyOptions {
            flags: 0,
            auto_detect_flags: 0,
            auto_config_url: ptr::null(),
            reserved: ptr::null_mut(),
            reserved_flags: 0,
            auto_logon_if_challenged: 1,
        };
        if config.auto_detect != 0 {
            options.flags |= WINHTTP_AUTOPROXY_AUTO_DETECT;
            options.auto_detect_flags =
                WINHTTP_AUTO_DETECT_TYPE_DHCP | WINHTTP_AUTO_DETECT_TYPE_DNS_A;
        }
        if has_pac {
            options.flags |= WINHTTP_AUTOPROXY_CONFIG_URL;
            options.auto_config_url = config.auto_config_url;
        }

        let mut info = ProxyInfo {
            access_type: WINHTTP_ACCESS_TYPE_NO_PROXY,
            proxy: ptr::null_mut(),
            proxy_bypass: ptr::null_mut(),
        };
        let target = wide(url);
        let ok =
            unsafe { WinHttpGetProxyForUrl(session, target.as_ptr(), &mut options, &mut info) };
        unsafe {
            let _ = WinHttpCloseHandle(session);
        }
        if ok == 0 {
            return None;
        }

        let proxy = unsafe { wide_string(info.proxy) };
        let result = if info.access_type == WINHTTP_ACCESS_TYPE_NO_PROXY {
            Some(SystemProxy::Direct)
        } else if info.access_type == WINHTTP_ACCESS_TYPE_NAMED_PROXY {
            let scheme = url.split(':').next().unwrap_or("http");
            proxy
                .as_deref()
                .and_then(|value| select_proxy(value, scheme))
                .map(SystemProxy::Proxy)
        } else {
            None
        };
        unsafe {
            free(info.proxy);
            free(info.proxy_bypass);
        }
        result
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn parses_named_and_pac_proxy_formats() {
            assert_eq!(
                select_proxy("http=proxy-a:80;https=proxy-b:443", "https"),
                Some("http://proxy-b:443".into())
            );
            assert_eq!(
                select_proxy("PROXY proxy-a:8080; DIRECT", "https"),
                Some("http://proxy-a:8080".into())
            );
        }
    }
}

#[cfg(target_os = "windows")]
pub use imp::{resolve, SystemProxy};
