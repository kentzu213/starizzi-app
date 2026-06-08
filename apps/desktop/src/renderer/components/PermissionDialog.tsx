import React, { useState } from 'react';

interface PermissionDefinition {
  id: string;
  category: string;
  label: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
  icon: string;
}

interface PermissionDialogProps {
  extensionName: string;
  extensionIcon?: string;
  requestedPermissions: string[];
  grantedPermissions: string[];
  definitions: PermissionDefinition[];
  onGrant: (permissions: string[]) => void;
  onCancel: () => void;
}

const RISK_COLORS: Record<string, string> = {
  low: 'var(--color-success)',
  medium: 'var(--color-warning)',
  high: 'var(--color-error)',
};

const RISK_LABELS: Record<string, string> = {
  low: 'Thấp',
  medium: 'Trung bình',
  high: 'Cao',
};

export function PermissionDialog({
  extensionName,
  extensionIcon,
  requestedPermissions,
  grantedPermissions,
  definitions,
  onGrant,
  onCancel,
}: PermissionDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(grantedPermissions.length > 0 ? grantedPermissions : requestedPermissions)
  );

  const defMap = new Map(definitions.map(d => [d.id, d]));

  // Group by category
  const grouped = new Map<string, PermissionDefinition[]>();
  for (const permId of requestedPermissions) {
    const def = defMap.get(permId);
    if (!def) continue;
    const cat = def.category;
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(def);
  }

  const hasHighRisk = requestedPermissions.some(p => defMap.get(p)?.riskLevel === 'high');

  function togglePermission(permId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(permId)) {
        next.delete(permId);
      } else {
        next.add(permId);
      }
      return next;
    });
  }

  function handleGrantAll() {
    onGrant(requestedPermissions);
  }

  function handleGrantSelected() {
    onGrant(Array.from(selected));
  }

  return (
    <div className="permission-overlay">
      <div className="permission-dialog glass-card animate-in">
        {/* Header */}
        <div className="permission-dialog__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className="permission-dialog__icon">
              {extensionIcon || '🧩'}
            </div>
            <div>
              <h2 className="permission-dialog__title">
                Quyền truy cập
              </h2>
              <p className="permission-dialog__subtitle">
                <strong>{extensionName}</strong> yêu cầu các quyền sau
              </p>
            </div>
          </div>
        </div>

        {/* High risk warning */}
        {hasHighRisk && (
          <div className="permission-dialog__warning">
            <span>⚠️</span>
            <span>Tiện ích này yêu cầu quyền <strong>rủi ro cao</strong>. Chỉ cấp nếu bạn tin tưởng nguồn gốc.</span>
          </div>
        )}

        {/* Permission list grouped by category */}
        <div className="permission-dialog__body">
          {Array.from(grouped.entries()).map(([category, perms]) => (
            <div key={category} className="permission-group">
              <div className="permission-group__label">
                {category.toUpperCase()}
              </div>
              {perms.map(perm => (
                <label
                  key={perm.id}
                  className={`permission-item ${selected.has(perm.id) ? 'permission-item--selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(perm.id)}
                    onChange={() => togglePermission(perm.id)}
                    className="permission-item__checkbox"
                  />
                  <span className="permission-item__icon">{perm.icon}</span>
                  <div className="permission-item__info">
                    <div className="permission-item__label">{perm.label}</div>
                    <div className="permission-item__desc">{perm.description}</div>
                  </div>
                  <span
                    className="permission-item__risk"
                    style={{ color: RISK_COLORS[perm.riskLevel] }}
                  >
                    {RISK_LABELS[perm.riskLevel]}
                  </span>
                </label>
              ))}
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="permission-dialog__footer">
          <button className="btn btn--ghost" onClick={onCancel}>
            Hủy bỏ
          </button>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn--secondary" onClick={handleGrantSelected}>
              Cấp đã chọn ({selected.size}/{requestedPermissions.length})
            </button>
            <button className="btn btn--primary" onClick={handleGrantAll}>
              ✅ Cấp tất cả
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
