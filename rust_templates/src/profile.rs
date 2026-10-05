//! An OS file lock isolates app instances; identity and data survive clean and unclean shutdowns.
use fs2::FileExt;
use std::{fs::{self, File, OpenOptions}, io, path::Path};
pub struct Profile { _lock: File }
impl Profile {
    pub fn open(directory: &Path) -> io::Result<Self> {
        fs::create_dir_all(directory)?;
        let lock = OpenOptions::new().read(true).write(true).create(true).truncate(false).open(directory.join("profile.lock"))?;
        lock.try_lock_exclusive().map_err(|error| io::Error::new(error.kind(), format!("Profile already in use: {} ({error}). Close the other instance; the origin will not be changed.", directory.display())))?;
        Ok(Self { _lock: lock })
    }
}
