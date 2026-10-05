//! Identical logical asset namespace for manifest-limited live files and embedded release bytes.
use std::{collections::{BTreeMap, BTreeSet}, fs::{self, File}, io::{self, Cursor, Read, Seek}, path::{Path, PathBuf}};
pub trait ReadSeek: Read + Seek + Send {}
impl<T: Read + Seek + Send> ReadSeek for T {}
pub(crate) struct Opened { pub reader: Box<dyn ReadSeek>, pub len: u64 }
pub enum AssetSource {
    Disk { root: PathBuf, allowed: BTreeSet<String> },
    Embedded(BTreeMap<String, &'static [u8]>),
}
fn valid(path: &str) -> bool {
    !path.is_empty() && !path.contains(['\\', ':']) && !path.chars().any(char::is_control)
        && path.split('/').all(|part| !matches!(part, "" | "." | ".."))
}
impl AssetSource {
    pub fn disk(root: &Path, paths: impl IntoIterator<Item = String>) -> io::Result<Self> {
        let root = fs::canonicalize(root)?;
        if !root.is_dir() { return Err(io::Error::other("Asset root is not a directory")); }
        let allowed: BTreeSet<String> = paths.into_iter().collect();
        if allowed.iter().any(|path| !valid(path)) { return Err(io::Error::other("Invalid manifest path")); }
        Ok(Self::Disk { root, allowed })
    }
    pub fn embedded(entries: &'static [(&'static str, &'static [u8])]) -> io::Result<Self> {
        let mut files = BTreeMap::new();
        for (path, bytes) in entries {
            if !valid(path) || files.insert((*path).to_owned(), *bytes).is_some() { return Err(io::Error::other("Invalid or duplicate embedded asset path")); }
        }
        Ok(Self::Embedded(files))
    }
    pub(crate) fn has(&self, path: &str) -> bool { match self { Self::Disk { allowed, .. } => allowed.contains(path), Self::Embedded(files) => files.contains_key(path) } }
    pub(crate) fn open(&self, path: &str) -> io::Result<Opened> {
        if !valid(path) || !self.has(path) { return Err(io::Error::from(io::ErrorKind::NotFound)); }
        match self {
            Self::Embedded(files) => { let bytes = *files.get(path).ok_or(io::ErrorKind::NotFound)?; Ok(Opened { reader: Box::new(Cursor::new(bytes)), len: bytes.len() as u64 }) }
            Self::Disk { root, .. } => {
                let mut file = root.clone();
                for part in path.split('/') { file.push(part); if fs::symlink_metadata(&file)?.file_type().is_symlink() { return Err(io::Error::from(io::ErrorKind::PermissionDenied)); } }
                let actual = fs::canonicalize(&file)?;
                if !actual.starts_with(root) { return Err(io::Error::from(io::ErrorKind::PermissionDenied)); }
                let reader = File::open(actual)?;
                let metadata = reader.metadata()?;
                if !metadata.is_file() { return Err(io::Error::from(io::ErrorKind::NotFound)); }
                Ok(Opened { reader: Box::new(reader), len: metadata.len() })
            }
        }
    }
}
