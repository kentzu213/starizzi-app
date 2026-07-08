import React from 'react';

type IconProps = {
  className?: string;
};

function BaseIcon({
  children,
  className,
  viewBox = '0 0 24 24',
}: React.PropsWithChildren<{ className?: string; viewBox?: string }>) {
  return (
    <svg
      className={className}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/**
 * Starizzi Logo Mark — official brand icon
 * Dual-path "S" with star accent, cyan→purple gradient.
 * Matches izziapi.com navbar logo exactly.
 */
export function AppLogoMark({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Starizzi Logo"
    >
      <defs>
        <filter id="izzi-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
        <linearGradient id="izzi-accent" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#22dcc2" />
          <stop offset="58%" stopColor="#7ecfff" />
          <stop offset="100%" stopColor="#8e5cff" />
        </linearGradient>
      </defs>
      {/* S-curve dual paths */}
      <path
        d="M38 12c-6 0-14 2-14 10 0 6 5 8 10 10 5 2 10 3 10 8 0 7-8 12-16 12"
        stroke="url(#izzi-accent)"
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
        filter="url(#izzi-glow)"
      />
      <path
        d="M26 52c6 0 14-2 14-10 0-6-5-8-10-10-5-2-10-3-10-8 0-7 8-12 16-12"
        stroke="url(#izzi-accent)"
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
        filter="url(#izzi-glow)"
      />
      {/* Star accent */}
      <path
        d="M18 14l1.5-3 1.5 3 3 0.5-2.2 2 0.7 3-3-1.5-3 1.5 0.7-3-2.2-2z"
        fill="#22dcc2"
        filter="url(#izzi-glow)"
      />
    </svg>
  );
}

export function ChatIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M5 6.5C5 5.12 6.12 4 7.5 4h9A2.5 2.5 0 0 1 19 6.5v5A2.5 2.5 0 0 1 16.5 14H12l-4.25 4.25A.5.5 0 0 1 7 17.9V14H7.5A2.5 2.5 0 0 1 5 11.5z" />
      <path d="M9 8.5h6M9 11.5h4" />
    </BaseIcon>
  );
}

export function TasksIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4.5 6.5h.01M4.5 12.5h.01M4.5 18.5h.01" />
    </BaseIcon>
  );
}

export function MemoryIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M7 9a5 5 0 0 1 10 0v1.5a3 3 0 0 0 .74 1.98L19 14H5l1.26-1.52A3 3 0 0 0 7 10.5z" />
      <path d="M10 18a2 2 0 0 0 4 0" />
    </BaseIcon>
  );
}

export function StatusIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M5 17l4-4 3 3 7-8" />
      <path d="M19 8h-4v4" />
    </BaseIcon>
  );
}

export function OverviewIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <rect x="4" y="4" width="6" height="6" rx="1.5" />
      <rect x="14" y="4" width="6" height="10" rx="1.5" />
      <rect x="4" y="14" width="6" height="6" rx="1.5" />
      <rect x="14" y="16" width="6" height="4" rx="1.5" />
    </BaseIcon>
  );
}

export function MarketplaceIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M6 8h12l-1 11H7L6 8z" />
      <path d="M9 8V6.75A2.75 2.75 0 0 1 11.75 4h.5A2.75 2.75 0 0 1 15 6.75V8" />
    </BaseIcon>
  );
}

export function ExtensionIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M12 4v5M12 15v5M4 12h5M15 12h5" />
      <path d="M8 8l3-3 5 5-3 3-5-5z" />
    </BaseIcon>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M12 7.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 0 1 12 7.5z" />
      <path d="M19.4 15a1 1 0 0 0 .2 1.1l.06.06a1.75 1.75 0 0 1 0 2.47 1.75 1.75 0 0 1-2.47 0l-.06-.06a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.91V20a1.75 1.75 0 0 1-3.5 0v-.09a1 1 0 0 0-.6-.91 1 1 0 0 0-1.1.2l-.06.06a1.75 1.75 0 0 1-2.47 0 1.75 1.75 0 0 1 0-2.47l.06-.06a1 1 0 0 0 .2-1.1 1 1 0 0 0-.91-.6H6a1.75 1.75 0 0 1 0-3.5h.09a1 1 0 0 0 .91-.6 1 1 0 0 0-.2-1.1l-.06-.06a1.75 1.75 0 0 1 0-2.47 1.75 1.75 0 0 1 2.47 0l.06.06a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.91V6a1.75 1.75 0 0 1 3.5 0v.09a1 1 0 0 0 .6.91 1 1 0 0 0 1.1-.2l.06-.06a1.75 1.75 0 0 1 2.47 0 1.75 1.75 0 0 1 0 2.47l-.06.06a1 1 0 0 0-.2 1.1 1 1 0 0 0 .91.6H20a1.75 1.75 0 0 1 0 3.5h-.09a1 1 0 0 0-.91.6z" />
    </BaseIcon>
  );
}

export function MinimizeIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M5 12h14" />
    </BaseIcon>
  );
}

export function MaximizeIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </BaseIcon>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M7 7l10 10M17 7 7 17" />
    </BaseIcon>
  );
}

export function SparkIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
    </BaseIcon>
  );
}

export function SetupIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.77 3.77z" />
    </BaseIcon>
  );
}

export function RefreshIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M20 11a8 8 0 1 0 2 5.3" />
      <path d="M20 4v7h-7" />
    </BaseIcon>
  );
}

export function GraphIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <circle cx="6.5" cy="7" r="2.25" />
      <circle cx="17.5" cy="7" r="2.25" />
      <circle cx="12" cy="17" r="2.25" />
      <path d="M8.55 8.05h6.9M7.5 9.05 11 15M16.5 9.05 13 15" />
    </BaseIcon>
  );
}

export function CostIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M12 3v18" />
      <path d="M17 7.5c0-1.65-2.05-2.75-5-2.75S7 5.85 7 7.5s2.05 2.75 5 2.75 5 1.1 5 2.75-2.05 2.75-5 2.75-5-1.1-5-2.75" />
    </BaseIcon>
  );
}

export function AgentHubIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <rect x="7" y="8" width="10" height="8" rx="2" />
      <path d="M9.5 8V6.5A2.5 2.5 0 0 1 12 4a2.5 2.5 0 0 1 2.5 2.5V8" />
      <path d="M9.5 12h.01M14.5 12h.01M5 12H3M21 12h-2M10 16.5v1M14 16.5v1" />
    </BaseIcon>
  );
}

export function KnowledgeIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M12 5a4 4 0 0 0-4 4c0 1.45.74 2.67 1.62 3.62.63.68 1.13 1.5 1.13 2.43V16h2.5v-.95c0-.93.5-1.75 1.13-2.43A5.24 5.24 0 0 0 16 9a4 4 0 0 0-4-4z" />
      <path d="M10 19h4M10.5 16h3" />
      <path d="M5 10H3M21 10h-2M6.2 5.2 4.8 3.8M19.2 3.8l-1.4 1.4" />
    </BaseIcon>
  );
}

export function AffiliateIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
      <path d="M12 8S10.5 4 8.5 4a2 2 0 1 0 0 4H12zM12 8s1.5-4 3.5-4a2 2 0 1 1 0 4H12z" />
    </BaseIcon>
  );
}

export function AutoPostIcon({ className }: IconProps) {
  return (
    <BaseIcon className={className}>
      <path d="M4 11.5 20 4l-6.5 16-2.7-6.3z" />
      <path d="M20 4 11 13" />
    </BaseIcon>
  );
}
