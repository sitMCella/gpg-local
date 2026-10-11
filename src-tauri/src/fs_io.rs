use std::fs::File;
use std::io::{BufReader, BufWriter, Write};
use std::path::Path;

pub fn open_input(path: &str) -> Result<BufReader<File>, String> {
    File::open(path)
        .map(BufReader::new)
        .map_err(|e| e.to_string())
}

/// Runs `op` against a temp file in the output's directory and moves it over
/// `output_path` only if `op` succeeds. On error the temp file is deleted and
/// any existing file at `output_path` is left untouched.
pub fn write_atomically<F>(output_path: &str, op: F) -> Result<(), String>
where
    F: FnOnce(&mut BufWriter<&mut File>) -> Result<(), String>,
{
    let out = Path::new(output_path);
    let dir = out
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut tmp = tempfile::Builder::new()
        .prefix(".gpg-local-")
        .suffix(".tmp")
        .tempfile_in(dir)
        .map_err(|e| e.to_string())?;
    {
        let mut writer = BufWriter::new(tmp.as_file_mut());
        op(&mut writer)?;
        writer.flush().map_err(|e| e.to_string())?;
    }
    tmp.as_file().sync_all().map_err(|e| e.to_string())?;
    // tempfile creates files 0600; match the 0644 that std::fs::write produced.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tmp.as_file()
            .set_permissions(std::fs::Permissions::from_mode(0o644))
            .map_err(|e| e.to_string())?;
    }
    tmp.persist(out).map_err(|e| e.error.to_string())?;
    Ok(())
}
