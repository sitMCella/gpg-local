use std::fs::File;
use std::os::fd::{FromRawFd, RawFd};

use crate::GpgError;

/// Takes ownership of `fd`. The returned `File` closes it on drop.
pub(crate) fn file_from_owned_fd(fd: i32) -> Result<File, GpgError> {
    if fd < 0 {
        return Err(GpgError::Io {
            message: format!("invalid file descriptor: {fd}"),
        });
    }
    // SAFETY: the Kotlin caller transfers ownership via ParcelFileDescriptor.detachFd()
    // and must not use or close the fd afterwards.
    Ok(unsafe { File::from_raw_fd(fd as RawFd) })
}
