//! Volume enumeration (drives) via `sysinfo` Disks.

use serde::Serialize;
use sysinfo::{DiskKind, Disks};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeInfo {
    pub name: String,
    pub mount_point: String,
    pub kind: String, // removable | fixed
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub file_system: String,
}

/// Returns real drives only (no pseudo/loop devices).
pub fn list_volumes() -> Vec<VolumeInfo> {
    let disks = Disks::new_with_refreshed_list();
    let mut out: Vec<VolumeInfo> = disks
        .list()
        .iter()
        .filter(|d| {
            let mp = d.mount_point().to_string_lossy().to_string();
            // keep drive letters and UNC-ish mounts, drop empty paths
            !mp.trim().is_empty()
        })
        .map(|d| VolumeInfo {
            name: d.name().to_string_lossy().to_string(),
            mount_point: d.mount_point().to_string_lossy().to_string(),
            kind: match d.kind() {
                DiskKind::SSD | DiskKind::HDD => "fixed".to_string(),
                DiskKind::Unknown(_) => "removable".to_string(),
            },
            total_bytes: d.total_space(),
            available_bytes: d.available_space(),
            file_system: d.file_system().to_string_lossy().to_string(),
        })
        .collect();

    // On Windows CD/DVD drives are often reported as removable with 0 bytes —
    // drop them so the onboarding list stays useful.
    out.retain(|v| v.total_bytes > 0);
    out.sort_by(|a, b| a.mount_point.cmp(&b.mount_point));
    out
}
