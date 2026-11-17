//! The calls that exist only on Windows (`plans/16-windows.md`). Each is
//! small and returns `None` or an error rather than panic. Nothing here has
//! run on a Windows machine yet: `docs/testing.md` lists the checks.

use std::ffi::c_void;
use std::io;
use std::os::windows::ffi::OsStringExt;
use std::os::windows::io::{AsRawHandle, RawHandle};
use std::path::{Path, PathBuf};

use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, LocalFree, FALSE, FILETIME, HANDLE, INVALID_HANDLE_VALUE, SYSTEMTIME,
};
use windows_sys::Win32::Security::Authorization::{
    ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows_sys::Win32::Security::{
    GetTokenInformation, TokenUser, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER,
};
use windows_sys::Win32::Storage::FileSystem::{
    GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Pipes::GetNamedPipeServerProcessId;
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, GetCurrentProcessId, OpenProcess, OpenProcessToken,
    QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows_sys::Win32::System::Time::{FileTimeToSystemTime, SystemTimeToTzSpecificLocalTime};

/// A handle closed when dropped.
struct Owned(HANDLE);

impl Drop for Owned {
    fn drop(&mut self) {
        // SAFETY: the handle came from a successful call and is closed once.
        unsafe { CloseHandle(self.0) };
    }
}

fn last_error() -> io::Error {
    // SAFETY: reads the calling thread's last error.
    io::Error::from_raw_os_error(unsafe { GetLastError() } as i32)
}

/// The pid of this process's parent, from a ToolHelp snapshot (decision 4).
pub fn parent_pid() -> Option<u32> {
    // SAFETY: the snapshot handle is owned and closed by `Owned`; the entry
    // is initialised with its size as the API requires.
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return None;
        }
        let _snap = Owned(snap);
        let me = GetCurrentProcessId();
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut more = Process32FirstW(snap, &mut entry) != FALSE;
        while more {
            if entry.th32ProcessID == me {
                return Some(entry.th32ParentProcessID);
            }
            more = Process32NextW(snap, &mut entry) != FALSE;
        }
        None
    }
}

/// The full path of process `pid`'s exe.
pub fn image_path(pid: u32) -> Option<PathBuf> {
    // SAFETY: the process handle is owned; the buffer length is passed in
    // and updated by the call.
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
        if h.is_null() {
            return None;
        }
        let _h = Owned(h);
        let mut buf = vec![0u16; 32_768];
        let mut len = buf.len() as u32;
        if QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut len) == FALSE {
            return None;
        }
        buf.truncate(len as usize);
        Some(PathBuf::from(std::ffi::OsString::from_wide(&buf)))
    }
}

/// The SID string (`S-1-5-21-...`) of the user a process token belongs to.
fn token_user_sid(token: HANDLE) -> io::Result<String> {
    // SAFETY: the buffer is sized by the first call; the SID pointer is read
    // while the buffer lives; the string `ConvertSidToStringSidW` allocates
    // is freed with `LocalFree`.
    unsafe {
        let mut needed = 0u32;
        GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut needed);
        let mut buf = vec![0u8; needed as usize];
        if GetTokenInformation(
            token,
            TokenUser,
            buf.as_mut_ptr().cast(),
            needed,
            &mut needed,
        ) == FALSE
        {
            return Err(last_error());
        }
        let user = &*(buf.as_ptr() as *const TOKEN_USER);
        let mut wide: *mut u16 = std::ptr::null_mut();
        if ConvertSidToStringSidW(user.User.Sid, &mut wide) == FALSE {
            return Err(last_error());
        }
        let mut n = 0;
        while *wide.add(n) != 0 {
            n += 1;
        }
        let s = String::from_utf16_lossy(std::slice::from_raw_parts(wide, n));
        LocalFree(wide.cast());
        Ok(s)
    }
}

/// This process's user SID.
pub fn current_user_sid() -> io::Result<String> {
    // SAFETY: `GetCurrentProcess` is a pseudo handle; the token handle is
    // owned and closed by `Owned`.
    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == FALSE {
            return Err(last_error());
        }
        let _token = Owned(token);
        token_user_sid(token)
    }
}

/// A security descriptor for a host pipe: this user only (decision 2).
pub struct PipeSecurity {
    descriptor: *mut c_void,
    attrs: SECURITY_ATTRIBUTES,
}

impl PipeSecurity {
    pub fn for_current_user() -> io::Result<PipeSecurity> {
        let sddl = crate::winos::pipe_sddl(&current_user_sid()?)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?;
        let wide: Vec<u16> = sddl.encode_utf16().chain(Some(0)).collect();
        let mut descriptor: *mut c_void = std::ptr::null_mut();
        // SAFETY: `wide` is NUL-terminated; the descriptor it allocates is
        // freed by `Drop`.
        let ok = unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                wide.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                std::ptr::null_mut(),
            )
        };
        if ok == FALSE {
            return Err(last_error());
        }
        Ok(PipeSecurity {
            descriptor,
            attrs: SECURITY_ATTRIBUTES {
                nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: descriptor,
                bInheritHandle: FALSE,
            },
        })
    }

    /// The `SECURITY_ATTRIBUTES` pointer `CreateNamedPipe` takes; valid as
    /// long as `self` is.
    pub fn as_ptr(&mut self) -> *mut c_void {
        std::ptr::addr_of_mut!(self.attrs).cast()
    }
}

impl Drop for PipeSecurity {
    fn drop(&mut self) {
        // SAFETY: allocated by the conversion call, freed once.
        unsafe { LocalFree(self.descriptor) };
    }
}

/// Refuses a pipe whose server process runs as another user (decision 2b).
pub fn check_server_is_me(pipe: RawHandle) -> io::Result<()> {
    // SAFETY: `pipe` is a live pipe handle the caller owns; the process and
    // token handles are owned and closed by `Owned`.
    let theirs = unsafe {
        let mut pid = 0u32;
        if GetNamedPipeServerProcessId(pipe as HANDLE, &mut pid) == FALSE {
            return Err(last_error());
        }
        let proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
        if proc.is_null() {
            return Err(last_error());
        }
        let _proc = Owned(proc);
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(proc, TOKEN_QUERY, &mut token) == FALSE {
            return Err(last_error());
        }
        let _token = Owned(token);
        token_user_sid(token)?
    };
    if theirs == current_user_sid()? {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "the pipe's server runs as another user",
        ))
    }
}

/// How many names the file at `path` has (NTFS hard links); `None` when it
/// cannot be read.
pub fn link_count(path: &Path) -> Option<u32> {
    let f = std::fs::File::open(path).ok()?;
    // SAFETY: the handle is the open file's; the info struct is written whole.
    unsafe {
        let mut info: BY_HANDLE_FILE_INFORMATION = std::mem::zeroed();
        if GetFileInformationByHandle(f.as_raw_handle() as HANDLE, &mut info) == FALSE {
            return None;
        }
        Some(info.nNumberOfLinks)
    }
}

/// `ms` since the epoch as local "YYYY-MM-DD HH:MM".
pub fn local_time(ms: i64) -> Option<String> {
    let ticks = crate::winos::ms_to_filetime(ms);
    let ft = FILETIME {
        dwLowDateTime: ticks as u32,
        dwHighDateTime: (ticks >> 32) as u32,
    };
    // SAFETY: both structs are plain data written by the calls.
    unsafe {
        let mut utc: SYSTEMTIME = std::mem::zeroed();
        let mut local: SYSTEMTIME = std::mem::zeroed();
        if FileTimeToSystemTime(&ft, &mut utc) == FALSE
            || SystemTimeToTzSpecificLocalTime(std::ptr::null(), &utc, &mut local) == FALSE
        {
            return None;
        }
        Some(crate::winos::local_text(
            local.wYear.into(),
            local.wMonth.into(),
            local.wDay.into(),
            local.wHour.into(),
            local.wMinute.into(),
        ))
    }
}
