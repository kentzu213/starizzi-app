/**
 * OpenClaw .ocx Extension Manifest Schema & Validation
 *
 * .ocx = OpenClaw eXtension — custom package format for OpenClaw extensions.
 * Similar to .vsix for VS Code, .crx for Chrome.
 *
 * Structure of a .ocx file (tar.gz):
 *   manifest.json    — metadata + permissions + entry points
 *   icon.png         — 128x128 extension icon (optional)
 *   dist/            — compiled JS bundle (single entry point)
 *     index.js
 *   assets/          — static assets (optional)
 *   README.md        — description (optional)
 */

export interface OcxManifest {
  // Required fields
  name: string;           // kebab-case identifier (e.g., "smart-seo-scanner")
  version: string;        // semver (e.g., "1.2.0")
  displayName: string;    // Human-readable name
  description: string;    // Short description
  main: string;           // Entry point relative to package root (e.g., "dist/index.js")
  engine: string;         // Required OpenClaw version (e.g., ">=0.1.0")

  // Author info
  author: {
    name: string;
    email?: string;
    url?: string;
  };

  // Permissions
  permissions: string[];  // e.g., ["net.http", "ui.panel", "storage.local"]

  // Extension capabilities
  activationEvents: string[]; // When to activate: "onCommand:*", "onStartup", "onPanel:*"
  contributes: {
    commands?: OcxCommand[];
    panels?: OcxPanel[];
    settings?: OcxSetting[];
  };

  // Marketplace
  categories?: string[];  // e.g., ["SEO", "Marketing"]
  tags?: string[];
  repository?: string;
  homepage?: string;
  license?: string;

  // Pricing
  pricing?: {
    model: 'free' | 'paid' | 'freemium';
    price?: {
      monthly?: number;
      yearly?: number;
      currency?: string;  // Default: USD
    };
  };

  // Icon
  icon?: string;          // Relative path to icon file (e.g., "icon.png")

  // Managed local service (optional) — when present, the host boots this backend
  // on the user's machine when they open the extension (see LocalServiceManager).
  service?: OcxServiceSpec;

  // Optional
  private?: boolean;      // If true, not listed on marketplace
}

export interface OcxCommand {
  id: string;             // e.g., "smart-seo-scanner.runScan"
  title: string;          // e.g., "Quét SEO"
  category?: string;      // e.g., "SEO"
  icon?: string;          // Emoji or icon path
}

export interface OcxPanel {
  id: string;             // e.g., "smart-seo-scanner.dashboard"
  title: string;          // e.g., "SEO Dashboard"
  entry: string;          // HTML file or component entry
}

export interface OcxSetting {
  id: string;
  title: string;
  description?: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  default?: any;
  options?: { label: string; value: string }[]; // For 'select' type
}

// ── Managed Local Service ──
// Optional block letting an extension declare a backend the host boots on the
// user's machine when they open the extension (see LocalServiceManager). The
// existing thin client (e.g. autopost-client) then talks to it over localhost.

/** A port the managed backend publishes. Bind is loopback-only (never LAN). */
export interface OcxServicePort {
  name: string;          // logical id used in `inject` templates, e.g. "api"
  container: number;     // port INSIDE the container/process (e.g. 3001)
  healthPath?: string;   // readiness probe path (default "/health")
  bind?: string;         // loopback address; default "127.0.0.1" (0.0.0.0 rejected)
}

/** A secret the host generates locally (0600) if absent — never shipped in the .ocx. */
export interface OcxServiceSecret {
  key: string;           // UPPER_SNAKE env var name, e.g. "JWT_SECRET"
  gen: string;           // generator spec: "hex:64" | "base64:32"
}

/** What to do when the local runtime (e.g. Docker) is unavailable. */
export interface OcxServiceFallback {
  remoteEnvVar?: string; // env var holding a hosted backend URL, e.g. "AUTOPOST_BACKEND_URL"
}

export interface OcxServiceSpec {
  type: 'docker-compose' | 'node' | 'binary';
  projectName: string;   // MUST match /^izzi-svc-.../ — the host only ever touches these
  compose?: string;      // required for docker-compose; path RELATIVE to ext root, no ".."
  command?: string;      // required for node/binary
  ports: OcxServicePort[];
  secrets?: OcxServiceSecret[];
  readyTimeoutMs?: number; // how long to wait for health (first run pulls images)
  inject?: Record<string, string>; // settings written into the ext, e.g. { backendUrl: "http://127.0.0.1:${port.api}" }
  requires?: { docker?: boolean };
  fallback?: OcxServiceFallback;
}

// ── Validation ──

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const NAME_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

// ── Service spec validation constants ──
// The prefix is a security boundary: LocalServiceManager only ever starts/stops
// docker-compose projects whose name matches this, so a manifest can't drive
// docker against arbitrary/other projects.
const SERVICE_PROJECT_REGEX = /^izzi-svc-[a-z0-9][a-z0-9-]*$/;
const SECRET_KEY_REGEX = /^[A-Z][A-Z0-9_]*$/;
const SECRET_GEN_REGEX = /^(hex|base64):\d{1,4}$/;
const SERVICE_TYPES = ['docker-compose', 'node', 'binary'];
// Loopback only — a managed local backend must never be reachable from the LAN.
const SERVICE_LOOPBACK_BINDS = ['127.0.0.1', 'localhost', '::1'];
// Matches an absolute path on either OS (C:\ , / , \ , \\server) — rejected so a
// manifest can only point at a compose file inside its own extension directory.
const ABSOLUTE_PATH_REGEX = /^(?:[a-zA-Z]:[\\/]|[\\/]|\\\\)/;

export function validateManifest(manifest: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!manifest.name || typeof manifest.name !== 'string') {
    errors.push('`name` is required and must be a string');
  } else if (!NAME_REGEX.test(manifest.name)) {
    errors.push('`name` must be kebab-case (e.g., "my-extension")');
  } else if (manifest.name.length < 3 || manifest.name.length > 64) {
    errors.push('`name` must be 3-64 characters');
  }

  if (!manifest.version || typeof manifest.version !== 'string') {
    errors.push('`version` is required and must be a string');
  } else if (!SEMVER_REGEX.test(manifest.version)) {
    errors.push('`version` must follow semver (e.g., "1.0.0")');
  }

  if (!manifest.displayName || typeof manifest.displayName !== 'string') {
    errors.push('`displayName` is required and must be a string');
  } else if (manifest.displayName.length > 128) {
    errors.push('`displayName` must be ≤128 characters');
  }

  if (!manifest.description || typeof manifest.description !== 'string') {
    errors.push('`description` is required');
  } else if (manifest.description.length > 500) {
    warnings.push('`description` is very long (>500 chars), consider shortening');
  }

  if (!manifest.main || typeof manifest.main !== 'string') {
    errors.push('`main` entry point is required');
  } else if (manifest.main.includes('..')) {
    errors.push('`main` must not contain path traversal (..)');
  }

  if (!manifest.engine || typeof manifest.engine !== 'string') {
    errors.push('`engine` (required OpenClaw version) is required');
  }

  // Author
  if (!manifest.author || typeof manifest.author !== 'object') {
    errors.push('`author` is required and must be an object with `name`');
  } else if (!manifest.author.name) {
    errors.push('`author.name` is required');
  }

  // Permissions
  if (!Array.isArray(manifest.permissions)) {
    errors.push('`permissions` must be an array');
  }

  // Activation events
  if (!Array.isArray(manifest.activationEvents)) {
    errors.push('`activationEvents` must be an array');
  }

  // Contributes
  if (!manifest.contributes || typeof manifest.contributes !== 'object') {
    errors.push('`contributes` is required');
  } else {
    if (manifest.contributes.commands && !Array.isArray(manifest.contributes.commands)) {
      errors.push('`contributes.commands` must be an array');
    }
    if (manifest.contributes.panels && !Array.isArray(manifest.contributes.panels)) {
      errors.push('`contributes.panels` must be an array');
    }
  }

  // Pricing validation
  if (manifest.pricing) {
    if (!['free', 'paid', 'freemium'].includes(manifest.pricing.model)) {
      errors.push('`pricing.model` must be "free", "paid", or "freemium"');
    }
    if (manifest.pricing.model !== 'free' && !manifest.pricing.price?.monthly) {
      warnings.push('Paid extension should specify `pricing.price.monthly`');
    }
  }

  // Managed local service (optional)
  if (manifest.service !== undefined) {
    const svc = validateServiceSpec(manifest.service);
    errors.push(...svc.errors);
    warnings.push(...svc.warnings);
  }

  // Warnings for recommended fields
  if (!manifest.categories || manifest.categories.length === 0) {
    warnings.push('No `categories` specified — will be harder to discover on Marketplace');
  }
  if (!manifest.icon) {
    warnings.push('No `icon` specified — default icon will be used');
  }
  if (!manifest.repository) {
    warnings.push('No `repository` — recommended for trust');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a manifest `service` block. Exported + pure so both validateManifest
 * and unit tests can call it. Enforces the security invariants the
 * LocalServiceManager relies on: an `izzi-svc-` project namespace, no path
 * traversal / absolute compose paths, and loopback-only port binds.
 */
export function validateServiceSpec(service: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof service !== 'object' || service === null || Array.isArray(service)) {
    errors.push('`service` must be an object');
    return { valid: false, errors, warnings };
  }

  // type
  if (!SERVICE_TYPES.includes(service.type)) {
    errors.push('`service.type` must be "docker-compose", "node", or "binary"');
  }

  // projectName — the docker-compose namespace the host is allowed to touch.
  if (!service.projectName || typeof service.projectName !== 'string') {
    errors.push('`service.projectName` is required and must be a string');
  } else if (!SERVICE_PROJECT_REGEX.test(service.projectName)) {
    errors.push('`service.projectName` must match /^izzi-svc-[a-z0-9][a-z0-9-]*$/');
  }

  // entry point per type
  if (service.type === 'docker-compose') {
    if (!service.compose || typeof service.compose !== 'string') {
      errors.push('`service.compose` is required for docker-compose services');
    } else if (service.compose.includes('..')) {
      errors.push('`service.compose` must not contain path traversal (..)');
    } else if (ABSOLUTE_PATH_REGEX.test(service.compose)) {
      errors.push('`service.compose` must be relative to the extension root (no absolute path)');
    }
  } else if (service.type === 'node' || service.type === 'binary') {
    if (!service.command || typeof service.command !== 'string') {
      errors.push(`\`service.command\` is required for ${service.type} services`);
    }
  }

  // ports
  if (!Array.isArray(service.ports) || service.ports.length === 0) {
    errors.push('`service.ports` must be a non-empty array');
  } else {
    const seen = new Set<string>();
    service.ports.forEach((p: any, i: number) => {
      if (!p || typeof p !== 'object') {
        errors.push(`\`service.ports[${i}]\` must be an object`);
        return;
      }
      if (!p.name || typeof p.name !== 'string') {
        errors.push(`\`service.ports[${i}].name\` is required`);
      } else if (seen.has(p.name)) {
        errors.push(`\`service.ports[${i}].name\` "${p.name}" is duplicated`);
      } else {
        seen.add(p.name);
      }
      if (!Number.isInteger(p.container) || p.container < 1 || p.container > 65535) {
        errors.push(`\`service.ports[${i}].container\` must be an integer 1-65535`);
      }
      // Security: a managed local backend must stay on loopback (never LAN).
      if (p.bind !== undefined && !SERVICE_LOOPBACK_BINDS.includes(p.bind)) {
        errors.push(`\`service.ports[${i}].bind\` must be loopback (127.0.0.1 / localhost / ::1), got "${p.bind}"`);
      }
      if (p.healthPath !== undefined && (typeof p.healthPath !== 'string' || !p.healthPath.startsWith('/'))) {
        errors.push(`\`service.ports[${i}].healthPath\` must be a path starting with "/"`);
      }
    });
  }

  // secrets (generated locally — the manifest only declares key + generator)
  if (service.secrets !== undefined) {
    if (!Array.isArray(service.secrets)) {
      errors.push('`service.secrets` must be an array');
    } else {
      service.secrets.forEach((s: any, i: number) => {
        if (!s || typeof s !== 'object') {
          errors.push(`\`service.secrets[${i}]\` must be an object`);
          return;
        }
        if (!s.key || typeof s.key !== 'string' || !SECRET_KEY_REGEX.test(s.key)) {
          errors.push(`\`service.secrets[${i}].key\` must be UPPER_SNAKE_CASE`);
        }
        if (!s.gen || typeof s.gen !== 'string' || !SECRET_GEN_REGEX.test(s.gen)) {
          errors.push(`\`service.secrets[${i}].gen\` must look like "hex:64" or "base64:32"`);
        }
      });
    }
  }

  // readyTimeoutMs
  if (service.readyTimeoutMs !== undefined) {
    if (typeof service.readyTimeoutMs !== 'number' || service.readyTimeoutMs <= 0) {
      errors.push('`service.readyTimeoutMs` must be a positive number (ms)');
    } else if (service.readyTimeoutMs > 600_000) {
      warnings.push('`service.readyTimeoutMs` > 10min is unusually long');
    }
  }

  if (service.requires !== undefined && (typeof service.requires !== 'object' || service.requires === null)) {
    errors.push('`service.requires` must be an object');
  }

  // fallback
  if (service.fallback !== undefined) {
    if (typeof service.fallback !== 'object' || service.fallback === null) {
      errors.push('`service.fallback` must be an object');
    } else if (service.fallback.remoteEnvVar !== undefined && typeof service.fallback.remoteEnvVar !== 'string') {
      errors.push('`service.fallback.remoteEnvVar` must be a string');
    }
  } else if (service.type === 'docker-compose') {
    warnings.push('No `service.fallback` — users without Docker will have no backend to reach');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Generate a minimal manifest template for extension authors.
 */
export function generateManifestTemplate(name: string): OcxManifest {
  return {
    name,
    version: '0.1.0',
    displayName: name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    description: 'My OpenClaw extension',
    main: 'dist/index.js',
    engine: '>=0.1.0',
    author: { name: 'Your Name' },
    permissions: ['storage.local'],
    activationEvents: ['onCommand:*'],
    contributes: {
      commands: [
        {
          id: `${name}.hello`,
          title: 'Hello World',
          category: 'General',
        },
      ],
    },
    categories: ['Utilities'],
    pricing: { model: 'free' },
  };
}
