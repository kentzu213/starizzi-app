/**
 * OpenClaw Extension Permission System
 * Defines all available permissions and utilities for checking/granting them.
 */

export type PermissionCategory = 'fs' | 'net' | 'ui' | 'clipboard' | 'system' | 'storage';

export interface PermissionDefinition {
  id: string;
  category: PermissionCategory;
  label: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
  icon: string;
}

/**
 * All available permissions that extensions can request.
 * Modeled after VS Code / Chrome extension permission system.
 */
export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  // Filesystem
  { id: 'fs.read', category: 'fs', label: 'Đọc file', description: 'Đọc file từ thư mục được chỉ định', riskLevel: 'medium', icon: '📖' },
  { id: 'fs.write', category: 'fs', label: 'Ghi file', description: 'Tạo và sửa file trong thư mục được chỉ định', riskLevel: 'high', icon: '✏️' },

  // Network
  { id: 'net.http', category: 'net', label: 'Gửi HTTP request', description: 'Gọi API bên ngoài (GET, POST, ...)', riskLevel: 'medium', icon: '🌐' },
  { id: 'net.websocket', category: 'net', label: 'WebSocket', description: 'Kết nối WebSocket real-time', riskLevel: 'medium', icon: '🔌' },

  // UI
  { id: 'ui.panel', category: 'ui', label: 'Hiển thị panel', description: 'Thêm panel vào giao diện OpenClaw', riskLevel: 'low', icon: '🖼️' },
  { id: 'ui.notification', category: 'ui', label: 'Gửi thông báo', description: 'Hiển thị notification cho người dùng', riskLevel: 'low', icon: '🔔' },
  { id: 'ui.dialog', category: 'ui', label: 'Dialog / Modal', description: 'Hiển thị hộp thoại tương tác', riskLevel: 'low', icon: '💬' },

  // Clipboard
  { id: 'clipboard.read', category: 'clipboard', label: 'Đọc clipboard', description: 'Đọc nội dung từ clipboard', riskLevel: 'high', icon: '📋' },
  { id: 'clipboard.write', category: 'clipboard', label: 'Ghi clipboard', description: 'Copy nội dung vào clipboard', riskLevel: 'medium', icon: '📝' },

  // System
  { id: 'system.shell', category: 'system', label: 'Chạy lệnh shell', description: 'Thực thi command trên hệ thống', riskLevel: 'high', icon: '⚡' },
  { id: 'system.env', category: 'system', label: 'Biến môi trường', description: 'Đọc biến môi trường hệ thống', riskLevel: 'high', icon: '🔧' },

  // Storage
  { id: 'storage.local', category: 'storage', label: 'Lưu trữ local', description: 'Lưu dữ liệu vào bộ nhớ cục bộ', riskLevel: 'low', icon: '💾' },
  { id: 'storage.secrets', category: 'storage', label: 'Lưu trữ bảo mật', description: 'Lưu trữ token/key an toàn', riskLevel: 'medium', icon: '🔐' },
];

/** Map for quick lookup */
export const PERMISSION_MAP = new Map(
  PERMISSION_DEFINITIONS.map(p => [p.id, p])
);

/**
 * Decide the effective granted permissions for an extension at load time.
 *
 * If a prior install/grant stored permissions, use exactly those (respecting any
 * user revocation). If NONE are stored — e.g. a first-party extension loaded
 * straight from disk on startup that never went through the install flow — fall
 * back to the manifest's declared permissions (the same default the install flow
 * uses). Without this, such an extension is granted `[]` and every ctx.storage /
 * ctx.net / ctx.ui call is denied. Pure — unit-testable.
 */
export function resolveGrantedPermissions(stored: string[], manifestPermissions?: string[]): string[] {
  if (Array.isArray(stored) && stored.length > 0) return stored;
  return Array.isArray(manifestPermissions) ? manifestPermissions : [];
}

/**
 * Check if a set of granted permissions includes the requested permission.
 */
export function hasPermission(granted: string[], requested: string): boolean {
  // Check exact match
  if (granted.includes(requested)) return true;

  // Check wildcard: 'fs.*' grants all fs.* permissions
  const [category] = requested.split('.');
  if (granted.includes(`${category}.*`)) return true;

  return false;
}

/**
 * Filter permissions by risk level.
 */
export function getHighRiskPermissions(permissions: string[]): PermissionDefinition[] {
  return permissions
    .map(p => PERMISSION_MAP.get(p))
    .filter((p): p is PermissionDefinition => !!p && p.riskLevel === 'high');
}

/**
 * Validate that all requested permissions are known.
 */
export function validatePermissions(permissions: string[]): { valid: boolean; unknown: string[] } {
  const unknown = permissions.filter(p => {
    if (p.endsWith('.*')) {
      const category = p.replace('.*', '');
      return !PERMISSION_DEFINITIONS.some(d => d.category === category);
    }
    return !PERMISSION_MAP.has(p);
  });
  return { valid: unknown.length === 0, unknown };
}
