import { createContext, type FormEvent, type ReactNode, useContext, useEffect, useMemo, useState, useRef } from 'react';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, Redirect, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import {
  Activity as ActivityIcon, AlertTriangle, ArrowUpRight, Bell,
  CalendarDays, Check, CheckCircle2, ChevronDown, ChevronUp, ClipboardCheck,
  Clock3, FileCheck2, FileText, Flag, Headset, Home, LayoutDashboard, LocateFixed,
  LogIn, LogOut, MapPin, Menu, Navigation, Phone, Plus, ReceiptText, RefreshCw,
  Search, Settings2, Shield, Siren, UserCheck, UserCog, Users, WalletCards, X
} from 'lucide-react';
import {
  getGetEmployeeSubmissionsQueryKey, getGetFieldOfficerTrackingQueryKey,
  getGetTeamGuardsQueryKey, getGetTodayAttendanceQueryKey,
  getGetTodayChecklistQueryKey, getGetRequestsQueryKey, useCheckInGuard, useCreateBillSubmission,
  useCreateLeaveRequest, useCreateSalaryAdvanceRequest, useDecideEmployeeSubmission,
  useGetActivity, useGetDashboardSummary, useGetEmployeeSubmissions,
  useGetEscalationContacts, useGetFieldOfficerTracking, useGetPayslips,
  usePostLocationHeartbeat,
  useGetRequests, useGetTeamGuards, useGetTodayAttendance, useGetTodayChecklist, useGetTodaySiteReport,
  getGetOperatingPolicyQueryKey, useGetOperatingPolicy, usePunchAttendance,
  getGetOperatingPolicyRevisionsQueryKey, useGetOperatingPolicyRevisions,
  exportOperatingPolicyRevision,
  useSubmitEmployeeDetails, useTriggerSos, useUpdateChecklistItem, useUpdateOperatingPolicy,
  getGetWorkforceSessionQueryKey, useGetWorkforceSession,
  getGetAdminWorkforceUsersQueryKey, useGetAdminFieldOfficers, useGetAdminWorkforceUsers,
  useUpdateAdminWorkforceUserAssignment
} from '@workspace/api-client-react';
import type {
  Activity, AttendanceRecord, ChecklistItem, EmployeeSubmission, FieldOfficerLocation,
  Guard, Payslip, RequestRecord, OperatingPolicy, OperatingPolicyRevision, OperatingPolicyUpdate, ShiftRule, ChecklistRule,
  WorkforceUser, WorkforceUserAssignment
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import NotFound from '@/pages/not-found';
import { WorkforceWorkbenchPage } from '@/pages/workforce-workbench';

const queryClient = new QueryClient();
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
// Replit injects the managed proxy secret into the development process too,
// but the proxy is only valid for published traffic. Keep preview on Clerk's
// development Frontend API and enable the proxy in production.
const clerkProxyUrl = import.meta.env.DEV
  ? undefined
  : import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in the environment.');
}

type WorkforceRole = 'Guard' | 'Supervisor' | 'Security Officer' | 'Field Officer' | 'Management' | 'Control Room';
type Access = {
  userId: string;
  role: WorkforceRole;
  siteName: string;
  fieldOfficerId: string | null;
  permissions: {
    canViewEmployeeDetails: boolean;
    canViewFieldTracking: boolean;
    canManageTeam: boolean;
    canManagePolicies: boolean;
  };
};
const AccessContext = createContext<Access | null>(null);
const RoleContext = createContext<WorkforceRole>('Control Room');
const nav = [
  { href: '/dashboard', label: 'Command center', icon: LayoutDashboard, roles: ['Guard', 'Supervisor', 'Security Officer', 'Field Officer', 'Management', 'Control Room'] as WorkforceRole[] },
  { href: '/operations', label: 'Operations', icon: ActivityIcon, roles: ['Supervisor', 'Security Officer', 'Management', 'Control Room'] as WorkforceRole[] },
  { href: '/attendance', label: 'Attendance', icon: Clock3 },
  { href: '/team', label: 'Team readiness', icon: Users, roles: ['Supervisor', 'Security Officer', 'Management', 'Control Room'] as WorkforceRole[] },
  { href: '/tracking', label: 'Live tracking', icon: LocateFixed, roles: ['Supervisor', 'Security Officer', 'Field Officer', 'Management', 'Control Room'] as WorkforceRole[] },
  { href: '/verification', label: 'Verification', icon: FileCheck2, roles: ['Supervisor', 'Security Officer', 'Management', 'Control Room'] as WorkforceRole[] },
  { href: '/requests', label: 'Requests', icon: ReceiptText },
  { href: '/payslips', label: 'Payslips', icon: WalletCards },
  { href: '/client-portal', label: 'Client portal', icon: ArrowUpRight, roles: ['Management', 'Control Room'] as WorkforceRole[] },
  { href: '/policies', label: 'Operating policies', icon: Settings2, roles: ['Management'] as WorkforceRole[] },
  { href: '/access', label: 'Access management', icon: UserCog, roles: ['Management'] as WorkforceRole[] },
];

function cx(...classes: Array<string | false | undefined>) { return classes.filter(Boolean).join(' '); }
function display(value: unknown, fallback: unknown = '—') { return value === null || value === undefined || value === '' ? String(fallback) : String(value); }
function statusClass(status: string) {
  const s = status.toLowerCase();
  if (s.includes('active') || s.includes('present') || s.includes('complete') || s.includes('accept') || s.includes('release') || s === 'on_duty') return 'status-ok';
  if (s.includes('pending') || s.includes('review') || s.includes('away') || s.includes('late') || s.includes('partial')) return 'status-warn';
  if (s.includes('incident') || s.includes('absent') || s.includes('reject') || s.includes('issue') || s.includes('off_duty')) return 'status-danger';
  return 'status-neutral';
}
function fmtTime(value?: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}
function initials(name: string) { return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase(); }
function isPolicyWindowActive(startTime: string, endTime: string, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const current = Number(parts.find((part) => part.type === 'hour')?.value ?? 0) * 60 + Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
    const toMinutes = (value: string) => { const [hours, minutes] = value.split(':').map(Number); return hours * 60 + minutes; };
    const start = toMinutes(startTime);
    const end = toMinutes(endTime);
    return start <= end ? current >= start && current < end : current >= start || current < end;
  } catch {
    return false;
  }
}
function policyToDraft(policy: OperatingPolicy): OperatingPolicyUpdate {
  return {
    version: policy.version,
    siteName: policy.siteName,
    siteAddress: policy.siteAddress,
    timezone: policy.timezone,
    shifts: policy.shifts,
    geofenceRadiusMeters: policy.geofenceRadiusMeters,
    geofenceRequireInside: policy.geofenceRequireInside,
    tracking: policy.tracking,
    checklist: policy.checklist,
    sosAcknowledgementMinutes: policy.sosAcknowledgementMinutes,
    sosEscalationMessage: policy.sosEscalationMessage,
    changeReason: '',
    approvals: policy.approvals,
    requests: policy.requests,
  };
}

const policySectionLabels: Record<string, string> = {
  site: 'Site and shifts',
  attendance: 'Attendance and geofence',
  tracking: 'Live tracking',
  checklist: 'Daily checklist',
  sos: 'SOS response',
  approvals: 'Approval routing',
  requests: 'Employee requests',
};

type PolicySection = 'site' | 'attendance' | 'tracking' | 'checklist' | 'sos' | 'approvals' | 'requests';
type PolicyConflict = {
  rejectedDraft: OperatingPolicyUpdate;
  basePolicy: OperatingPolicy;
  currentPolicy: OperatingPolicy;
};
type ConflictChoice = 'newer' | 'intended';
type PersistedPolicyConflict = {
  schemaVersion: 1;
  draft: OperatingPolicyUpdate;
  conflict: PolicyConflict;
  choices: Partial<Record<PolicySection, ConflictChoice>>;
};

const policyConflictStoragePrefix = 'blackbelt-commandos:policy-conflict:';

function policyConflictStorageKey(userId: string) {
  return `${policyConflictStoragePrefix}${encodeURIComponent(userId)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readPersistedPolicyConflict(storageKey: string): PersistedPolicyConflict | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      value.schemaVersion !== 1 ||
      !isRecord(value.draft) ||
      !isRecord(value.conflict) ||
      !isRecord(value.conflict.rejectedDraft) ||
      !isRecord(value.conflict.basePolicy) ||
      !isRecord(value.conflict.currentPolicy) ||
      !isRecord(value.choices)
    ) {
      window.localStorage.removeItem(storageKey);
      return null;
    }
    return value as PersistedPolicyConflict;
  } catch {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
    return null;
  }
}

function clearPersistedPolicyConflict(storageKey: string | null) {
  if (!storageKey) return;
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

function policySectionSnapshots(policy: OperatingPolicy | OperatingPolicyUpdate): Record<PolicySection, unknown> {
  return {
    site: {
      siteName: policy.siteName,
      siteAddress: policy.siteAddress,
      timezone: policy.timezone,
      shifts: policy.shifts,
    },
    attendance: {
      geofenceRadiusMeters: policy.geofenceRadiusMeters,
      geofenceRequireInside: policy.geofenceRequireInside,
    },
    tracking: policy.tracking,
    checklist: policy.checklist,
    sos: {
      sosAcknowledgementMinutes: policy.sosAcknowledgementMinutes,
      sosEscalationMessage: policy.sosEscalationMessage,
    },
    approvals: policy.approvals,
    requests: policy.requests,
  };
}

function policySectionsEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function applyPolicySection(
  draft: OperatingPolicyUpdate,
  section: PolicySection,
  source: OperatingPolicy | OperatingPolicyUpdate,
) {
  const sectionValues = policySectionSnapshots(source)[section] as Partial<OperatingPolicyUpdate>;
  return { ...draft, ...sectionValues };
}

type RevisionValueRow = { label: string; value: string };

function revisionObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function revisionBoolean(value: unknown) {
  return value === true ? 'Yes' : value === false ? 'No' : display(value);
}

function revisionRolePath(value: unknown) {
  return Array.isArray(value) && value.length > 0 ? value.join(' → ') : 'No approval roles';
}

function revisionShifts(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return 'No shifts configured';
  return value.map((shift) => {
    const entry = revisionObject(shift);
    if (!entry) return display(shift);
    return `${display(entry.name)} · ${display(entry.startTime)}–${display(entry.endTime)}`;
  }).join('\n');
}

function revisionChecklist(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return 'No checklist items';
  return value.map((item) => {
    const entry = revisionObject(item);
    if (!entry) return display(item);
    return `${display(entry.label)} · ${display(entry.category)} · ${entry.required === true ? 'Required' : 'Optional'}`;
  }).join('\n');
}

function revisionMoney(value: unknown) {
  return typeof value === 'number'
    ? `₹${value.toLocaleString('en-IN')}`
    : display(value);
}

function revisionValueRows(section: string, value: unknown): RevisionValueRow[] {
  const snapshot = revisionObject(value);
  if (!snapshot) return [{ label: 'Value', value: display(value, 'Not recorded') }];

  if (section === 'site') {
    return [
      { label: 'Site name', value: display(snapshot.siteName) },
      { label: 'Site address', value: display(snapshot.siteAddress) },
      { label: 'Time zone', value: display(snapshot.timezone) },
      { label: 'Shifts', value: revisionShifts(snapshot.shifts) },
    ];
  }
  if (section === 'attendance') {
    return [
      { label: 'Geofence radius', value: `${display(snapshot.geofenceRadiusMeters)} metres` },
      { label: 'Require presence inside geofence', value: revisionBoolean(snapshot.geofenceRequireInside) },
    ];
  }
  if (section === 'tracking') {
    return [
      { label: 'Location tracking', value: snapshot.enabled === true ? 'Enabled' : snapshot.enabled === false ? 'Disabled' : display(snapshot.enabled) },
      { label: 'Operating window', value: `${display(snapshot.startTime)}–${display(snapshot.endTime)}` },
      { label: 'Heartbeat', value: `${display(snapshot.heartbeatMinutes)} minutes` },
      { label: 'Offline after', value: `${display(snapshot.offlineAfterMinutes)} minutes` },
    ];
  }
  if (section === 'checklist') {
    return [{ label: 'Checklist items', value: revisionChecklist(value) }];
  }
  if (section === 'sos') {
    return [
      { label: 'Acknowledgement window', value: `${display(snapshot.sosAcknowledgementMinutes)} minutes` },
      { label: 'Escalation instruction', value: display(snapshot.sosEscalationMessage) },
    ];
  }
  if (section === 'approvals') {
    return [
      { label: 'Employee verification', value: revisionRolePath(snapshot.verification) },
      { label: 'Leave requests', value: revisionRolePath(snapshot.leave) },
      { label: 'Salary advances', value: revisionRolePath(snapshot.salaryAdvance) },
      { label: 'Bill submissions', value: revisionRolePath(snapshot.bills) },
    ];
  }
  if (section === 'requests') {
    const salaryAdvance = revisionObject(snapshot.salaryAdvance) ?? {
      enabled: snapshot.salaryAdvanceEnabled,
      maxAmount: snapshot.salaryAdvanceMaxAmount,
    };
    const bills = revisionObject(snapshot.bills) ?? {
      enabled: snapshot.billSubmissionEnabled,
      maxAmount: snapshot.billMaxAmount,
      receiptRequired: snapshot.billReceiptRequired,
    };
    return [
      {
        label: 'Salary advances',
        value: salaryAdvance
          ? `${revisionBoolean(salaryAdvance.enabled)} · up to ${revisionMoney(salaryAdvance.maxAmount)}`
          : 'Not recorded',
      },
      {
        label: 'Bill submissions',
        value: bills
          ? `${revisionBoolean(bills.enabled)} · up to ${revisionMoney(bills.maxAmount)} · Receipt ${bills.receiptRequired === true ? 'required' : 'optional'}`
          : 'Not recorded',
      },
    ];
  }

  return Object.entries(snapshot).map(([key, entry]) => ({
    label: key.replace(/([A-Z])/g, ' $1').replace(/^./, (character) => character.toUpperCase()),
    value: Array.isArray(entry) ? entry.join(', ') : display(entry),
  }));
}

function RevisionValueColumn({ section, value, label }: { section: string; value: unknown; label: string }) {
  return <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background)_/_0.48)] p-3">
    <div className="eyebrow mb-3">{label}</div>
    <div className="space-y-3">
      {revisionValueRows(section, value).map((row) => <div key={row.label}>
        <div className="field-label !mb-1">{row.label}</div>
        <div className="whitespace-pre-line text-xs leading-5">{row.value}</div>
      </div>)}
    </div>
  </div>;
}

function LoadingState({ rows = 4 }: { rows?: number }) {
  return <div className="space-y-3" data-testid="loading-state">{Array.from({ length: rows }).map((_, i) => <div key={i} className="h-14 rounded-lg bg-[hsl(var(--muted))] animate-pulse" />)}</div>;
}
function ErrorState({ onRetry }: { onRetry?: () => void }) {
  return <div className="card-surface flex flex-col items-center justify-center gap-3 p-10 text-center" data-testid="error-state"><AlertTriangle className="h-8 w-8 text-[hsl(var(--destructive))]" /><strong>Command feed unavailable</strong><p className="text-sm text-[hsl(var(--muted-foreground))]">We could not reach the operations service.</p>{onRetry && <button className="btn btn-secondary" onClick={onRetry} data-testid="button-retry"><RefreshCw size={14} /> Try again</button>}</div>;
}
function EmptyState({ icon: Icon = ClipboardCheck, title, detail }: { icon?: typeof ClipboardCheck; title: string; detail: string }) {
  return <div className="flex flex-col items-center justify-center gap-2 py-14 text-center" data-testid="empty-state"><Icon className="h-8 w-8 text-[hsl(var(--primary))]" /><strong>{title}</strong><p className="max-w-sm text-sm text-[hsl(var(--muted-foreground))]">{detail}</p></div>;
}
function StatusPill({ value }: { value: string }) { return <span className={cx('status-pill', statusClass(value))} data-testid={`status-${value.replace(/\s+/g, '-').toLowerCase()}`}>{display(value).replace('_', ' ')}</span>; }
function SectionHeading({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return <div className="mb-4 flex items-end justify-between gap-4"><div>{eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}<h2 className="section-title">{title}</h2></div>{action}</div>;
}

const allRoles: WorkforceRole[] = ['Guard', 'Supervisor', 'Security Officer', 'Field Officer', 'Management', 'Control Room'];
const routeRoles: Record<string, WorkforceRole[]> = {
  '/dashboard': allRoles,
  '/operations': ['Supervisor', 'Security Officer', 'Management', 'Control Room'],
  '/attendance': allRoles,
  '/team': ['Supervisor', 'Security Officer', 'Management', 'Control Room'],
  '/tracking': ['Supervisor', 'Security Officer', 'Field Officer', 'Management', 'Control Room'],
  '/verification': ['Supervisor', 'Security Officer', 'Management', 'Control Room'],
  '/requests': allRoles,
  '/payslips': allRoles,
  '/client-portal': ['Management', 'Control Room'],
  '/policies': ['Management'],
  '/access': ['Management'],
};

function useAccess(): Access {
  const access = useContext(AccessContext);
  if (!access) throw new Error('Access context is unavailable.');
  return access;
}

function AccessDenied() {
  const access = useAccess();
  return <div className="page-wrap"><div className="card-surface mx-auto max-w-xl p-8 text-center"><Shield className="mx-auto mb-4 h-9 w-9 text-[hsl(var(--primary))]" /><div className="eyebrow mb-2">Restricted operation</div><h1 className="section-title">This view is not assigned to your role</h1><p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">Your {access.role} assignment can only open the routes shown in the navigation.</p><Link href="/dashboard" className="btn btn-primary mt-6">Back to command center</Link></div></div>;
}

function RoleRoute({ path, children }: { path: string; children: ReactNode }) {
  const access = useAccess();
  return routeRoles[path]?.includes(access.role) ? <>{children}</> : <AccessDenied />;
}

function AuthLoading({ label = 'Loading secure workspace…' }: { label?: string }) {
  return <div className="grid min-h-[100dvh] place-items-center bg-[hsl(var(--background))] p-6"><div className="card-surface w-full max-w-sm p-8 text-center"><div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-xl bg-[hsl(var(--primary))] text-white"><Shield size={21} /></div><div className="eyebrow">{label}</div><div className="mt-5 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div className="h-full w-1/2 animate-pulse rounded-full bg-[hsl(var(--accent))]" /></div></div></div>;
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const access = useAccess();
  const { signOut } = useClerk();
  const { user } = useUser();
  const policy = useGetOperatingPolicy();
  const current = nav.find((item) => item.href === location)?.label ?? 'Command center';
  const policyLabel = policy.data ? `${policy.data.siteName} · ${policy.data.timezone}` : 'Loading active policy';
  const visibleNav = nav.filter((item) => !item.roles || item.roles.includes(access.role));
  const displayName = user?.fullName || user?.primaryEmailAddress?.emailAddress || 'Authenticated operator';
  const signOutAndReturnHome = () => signOut({ redirectUrl: basePath || '/' });
  const role = access.role;
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="flex items-center gap-3 px-5 py-6">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[hsl(var(--sidebar-primary))] text-[hsl(var(--sidebar-primary-foreground))]"><Shield size={19} strokeWidth={2.5} /></div>
        <div className="brand-copy"><div className="font-['Space_Grotesk'] text-[15px] font-bold tracking-[-.03em]">BLACKBELT</div><div className="mono text-[9px] tracking-[.14em] text-[hsl(44_20%_57%)]">COMMANDOS</div></div>
      </div>
      <div className="px-3"><div className="nav-group">Operations</div>{visibleNav.slice(0, 5).map(({ href, label, icon: Icon }) => <Link href={href} key={href} className={cx('nav-item', location === href && 'active')} data-testid={`link-${label.toLowerCase().replace(/\s+/g, '-')}`}><Icon /><span>{label}</span></Link>)}
      <div className="nav-group">Workforce</div>{visibleNav.slice(5).map(({ href, label, icon: Icon }) => <Link href={href} key={href} className={cx('nav-item', location === href && 'active')} data-testid={`link-${label.toLowerCase().replace(/\s+/g, '-')}`}><Icon /><span>{label}</span></Link>)}</div>
      <div className="mt-auto px-4 pb-5"><div className="sidebar-foot-copy mb-3 rounded-lg border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent))] p-3"><div className="eyebrow !text-[hsl(var(--accent))]">Duty posture</div><div className="mt-2 flex items-center gap-2 text-xs font-bold"><span className="h-2 w-2 rounded-full bg-[hsl(155_50%_54%)]" /> {access.siteName}</div></div><div className="flex items-center gap-2 border-t border-[hsl(var(--sidebar-border))] pt-4"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[hsl(var(--accent))] text-xs font-extrabold text-[hsl(var(--accent-foreground))]">{initials(displayName)}</div><div className="sidebar-foot-copy min-w-0"><div className="truncate text-xs font-bold">{displayName}</div><div className="truncate text-[10px] text-[hsl(44_20%_57%)]">{role}</div></div></div></div>
    </aside>
    <div className="main-area">
      <header className="topbar"><div className="flex items-center gap-3"><button className="btn btn-quiet !hidden max-[640px]:!inline-flex !p-2" onClick={() => setMobileOpen(!mobileOpen)} data-testid="button-open-menu"><Menu size={17} /></button><div><div className="eyebrow hidden sm:block">BlackBelt / {current}</div><div className="context text-xs font-semibold text-[hsl(var(--muted-foreground))]">{access.siteName} <span className="mx-2 text-[hsl(var(--border))]">/</span> Assigned workspace</div></div></div><div className="flex items-center gap-2"><div className="hidden items-center gap-2 sm:flex"><span className="rounded-full bg-[hsl(var(--secondary))] px-2.5 py-1 text-[10px] font-bold">{access.role}</span><button className="btn btn-quiet !h-9 !min-h-9 !px-2.5" onClick={signOutAndReturnHome} data-testid="button-sign-out"><LogOut size={14} /> Sign out</button></div><button className="btn btn-quiet !h-9 !min-h-9 !w-9 !p-0" data-testid="button-notifications"><Bell size={16} /></button><div className="grid h-8 w-8 place-items-center rounded-full bg-[hsl(var(--primary))] text-[10px] font-bold text-white sm:hidden">{initials(displayName)}</div></div></header>
      {mobileOpen && <div className="absolute right-3 top-16 z-30 w-56 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 shadow-xl sm:hidden">{visibleNav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className="flex items-center gap-3 rounded-md px-3 py-2 text-xs font-bold hover:bg-[hsl(var(--muted))]" onClick={() => setMobileOpen(false)}><Icon size={15} />{label}</Link>)}<button className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-xs font-bold text-[hsl(var(--destructive))]" onClick={signOutAndReturnHome}><LogOut size={15} /> Sign out</button></div>}
        <main><div className="border-b border-[hsl(var(--border))] bg-[hsl(var(--card)_/_0.72)] px-4 py-2 text-[10px] text-[hsl(var(--muted-foreground))] sm:px-8"><span className="font-bold text-[hsl(var(--foreground))]">Active policy</span><span className="mx-2">·</span>{policyLabel}{policy.data && <><span className="mx-2">·</span>Geofence {policy.data.geofenceRadiusMeters}m<span className="mx-2">·</span>SOS ack {policy.data.sosAcknowledgementMinutes} min<span className="mx-2">·</span>Tracking {policy.data.tracking.startTime}–{policy.data.tracking.endTime} / {policy.data.tracking.heartbeatMinutes} min</>}</div><RoleContext.Provider value={role}>{children}</RoleContext.Provider></main>
       <nav className="mobile-nav">{visibleNav.slice(0, 5).map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={location === href ? 'active' : ''} data-testid={`mobile-link-${label.toLowerCase().replace(/\s+/g, '-')}`}><Icon /><span>{label === 'Command center' ? 'Home' : label.split(' ')[0]}</span></Link>)}</nav>
    </div>
  </div>;
}

function Dashboard() {
  const role = useContext(RoleContext);
  const { user } = useUser();
  const displayName = user?.fullName || user?.primaryEmailAddress?.emailAddress || 'operator';
  const summary = useGetDashboardSummary();
  const activity = useGetActivity();
  const report = useGetTodaySiteReport();
  const policy = useGetOperatingPolicy();
  const triggerSos = useTriggerSos();
  const { toast } = useToast();
  const metrics = [
    { label: 'Coverage', value: summary.data?.coverage, suffix: '%', icon: Shield, delta: 'Across 12 active sites' },
    { label: 'Attendance', value: summary.data?.attendance, suffix: '%', icon: UserCheck, delta: 'Shift start window open' },
    { label: 'Patrol completion', value: summary.data?.patrol, suffix: '%', icon: Navigation, delta: 'Last sync 08:42' },
    { label: 'Open incidents', value: summary.data?.incidents, suffix: '', icon: Siren, delta: '2 need supervisor review' },
    { label: 'Open approvals', value: summary.data?.openApprovals, suffix: '', icon: FileCheck2, delta: 'Management queue' },
    { label: 'Field officers', value: summary.data?.fieldOfficers, suffix: ' live', icon: LocateFixed, delta: 'Location heartbeat healthy' },
  ];
  const handleSos = () => { const acknowledgementMinutes = policy.data?.sosAcknowledgementMinutes ?? 5; if (!window.confirm(`Trigger an emergency alert? Control Room must acknowledge within ${acknowledgementMinutes} minutes.`)) return; triggerSos.mutate({ data: { employeeName: displayName, location: policy.data?.siteName ?? 'Assigned site' } }, { onSuccess: () => toast({ title: 'SOS alert dispatched', description: `Control room acknowledgement is due within ${acknowledgementMinutes} minutes.` }), onError: () => toast({ title: 'SOS could not be dispatched', variant: 'destructive' }) }); };
  return <div className="page-wrap"><div className="reveal mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><div className="eyebrow mb-3">Live operating picture / 08:45 IST</div><h1 className="page-title">{role === 'Guard' ? 'Your post, in view.' : role === 'Field Officer' ? 'Your route, in view.' : `Good morning, ${displayName.split(' ')[0]}.`}</h1><p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">{role} view · {role === 'Guard' ? 'Keep your attendance and checklist current.' : role === 'Field Officer' ? 'Keep your location heartbeat and requests current.' : 'The network is covered. Here is what needs your attention next.'}</p></div><button className="btn btn-danger self-start md:self-auto" onClick={handleSos} disabled={triggerSos.isPending} data-testid="button-trigger-sos"><Siren size={15} />{triggerSos.isPending ? 'Dispatching…' : 'Emergency SOS'}</button></div>
    <div className="reveal-2 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">{metrics.map(({ label, value, suffix, icon: Icon, delta }) => <div className="card-surface metric-card" key={label} data-testid={`metric-${label.toLowerCase().replace(/\s+/g, '-')}`}><div className="flex items-start justify-between"><div className="eyebrow !text-[hsl(var(--muted-foreground))]">{label}</div><Icon size={17} className="text-[hsl(var(--primary))]" /></div><div className="metric-value mt-4">{summary.isLoading ? '—' : `${display(value, '0')}${suffix}`}</div><div className="metric-delta">{delta}</div></div>)}</div>
     <div className="reveal-3 mt-7 grid gap-6 xl:grid-cols-[1.35fr_.8fr]"><div className="card-surface overflow-hidden"><div className="flex items-center justify-between border-b border-[hsl(var(--border))] p-5"><div><div className="eyebrow mb-2">Operations feed</div><h2 className="section-title">Recent activity</h2></div><Link href="/tracking" className="btn btn-quiet !min-h-8 !px-2.5" data-testid="link-view-live-feed">View live feed <ArrowUpRight size={13} /></Link></div>{activity.isLoading ? <div className="p-5"><LoadingState /></div> : activity.isError ? <div className="p-5"><ErrorState onRetry={() => activity.refetch()} /></div> : <div>{(activity.data ?? []).length === 0 ? <EmptyState icon={ActivityIcon} title="No activity yet" detail="New operational events will appear here." /> : (activity.data ?? []).slice(0, 6).map((item: Activity) => <div key={item.id} className="flex gap-3 border-b border-[hsl(var(--border))] px-5 py-4 last:border-0" data-testid={`activity-${item.id}`}><div className={cx('mt-1 h-2 w-2 shrink-0 rounded-full', item.tone === 'danger' ? 'bg-[hsl(var(--destructive))]' : item.tone === 'warning' ? 'bg-[hsl(var(--accent))]' : 'bg-[hsl(var(--primary))]')} /><div className="min-w-0 flex-1"><div className="flex justify-between gap-4"><div className="text-xs font-bold">{item.title}</div><div className="mono shrink-0 text-[10px] text-[hsl(var(--muted-foreground))]">{display(item.time)}</div></div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{item.detail}</div></div></div>)}</div>}</div>
      <div className="space-y-6"><div className="card-surface p-5"><SectionHeading eyebrow="Site report" title="Mumbai network" action={<span className="status-pill status-ok">Stable</span>} />{report.isLoading ? <LoadingState rows={3} /> : report.isError ? <ErrorState onRetry={() => report.refetch()} /> : <div className="space-y-4">{[['Coverage', report.data?.coverage], ['Attendance', report.data?.attendance], ['Patrol completion', report.data?.patrolCompletion]].map(([label, value]) => <div key={String(label)}><div className="mb-1.5 flex justify-between text-xs font-bold"><span>{label}</span><span className="mono text-[hsl(var(--primary))]">{display(value, '0')}%</span></div><div className="h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div className="h-full rounded-full bg-[hsl(var(--primary))] transition-all" style={{ width: `${Number(value ?? 0)}%` }} /></div></div>)}<div className="mt-5 flex items-center justify-between border-t border-[hsl(var(--border))] pt-4"><span className="text-xs text-[hsl(var(--muted-foreground))]">Open site issues</span><span className={cx('status-pill', Number(report.data?.openIssues ?? 0) > 0 ? 'status-warn' : 'status-ok')}>{display(report.data?.openIssues, '0')}</span></div></div>}</div>
       <div className="card-surface bg-[hsl(var(--sidebar))] p-5 text-[hsl(var(--sidebar-foreground))]"><div className="eyebrow !text-[hsl(var(--accent))]">Control room note</div><h2 className="mt-2 font-['Space_Grotesk'] text-xl font-bold tracking-[-.03em]">Stay ahead of the gap.</h2><p className="mt-2 text-xs leading-5 text-[hsl(44 20% 70%)]">Three approval decisions and one attendance exception are waiting in the queue.</p><div className="mt-4 border-t border-[hsl(var(--sidebar-border))] pt-4 text-xs text-[hsl(44 20% 78%)]"><span className="font-bold">{policy.data?.siteName ?? 'Assigned site'}</span><br />SOS acknowledgement: {policy.data ? `${policy.data.sosAcknowledgementMinutes} min` : 'Loading…'}</div><Link href="/verification" className="btn mt-5 !bg-[hsl(var(--accent))] !text-[hsl(var(--accent-foreground))]" data-testid="link-review-queue">Review queue <ArrowUpRight size={14} /></Link></div></div></div>
  </div>;
}

function Attendance() {
  const query = useGetTodayAttendance();
  const policy = useGetOperatingPolicy();
  const punch = usePunchAttendance();
  const { toast } = useToast();
  const record = query.data as AttendanceRecord | undefined;
  const performPunch = (action: 'in' | 'out') => {
    if (!navigator.geolocation) {
      toast({ title: 'Location unavailable', description: 'This device does not provide GPS. Ask a supervisor to record a correction.', variant: 'destructive' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const capturedAt = new Date(position.timestamp || Date.now()).toISOString();
        punch.mutate({
          data: {
            action,
            location: policy.data?.siteName || record?.site || 'Assigned site',
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMeters: position.coords.accuracy,
            capturedAt,
            source: 'online',
            idempotencyKey: `${action}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          },
        }, {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetTodayAttendanceQueryKey() });
            toast({ title: action === 'in' ? 'Shift started' : 'Shift closed', description: 'Server verified your location and attendance event.' });
          },
          onError: (error: unknown) => toast({
            title: 'Punch not accepted',
            description: error instanceof Error ? error.message : 'Confirm you are inside the site geofence with a clear GPS signal.',
            variant: 'destructive',
          }),
        });
      },
      (error) => toast({
        title: 'Location permission needed',
        description: error.message || 'Allow location access to record a verified attendance punch.',
        variant: 'destructive',
      }),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  };
   return <div className="page-wrap"><div className="mb-8"><div className="eyebrow mb-3">Workforce / attendance</div><h1 className="page-title">Today’s attendance</h1><p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">Verify your shift presence against the assigned site geofence.</p></div>{query.isLoading ? <LoadingState rows={5} /> : query.isError ? <ErrorState onRetry={() => query.refetch()} /> : <div className="grid gap-6 lg:grid-cols-[1fr_.65fr]"><div className="card-surface overflow-hidden"><div className="flex items-center justify-between border-b border-[hsl(var(--border))] p-5"><div><div className="eyebrow mb-2">Live record</div><h2 className="section-title">{display(record?.employeeName, 'Assigned employee')}</h2></div><StatusPill value={display(record?.status, 'pending')} /></div><div className="grid gap-4 p-5 sm:grid-cols-2"><div><div className="field-label">Shift</div><div className="text-sm font-bold">{display(record?.shift)}</div><div className="text-[10px] text-[hsl(var(--muted-foreground))]">Window {display(record?.shiftWindow)}</div></div><div><div className="field-label">Assigned site</div><div className="text-sm font-bold">{display(record?.site)}</div><div className="text-[10px] text-[hsl(var(--muted-foreground))]">{display(record?.siteAddress)}</div></div><div><div className="field-label">Punch in</div><div className="mono text-sm">{fmtTime(record?.punchIn)}</div></div><div><div className="field-label">Punch out</div><div className="mono text-sm">{fmtTime(record?.punchOut)}</div></div></div><div className="mx-5 mb-5 rounded-lg border border-[hsl(var(--primary)_/_0.22)] bg-[hsl(var(--primary)_/_0.06)] p-4"><div className="flex gap-3"><LocateFixed className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" size={18} /><div><div className="text-xs font-bold">Geofence policy · {display(record?.geofenceRadiusMeters, policy.data?.geofenceRadiusMeters ?? 0)}m</div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{display(record?.geofence, 'Location context will be checked at punch time.')}</div></div></div></div><div className="flex flex-col gap-3 border-t border-[hsl(var(--border))] p-5 sm:flex-row"><button className="btn btn-primary flex-1" disabled={punch.isPending || Boolean(record?.punchIn)} onClick={() => performPunch('in')} data-testid="button-punch-in"><LogIn size={15} />{record?.punchIn ? `In at ${fmtTime(record.punchIn)}` : punch.isPending ? 'Recording…' : 'Punch in'}</button><button className="btn btn-secondary flex-1" disabled={punch.isPending || !record?.punchIn || Boolean(record?.punchOut)} onClick={() => performPunch('out')} data-testid="button-punch-out"><LogOut size={15} />{record?.punchOut ? `Out at ${fmtTime(record.punchOut)}` : 'Punch out'}</button></div></div><div className="card-surface p-5"><SectionHeading eyebrow="Operator guidance" title="A clean handover starts here" /><div className="space-y-4 text-xs leading-5 text-[hsl(var(--muted-foreground))]"><div className="flex gap-3"><CheckCircle2 className="shrink-0 text-[hsl(var(--primary))]" size={17} /><span>Stay inside the {display(record?.geofenceRadiusMeters, policy.data?.geofenceRadiusMeters ?? 0)}m assigned geofence when recording a punch.</span></div><div className="flex gap-3"><CheckCircle2 className="shrink-0 text-[hsl(var(--primary))]" size={17} /><span>Your supervisor sees attendance changes immediately.</span></div><div className="flex gap-3"><CheckCircle2 className="shrink-0 text-[hsl(var(--primary))]" size={17} /><span>Raise an SOS only for an active safety emergency.</span></div></div></div></div>}</div>;
}

function Team() {
  const guards = useGetTeamGuards();
  const checklist = useGetTodayChecklist();
  const contacts = useGetEscalationContacts();
  const policy = useGetOperatingPolicy();
  const checkIn = useCheckInGuard();
  const updateCheck = useUpdateChecklistItem();
  const { toast } = useToast();
  const doCheckIn = (id: string) => checkIn.mutate({ id }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetTeamGuardsQueryKey() }); toast({ title: 'Guard checked in' }); }, onError: () => toast({ title: 'Check-in failed', variant: 'destructive' }) });
  const toggle = (item: ChecklistItem) => updateCheck.mutate({ id: item.id, data: { completed: !item.completed } }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetTodayChecklistQueryKey() }), onError: () => toast({ title: 'Checklist update failed', variant: 'destructive' }) });
   return <div className="page-wrap"><div className="mb-8"><div className="eyebrow mb-3">Site operations / supervisor view</div><h1 className="page-title">Team readiness</h1><p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">Keep every post covered, checked, and ready for escalation.</p></div><div className="grid gap-6 xl:grid-cols-[1.35fr_.65fr]"><div className="card-surface overflow-hidden"><div className="flex items-center justify-between border-b border-[hsl(var(--border))] p-5"><div><div className="eyebrow mb-2">Reporting guards</div><h2 className="section-title">Post coverage</h2></div><span className="mono text-xs text-[hsl(var(--muted-foreground))]">{guards.data?.length ?? 0} assigned</span></div>{guards.isLoading ? <div className="p-5"><LoadingState /></div> : guards.isError ? <div className="p-5"><ErrorState onRetry={() => guards.refetch()} /></div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Guard</th><th>Post / shift</th><th>Last seen</th><th>Status</th><th /></tr></thead><tbody>{(guards.data ?? []).length === 0 ? <tr><td colSpan={5}><EmptyState icon={Users} title="No guards assigned" detail="Reporting guards will appear when a roster is published." /></td></tr> : (guards.data ?? []).map((guard: Guard) => <tr key={guard.id} data-testid={`row-guard-${guard.id}`}><td><div className="flex items-center gap-3"><div className="grid h-8 w-8 place-items-center rounded-full bg-[hsl(var(--secondary))] text-[10px] font-bold text-[hsl(var(--primary))]">{initials(guard.name)}</div><div><div className="font-bold">{guard.name}</div><div className="text-[10px] text-[hsl(var(--muted-foreground))]">{guard.role}</div></div></div></td><td><div className="font-semibold">{guard.post}</div><div className="text-[10px] text-[hsl(var(--muted-foreground))]">{guard.shift}</div></td><td className="mono text-[10px]">{display(guard.lastSeen)}</td><td><StatusPill value={guard.status} /></td><td><button className="btn btn-quiet !min-h-8 !px-2.5" disabled={checkIn.isPending || guard.status.toLowerCase().includes('present') || guard.status.toLowerCase().includes('active')} onClick={() => doCheckIn(guard.id)} data-testid={`button-check-in-${guard.id}`}><UserCheck size={13} /> Check in</button></td></tr>)}</tbody></table></div>}</div><div className="card-surface p-5"><SectionHeading eyebrow="Shift control" title="Daily checklist" /><div className="mb-4 rounded-lg bg-[hsl(var(--muted))] p-3 text-[10px] text-[hsl(var(--muted-foreground))]">{policy.data?.checklist.filter((item) => item.required).length ?? 0} required items · configured for {policy.data?.shifts[0]?.name ?? 'active shift'}</div><div className="space-y-2">{checklist.isLoading ? <LoadingState rows={4} /> : checklist.isError ? <ErrorState onRetry={() => checklist.refetch()} /> : (checklist.data ?? []).length === 0 ? <EmptyState title="Checklist is clear" detail="There are no tasks assigned for this shift." /> : (checklist.data ?? []).map((item: ChecklistItem) => <button className="flex w-full items-center gap-3 rounded-lg border border-[hsl(var(--border))] p-3 text-left transition-colors hover:bg-[hsl(var(--muted))]" key={item.id} onClick={() => toggle(item)} data-testid={`checklist-${item.id}`}><span className={cx('grid h-5 w-5 shrink-0 place-items-center rounded border', item.completed ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-white' : 'border-[hsl(var(--input))]')}>{item.completed && <Check size={13} />}</span><span className="flex-1"><span className={cx('block text-xs font-semibold', item.completed && 'text-[hsl(var(--muted-foreground))] line-through')}>{item.label}</span><span className="text-[10px] text-[hsl(var(--muted-foreground))]">{item.category} · {item.required ? 'Required' : 'Optional'}</span></span></button>)}</div></div></div><div className="card-surface mt-6 p-5"><SectionHeading eyebrow="Reach the right person" title="Escalation contacts" /><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{contacts.isLoading ? <LoadingState rows={2} /> : (contacts.data ?? []).length === 0 ? <EmptyState icon={Phone} title="No escalation contacts" detail="Contacts will appear when your site hierarchy is configured." /> : (contacts.data ?? []).map((contact) => <div key={contact.id} className="rounded-lg border border-[hsl(var(--border))] p-4" data-testid={`contact-${contact.id}`}><div className="flex items-start justify-between"><div className="grid h-8 w-8 place-items-center rounded-full bg-[hsl(var(--secondary))] text-[10px] font-bold text-[hsl(var(--primary))]">{initials(contact.name)}</div><StatusPill value={contact.availability} /></div><div className="mt-4 text-xs font-bold">{contact.name}</div><div className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">{contact.role}</div><a href={`tel:${contact.phone}`} className="mt-3 flex items-center gap-1.5 text-xs font-bold text-[hsl(var(--primary))]" data-testid={`link-call-${contact.id}`}><Phone size={12} />{contact.phone}</a></div>)}</div></div></div>;
}

function Tracking() {
  const [city, setCity] = useState('');
  const [dutyStatus, setDutyStatus] = useState('');
  const role = useContext(RoleContext);
  const policy = useGetOperatingPolicy();
  const params = useMemo(() => ({ ...(city ? { city } : {}), ...(dutyStatus ? { dutyStatus } : {}) }), [city, dutyStatus]);
  const tracking = useGetFieldOfficerTracking(params, { query: { queryKey: getGetFieldOfficerTrackingQueryKey(params) } });
  const heartbeat = usePostLocationHeartbeat();
  const locations = (tracking.data ?? []) as FieldOfficerLocation[];
  const trackingWindowOpen = policy.data?.tracking ? isPolicyWindowActive(policy.data.tracking.startTime, policy.data.tracking.endTime, policy.data.timezone) : false;
  const sendHeartbeat = () => {
    if (!navigator.geolocation || !policy.data) return;
    navigator.geolocation.getCurrentPosition((position) => {
      heartbeat.mutate({
        data: {
          employeeName: 'Current Field Officer',
          city: policy.data?.city ?? 'Bengaluru',
          site: policy.data?.siteName,
          dutyStatus: 'On duty',
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          capturedAt: new Date(position.timestamp || Date.now()).toISOString(),
          source: 'browser',
        },
      }, {
        onSuccess: () => tracking.refetch(),
      });
    }, undefined, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
  };
  return <div className="page-wrap"><div className="mb-7 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><div className="eyebrow mb-3">Field network / location heartbeat</div><h1 className="page-title">Live tracking</h1><p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">Know where your field officers are and whether the next visit is moving.</p></div><div className="flex flex-wrap items-center justify-end gap-2"><span className={cx('status-pill', trackingWindowOpen ? 'status-ok' : 'status-neutral')}>{trackingWindowOpen ? 'Duty window open' : 'Tracking paused'}</span>{role === 'Field Officer' && <button className="btn btn-primary" onClick={sendHeartbeat} disabled={heartbeat.isPending || !trackingWindowOpen} data-testid="button-send-heartbeat"><LocateFixed size={14} />{heartbeat.isPending ? 'Sending…' : 'Send heartbeat'}</button>}<select className="field !w-auto !min-w-[130px]" value={city} onChange={(e) => setCity(e.target.value)} data-testid="select-city"><option value="">All cities</option><option value="Bengaluru">Bengaluru</option><option value="Mumbai">Mumbai</option><option value="Pune">Pune</option><option value="Nashik">Nashik</option></select><select className="field !w-auto !min-w-[130px]" value={dutyStatus} onChange={(e) => setDutyStatus(e.target.value)} data-testid="select-duty-status"><option value="">All statuses</option><option value="on_duty">On duty</option><option value="off_duty">Off duty</option></select></div></div>{!trackingWindowOpen && policy.data && <div className="mb-5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3 text-xs text-[hsl(var(--muted-foreground))]">Field locations are hidden outside the authorized {policy.data.tracking.startTime}–{policy.data.tracking.endTime} window ({policy.data.timezone}).</div>}<div className="grid gap-6 xl:grid-cols-[1.4fr_.8fr]"><div className="map-canvas" data-testid="tracking-map"><div className="map-label left-[15%] top-[22%]">Andheri East</div><div className="map-label left-[59%] top-[15%]">Powai</div><div className="map-label left-[31%] top-[68%]">Bandra</div><div className="map-label left-[72%] top-[72%]">Fort</div>{locations.map((person, index) => <div key={person.id} className="map-marker" style={{ left: `${Math.min(Math.max(person.coordinates?.x ?? (20 + index * 18), 9), 86)}%`, top: `${Math.min(Math.max(person.coordinates?.y ?? (23 + index * 14), 12), 78)}%` }} title={person.name}><span>{index + 1}</span></div>)}<div className="absolute bottom-4 left-4 rounded-lg border border-white/70 bg-[hsl(44_40%_99%_/_0.88)] px-3 py-2 text-[10px] font-bold shadow-sm"><span className="mr-2 inline-block h-2 w-2 rounded-full bg-[hsl(var(--primary))]" />{locations.length} officers reporting</div></div><div className="card-surface overflow-hidden"><div className="border-b border-[hsl(var(--border))] p-5"><div className="eyebrow mb-2">Roster pulse</div><h2 className="section-title">Field officers</h2></div>{tracking.isLoading ? <div className="p-5"><LoadingState /></div> : tracking.isError ? <div className="p-5"><ErrorState onRetry={() => tracking.refetch()} /></div> : locations.length === 0 ? <EmptyState icon={LocateFixed} title="No officers match" detail="Try a different city or duty status filter." /> : <div>{locations.map((person) => <div className="flex gap-3 border-b border-[hsl(var(--border))] p-4 last:border-0" key={person.id} data-testid={`officer-${person.id}`}><div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[hsl(var(--primary))] text-[10px] font-bold text-white">{initials(person.name)}</div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><div className="truncate text-xs font-bold">{person.name}</div><StatusPill value={person.dutyStatus} /></div><div className="mt-1 flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))]"><MapPin size={10} />{person.location}, {person.city}</div><div className="mono mt-2 text-[9px] text-[hsl(var(--muted-foreground))]">Updated {display(person.lastUpdate)} · {person.accuracyMeters ? `±${Math.round(person.accuracyMeters)}m` : 'accuracy unavailable'}{person.stale ? ' · stale' : ''}</div></div></div>)}</div>}</div></div></div>;
}

function Verification() {
  const [status, setStatus] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', city: '', note: '' });
  const submissions = useGetEmployeeSubmissions(status ? { status } : undefined, { query: { queryKey: getGetEmployeeSubmissionsQueryKey(status ? { status } : undefined) } });
  const decide = useDecideEmployeeSubmission();
  const submit = useSubmitEmployeeDetails();
  const { toast } = useToast();
  const doDecision = (id: string, decision: 'accepted' | 'rejected' | 'sent_back') => decide.mutate({ id, data: { decision } }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetEmployeeSubmissionsQueryKey(status ? { status } : undefined) }); toast({ title: decision === 'accepted' ? 'Submission accepted' : decision === 'rejected' ? 'Submission rejected' : 'Sent back for correction' }); }, onError: () => toast({ title: 'Decision failed', variant: 'destructive' }) });
  const submitForm = (event: React.FormEvent) => { event.preventDefault(); submit.mutate({ data: form }, { onSuccess: () => { setForm({ name: '', phone: '', city: '', note: '' }); setShowForm(false); queryClient.invalidateQueries({ queryKey: getGetEmployeeSubmissionsQueryKey() }); toast({ title: 'Employee details submitted' }); }, onError: () => toast({ title: 'Submission failed', variant: 'destructive' }) }); };
   return <div className="page-wrap"><div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><div className="eyebrow mb-3">Management / employee verification</div><h1 className="page-title">Verification queue</h1><p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">Make clear decisions on workforce records before they reach the field.</p></div><button className="btn btn-primary self-start" onClick={() => setShowForm(!showForm)} data-testid="button-new-submission"><Plus size={15} /> New submission</button></div>{showForm && <form onSubmit={submitForm} className="card-surface mb-6 grid gap-4 p-5 md:grid-cols-4" data-testid="form-new-submission"><div><label className="field-label">Employee name</label><input required className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-submission-name" /></div><div><label className="field-label">Phone</label><input required className="field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-submission-phone" /></div><div><label className="field-label">City</label><input required className="field" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} data-testid="input-submission-city" /></div><div><label className="field-label">Note</label><input className="field" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} data-testid="input-submission-note" /></div><div className="flex gap-2 md:col-span-4"><button type="submit" className="btn btn-primary" disabled={submit.isPending} data-testid="button-submit-submission"><Check size={14} />{submit.isPending ? 'Submitting…' : 'Submit for review'}</button><button type="button" className="btn btn-quiet" onClick={() => setShowForm(false)} data-testid="button-cancel-submission">Cancel</button></div></form>}<div className="card-surface overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--border))] p-5"><div><div className="eyebrow mb-2">Decision queue</div><h2 className="section-title">Employee submissions</h2></div><select className="field !w-auto !min-w-[135px]" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="select-verification-status"><option value="">All submissions</option><option value="pending">Pending</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option><option value="sent_back">Sent back</option></select></div>{submissions.isLoading ? <div className="p-5"><LoadingState /></div> : submissions.isError ? <div className="p-5"><ErrorState onRetry={() => submissions.refetch()} /></div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Employee</th><th>Submitted by</th><th>Submitted</th><th>Documents</th><th>Status</th><th>Decision</th></tr></thead><tbody>{(submissions.data ?? []).length === 0 ? <tr><td colSpan={6}><EmptyState icon={FileCheck2} title="Queue is clear" detail="There are no employee submissions in this view." /></td></tr> : (submissions.data ?? []).map((item: EmployeeSubmission) => <tr key={item.id} data-testid={`row-submission-${item.id}`}><td><div className="font-bold">{item.name}</div><div className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">{item.phone} · {item.city}</div><div className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">Approval path: {item.approvalPath}</div></td><td>{item.submittedBy}</td><td className="mono text-[10px]">{fmtDate(item.submittedAt)}</td><td><span className="mono text-xs font-bold">{item.documents}</span><span className="ml-1 text-[10px] text-[hsl(var(--muted-foreground))]">files</span></td><td><StatusPill value={item.status} /></td><td>{item.status.toLowerCase() === 'pending' || item.status.toLowerCase() === 'review' ? <div className="flex gap-1.5"><button className="btn btn-primary !min-h-8 !px-2.5" onClick={() => doDecision(item.id, 'accepted')} disabled={decide.isPending} data-testid={`button-accept-${item.id}`}><Check size={12} />Accept</button><button className="btn btn-quiet !min-h-8 !px-2.5" onClick={() => doDecision(item.id, 'sent_back')} disabled={decide.isPending} data-testid={`button-send-back-${item.id}`}><ArrowUpRight size={12} />Send back</button><button className="btn btn-danger !min-h-8 !px-2.5" onClick={() => doDecision(item.id, 'rejected')} disabled={decide.isPending} data-testid={`button-reject-${item.id}`}><X size={12} /></button></div> : <span className="text-[10px] text-[hsl(var(--muted-foreground))]">Decision recorded</span>}</td></tr>)}</tbody></table></div>}</div></div>;
}

function Requests() {
  const [tab, setTab] = useState<'leave' | 'advance' | 'bill'>('leave');
  const requests = useGetRequests();
  const policy = useGetOperatingPolicy();
  const leave = useCreateLeaveRequest();
  const advance = useCreateSalaryAdvanceRequest();
  const bill = useCreateBillSubmission();
  const { toast } = useToast();
  const mark = () => { queryClient.invalidateQueries({ queryKey: getGetRequestsQueryKey() }); toast({ title: 'Request submitted', description: 'Your request is now with the review team.' }); };
  const submitLeave = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); leave.mutate({ data: { from: String(data.get('from')), to: String(data.get('to')), reason: String(data.get('reason')) } }, { onSuccess: mark, onError: () => toast({ title: 'Could not submit leave request', variant: 'destructive' }) }); };
  const submitAdvance = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); advance.mutate({ data: { amount: Number(data.get('amount')), reason: String(data.get('reason')) } }, { onSuccess: mark, onError: () => toast({ title: 'Could not submit salary advance', variant: 'destructive' }) }); };
  const submitBill = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); bill.mutate({ data: { category: String(data.get('category')), amount: Number(data.get('amount')), billDate: String(data.get('billDate')), vendor: String(data.get('vendor')), receiptReference: String(data.get('receiptReference') || '') } }, { onSuccess: mark, onError: () => toast({ title: 'Could not submit bill', description: 'Confirm the amount and receipt requirement in the active policy.', variant: 'destructive' }) }); };
  const requestTabs = [{ key: 'leave', Icon: CalendarDays, label: 'Leave request' }, { key: 'advance', Icon: WalletCards, label: 'Salary advance' }, { key: 'bill', Icon: ReceiptText, label: 'Bill submission' }] as const;
  return <div className="page-wrap"><div className="mb-8"><div className="eyebrow mb-3">Workforce / requests</div><h1 className="page-title">Requests desk</h1><p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">Send a complete request once, then keep the outcome visible.</p></div><div className="mb-6 rounded-lg border border-[hsl(var(--primary)_/_0.22)] bg-[hsl(var(--primary)_/_0.06)] p-4 text-xs"><div className="font-bold">Active request policy</div><div className="mt-1 text-[hsl(var(--muted-foreground))]">Advance limit: {policy.data ? `₹${policy.data.requests.salaryAdvanceMaxAmount.toLocaleString('en-IN')}` : 'Loading…'} · Bill limit: {policy.data ? `₹${policy.data.requests.billMaxAmount.toLocaleString('en-IN')}` : 'Loading…'} · Receipt reference: {policy.data?.requests.billReceiptRequired ? 'Required' : 'Optional'}</div></div><div className="grid gap-6 lg:grid-cols-[.72fr_1.28fr]"><div className="card-surface p-2"><div className="eyebrow px-3 pb-2 pt-3">Create request</div>{requestTabs.map(({ key, Icon, label }) => <button key={key} className={cx('flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-xs font-bold transition-colors', tab === key ? 'bg-[hsl(var(--primary))] text-white' : 'hover:bg-[hsl(var(--muted))]')} onClick={() => setTab(key)} data-testid={`tab-${key}`}><Icon size={16} />{label}</button>)}</div><div className="card-surface p-5">{tab === 'leave' && <form className="space-y-4" onSubmit={submitLeave} data-testid="form-leave"><h2 className="section-title">Plan time away</h2><div className="grid gap-4 sm:grid-cols-2"><div><label className="field-label">From</label><input name="from" type="date" required className="field" data-testid="input-leave-from" /></div><div><label className="field-label">To</label><input name="to" type="date" required className="field" data-testid="input-leave-to" /></div></div><div><label className="field-label">Reason</label><textarea name="reason" required className="field min-h-24" placeholder="Give your supervisor the context they need." data-testid="input-leave-reason" /></div><button className="btn btn-primary" disabled={leave.isPending} data-testid="button-submit-leave"><CalendarDays size={14} />{leave.isPending ? 'Sending…' : 'Submit leave request'}</button></form>}{tab === 'advance' && <form className="space-y-4" onSubmit={submitAdvance} data-testid="form-advance"><h2 className="section-title">Request a salary advance</h2><div><label className="field-label">Amount <span className="font-normal text-[hsl(var(--muted-foreground))]">up to {policy.data ? `₹${policy.data.requests.salaryAdvanceMaxAmount.toLocaleString('en-IN')}` : 'policy limit'}</span></label><input name="amount" type="number" min="1" max={policy.data?.requests.salaryAdvanceMaxAmount} step="0.01" required disabled={policy.data ? !policy.data.requests.salaryAdvanceEnabled : false} className="field" placeholder="0.00" data-testid="input-advance-amount" /></div><div><label className="field-label">Reason</label><textarea name="reason" required className="field min-h-24" placeholder="Explain the request briefly." data-testid="input-advance-reason" /></div><button className="btn btn-primary" disabled={advance.isPending || Boolean(policy.data && !policy.data.requests.salaryAdvanceEnabled)} data-testid="button-submit-advance"><WalletCards size={14} />{policy.data?.requests.salaryAdvanceEnabled === false ? 'Advances disabled' : advance.isPending ? 'Sending…' : 'Submit salary advance'}</button></form>}{tab === 'bill' && <form className="space-y-4" onSubmit={submitBill} data-testid="form-bill"><h2 className="section-title">Submit a field bill</h2><div className="grid gap-4 sm:grid-cols-2"><div><label className="field-label">Category</label><select name="category" className="field" required data-testid="input-bill-category"><option value="">Select category</option><option>Travel</option><option>Equipment</option><option>Site supplies</option><option>Other</option></select></div><div><label className="field-label">Amount <span className="font-normal text-[hsl(var(--muted-foreground))]">up to {policy.data ? `₹${policy.data.requests.billMaxAmount.toLocaleString('en-IN')}` : 'policy limit'}</span></label><input name="amount" type="number" min="1" max={policy.data?.requests.billMaxAmount} step="0.01" required disabled={policy.data ? !policy.data.requests.billSubmissionEnabled : false} className="field" placeholder="0.00" data-testid="input-bill-amount" /></div></div><div className="grid gap-4 sm:grid-cols-2"><div><label className="field-label">Bill date</label><input name="billDate" type="date" required className="field" data-testid="input-bill-date" /></div><div><label className="field-label">Vendor</label><input name="vendor" required className="field" placeholder="Vendor name" data-testid="input-bill-vendor" /></div></div><div><label className="field-label">Receipt reference {policy.data?.requests.billReceiptRequired ? '(required by policy)' : '(optional)'}</label><input name="receiptReference" required={policy.data?.requests.billReceiptRequired} className="field" placeholder="Receipt number or file reference" data-testid="input-bill-receipt" /></div><button className="btn btn-primary" disabled={bill.isPending || Boolean(policy.data && !policy.data.requests.billSubmissionEnabled)} data-testid="button-submit-bill"><ReceiptText size={14} />{policy.data?.requests.billSubmissionEnabled === false ? 'Bills disabled' : bill.isPending ? 'Sending…' : 'Submit bill'}</button></form>}</div></div><div className="card-surface p-5"><SectionHeading eyebrow="Submitted requests" title="Request history" action={<span className="mono text-[10px] text-[hsl(var(--muted-foreground))]">{requests.data?.length ?? 0} total</span>} />{requests.isLoading ? <LoadingState /> : requests.isError ? <ErrorState onRetry={() => requests.refetch()} /> : (requests.data ?? []).length === 0 ? <EmptyState icon={FileText} title="No submitted requests" detail="Completed requests will appear here with their current status." /> : <div className="space-y-2">{(requests.data ?? []).map((request: RequestRecord, index) => <div className="rounded-lg border border-[hsl(var(--border))] p-3" key={request.id} data-testid={`request-status-${index}`}><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="grid h-8 w-8 place-items-center rounded-full bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><Check size={15} /></div><div><div className="text-xs font-bold">{request.type}</div><div className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">{request.summary} · {fmtDate(request.submittedAt)}</div></div></div><StatusPill value={request.status} /></div><div className="mt-2 pl-11 text-[10px] text-[hsl(var(--muted-foreground))]">Approval path: {request.approvalPath}</div></div>)}</div>}</div></div>;
}

function Payslips() {
  const payslips = useGetPayslips();
  return <div className="page-wrap"><div className="mb-8"><div className="eyebrow mb-3">Workforce / compensation</div><h1 className="page-title">Payslips</h1><p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">Your released pay history, kept close at hand.</p></div><div className="card-surface overflow-hidden"><div className="flex items-center justify-between border-b border-[hsl(var(--border))] p-5"><div><div className="eyebrow mb-2">Compensation archive</div><h2 className="section-title">Available periods</h2></div><WalletCards className="text-[hsl(var(--primary))]" size={20} /></div>{payslips.isLoading ? <div className="p-5"><LoadingState rows={5} /></div> : payslips.isError ? <div className="p-5"><ErrorState onRetry={() => payslips.refetch()} /></div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Pay period</th><th>Net pay</th><th>Released</th><th>Status</th><th /></tr></thead><tbody>{(payslips.data ?? []).length === 0 ? <tr><td colSpan={5}><EmptyState icon={WalletCards} title="No payslips available" detail="Released payslips will be added to this archive." /></td></tr> : (payslips.data ?? []).map((slip: Payslip) => <tr key={slip.id} data-testid={`row-payslip-${slip.id}`}><td className="font-bold">{slip.period}</td><td className="font-['Space_Grotesk'] text-base font-bold">₹{Number(slip.netPay).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td><td className="mono text-[10px]">{fmtDate(slip.releasedAt)}</td><td><StatusPill value={slip.status} /></td><td><button className="btn btn-quiet !min-h-8 !px-2.5" disabled={slip.status.toLowerCase() !== 'released'} onClick={() => window.alert(`Payslip ${slip.period} is ready to view.`)} data-testid={`button-view-payslip-${slip.id}`}><FileText size={13} /> View</button></td></tr>)}</tbody></table></div>}</div></div>;
}

function PolicySettings() {
  const { user } = useUser();
  const policy = useGetOperatingPolicy();
  const revisionPageSize = 20;
  const [revisionOffset, setRevisionOffset] = useState(0);
  const revisionQuery = { offset: revisionOffset, limit: revisionPageSize + 1 };
  const revisions = useGetOperatingPolicyRevisions(revisionQuery, {
    query: {
      queryKey: getGetOperatingPolicyRevisionsQueryKey(revisionQuery),
    },
  });
  const update = useUpdateOperatingPolicy();
  const { toast } = useToast();
  const [draft, setDraft] = useState<OperatingPolicyUpdate>();
  const [draftBasePolicy, setDraftBasePolicy] = useState<OperatingPolicy>();
  const [conflict, setConflict] = useState<PolicyConflict | null>(null);
  const [conflictChoices, setConflictChoices] = useState<Partial<Record<PolicySection, ConflictChoice>>>({});
  const [expandedRevisions, setExpandedRevisions] = useState<Record<string, boolean>>({});
  const [exportingRevisionId, setExportingRevisionId] = useState<string | null>(null);
  const policyConflictKey = user?.id ? policyConflictStorageKey(user.id) : null;
  const restoredConflictKey = useRef<string | null | undefined>(undefined);
  const restoredConflict = useRef(false);
  const visibleRevisions = (revisions.data ?? []).slice(0, revisionPageSize);
  const hasOlderRevisions = (revisions.data?.length ?? 0) > revisionPageSize;

  useEffect(() => {
    if (!policyConflictKey || restoredConflictKey.current === policyConflictKey) return;
    restoredConflictKey.current = policyConflictKey;
    const persisted = readPersistedPolicyConflict(policyConflictKey);
    if (persisted) {
      restoredConflict.current = true;
      setDraft(persisted.draft);
      setDraftBasePolicy(persisted.conflict.basePolicy);
      setConflict(persisted.conflict);
      setConflictChoices(persisted.choices);
    } else {
      restoredConflict.current = false;
      setDraft(undefined);
      setDraftBasePolicy(undefined);
      setConflict(null);
      setConflictChoices({});
    }
  }, [policyConflictKey]);

  useEffect(() => {
    if (policy.data && !conflict && !restoredConflict.current) {
      setDraft(policyToDraft(policy.data));
      setDraftBasePolicy(policy.data);
    }
  }, [policy.data, conflict]);

  useEffect(() => {
    if (!policyConflictKey || !conflict || !draft) return;
    const persisted: PersistedPolicyConflict = {
      schemaVersion: 1,
      draft,
      conflict,
      choices: conflictChoices,
    };
    try {
      window.localStorage.setItem(policyConflictKey, JSON.stringify(persisted));
    } catch {
      // Storage can be unavailable or full; reconciliation still works in memory.
    }
  }, [policyConflictKey, draft, conflict, conflictChoices]);

  const conflictSections = conflict
    ? (Object.keys(policySectionLabels) as PolicySection[]).filter((section) =>
      !policySectionsEqual(
        policySectionSnapshots(conflict.rejectedDraft)[section],
        policySectionSnapshots(conflict.currentPolicy)[section],
      ) &&
      !policySectionsEqual(
        policySectionSnapshots(conflict.rejectedDraft)[section],
        policySectionSnapshots(conflict.basePolicy)[section],
      ),
    )
    : [];
  const unresolvedConflict = conflictSections.some((section) => !conflictChoices[section]);

  const chooseConflictValue = (section: PolicySection, choice: ConflictChoice) => {
    if (!conflict) return;
    const source = choice === 'newer' ? conflict.currentPolicy : conflict.rejectedDraft;
    setDraft((currentDraft: OperatingPolicyUpdate | undefined) => currentDraft
      ? { ...applyPolicySection(currentDraft, section, source), version: conflict.currentPolicy.version }
      : currentDraft);
    setConflictChoices((currentChoices) => ({ ...currentChoices, [section]: choice }));
  };

  const discardConflictDraft = () => {
    if (!conflict) return;
    clearPersistedPolicyConflict(policyConflictKey);
    setDraft(policyToDraft(conflict.currentPolicy));
    setConflict(null);
    setConflictChoices({});
  };

  const exportRevision = async (revision: OperatingPolicyRevision) => {
    setExportingRevisionId(revision.id);
    try {
      const content = await exportOperatingPolicyRevision(revision.id);
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `policy-revision-${revision.id}.txt`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast({ title: 'Comparison exported', description: 'The policy revision is ready to share for handover.' });
    } catch {
      toast({ title: 'Comparison could not be exported', description: 'Try again in a moment.', variant: 'destructive' });
    } finally {
      setExportingRevisionId(null);
    }
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft) return;
    if (conflict && unresolvedConflict) {
      toast({
        title: 'Review every changed section first',
        description: 'Choose the newer value or reapply your intended value before retrying.',
        variant: 'destructive',
      });
      return;
    }
    const submission = conflict
      ? { ...draft, version: conflict.currentPolicy.version }
      : draft;
    update.mutate({ data: submission }, {
      onSuccess: () => {
         clearPersistedPolicyConflict(policyConflictKey);
         setConflict(null);
         setConflictChoices({});
        setRevisionOffset(0);
        queryClient.invalidateQueries({ queryKey: getGetOperatingPolicyQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetOperatingPolicyRevisionsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetTodayAttendanceQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetTodayChecklistQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetRequestsQueryKey() });
        toast({ title: 'Operating policy saved', description: 'Attendance, tracking, approvals, and requests now use these rules.' });
      },
        onError: (error: unknown) => {
         const data = error && typeof error === 'object' && 'data' in error
           ? (error as { data?: unknown }).data
           : undefined;
          const currentPolicy = data && typeof data === 'object' && 'currentPolicy' in data
           ? (data as { currentPolicy?: OperatingPolicy }).currentPolicy
           : undefined;
          if (currentPolicy) {
            const basePolicy = draftBasePolicy ?? policy.data;
            if (!basePolicy) {
              toast({ title: 'Policy could not be reconciled', description: 'Reload the policy and try again.', variant: 'destructive' });
              return;
            }
            const baseSnapshots = policySectionSnapshots(basePolicy);
            const rejectedSnapshots = policySectionSnapshots(draft);
            const currentSnapshots = policySectionSnapshots(currentPolicy);
            const mergedDraft = (Object.keys(policySectionLabels) as PolicySection[]).reduce(
              (currentDraft, section) =>
                policySectionsEqual(rejectedSnapshots[section], baseSnapshots[section]) &&
                !policySectionsEqual(currentSnapshots[section], baseSnapshots[section])
                  ? applyPolicySection(currentDraft, section, currentPolicy)
                  : currentDraft,
              draft,
            );
            setConflict({
              rejectedDraft: draft,
              basePolicy,
              currentPolicy,
            });
            setDraft({ ...mergedDraft, version: currentPolicy.version });
            setConflictChoices({});
            queryClient.setQueryData(getGetOperatingPolicyQueryKey(), currentPolicy);
           queryClient.invalidateQueries({ queryKey: getGetOperatingPolicyRevisionsQueryKey() });
           toast({
             title: 'Policy changed by another manager',
              description: 'Your draft is preserved below so you can review each changed section before retrying.',
             variant: 'destructive',
           });
           return;
         }
         toast({ title: 'Policy could not be saved', description: 'Check the values and try again.', variant: 'destructive' });
       },
    });
  };

  if (policy.isLoading || !draft) return <div className="page-wrap"><LoadingState rows={7} /></div>;
  if (policy.isError) return <div className="page-wrap"><ErrorState onRetry={() => policy.refetch()} /></div>;

  const setDraftField = <K extends keyof OperatingPolicyUpdate>(key: K, value: OperatingPolicyUpdate[K]) =>
    setDraft({ ...draft, [key]: value });
  const approvalFields: Array<{ key: keyof OperatingPolicyUpdate['approvals']; label: string }> = [
    { key: 'verification', label: 'Employee verification' },
    { key: 'leave', label: 'Leave requests' },
    { key: 'salaryAdvance', label: 'Salary advances' },
    { key: 'bills', label: 'Bill submissions' },
  ];

  return <div className="page-wrap">
    <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div><div className="eyebrow mb-3">Management / operating controls</div><h1 className="page-title">Operating policies</h1><p className="mt-3 max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">Set the rules the field team sees and the operations service enforces. Changes apply to the active site immediately.</p></div>
      <div className="text-left md:text-right"><div className="field-label !mb-1">Last saved</div><div className="mono text-[10px] text-[hsl(var(--muted-foreground))]">{fmtDate(policy.data?.updatedAt)} · {display(policy.data?.updatedBy)}</div></div>
    </div>
      {conflict && <section className="mb-6 rounded-lg border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.06)] p-4" role="alert" data-testid="policy-conflict">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <div className="eyebrow mb-2 text-[hsl(var(--destructive))]">Save needs reconciliation</div>
            <h2 className="text-sm font-bold text-[hsl(var(--destructive))]">This policy changed while you were editing</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-[hsl(var(--muted-foreground))]">Your rejected draft is preserved. Compare it with the newer policy saved by {display(conflict.currentPolicy.updatedBy)} and choose which value should be kept for each changed section.</p>
          </div>
          <span className="status-pill status-danger shrink-0">{conflictSections.length} {conflictSections.length === 1 ? 'section' : 'sections'} differ</span>
        </div>
        <div className="mt-4 space-y-3">
          {conflictSections.length === 0
            ? <p className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background)_/_0.45)] p-3 text-xs text-[hsl(var(--muted-foreground))]">The version changed, but the policy values are otherwise identical. Retry to save your draft on top of version {conflict.currentPolicy.version}.</p>
            : conflictSections.map((section) => {
              const choice = conflictChoices[section];
              return <section key={section} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background)_/_0.45)] p-3" data-testid={`policy-conflict-section-${section}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-bold">{policySectionLabels[section]}</h3>
                  <span className={cx('status-pill', choice ? 'status-ok' : 'status-warn')}>{choice === 'newer' ? 'Keeping newer value' : choice === 'intended' ? 'Reapplying intended value' : 'Decision needed'}</span>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <RevisionValueColumn section={section} value={policySectionSnapshots(conflict.rejectedDraft)[section]} label="Your intended value" />
                  <RevisionValueColumn section={section} value={policySectionSnapshots(conflict.currentPolicy)[section]} label="Newer saved value" />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className={cx('btn !min-h-8 !px-3', choice === 'newer' ? 'btn-primary' : 'btn-quiet')} onClick={() => chooseConflictValue(section, 'newer')} data-testid={`button-policy-conflict-keep-${section}`}>Keep newer value</button>
                  <button type="button" className={cx('btn !min-h-8 !px-3', choice === 'intended' ? 'btn-primary' : 'btn-quiet')} onClick={() => chooseConflictValue(section, 'intended')} data-testid={`button-policy-conflict-reapply-${section}`}>Reapply intended value</button>
                </div>
              </section>;
            })}
        </div>
        <div className="mt-4 flex flex-col items-start justify-between gap-3 border-t border-[hsl(var(--border))] pt-4 sm:flex-row sm:items-center">
          <p className="text-[10px] text-[hsl(var(--muted-foreground))]">Retry uses the newer policy version {conflict.currentPolicy.version} and the choices above.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-quiet !min-h-9" onClick={discardConflictDraft} data-testid="button-policy-conflict-discard"><RefreshCw size={13} /> Discard my draft</button>
            <button type="submit" form="form-operating-policy" className="btn btn-primary !min-h-9" disabled={update.isPending || unresolvedConflict} data-testid="button-policy-conflict-retry"><Check size={13} />{update.isPending ? 'Retrying…' : 'Retry save'}</button>
          </div>
        </div>
      </section>}
     <form id="form-operating-policy" onSubmit={save} className="space-y-6" data-testid="form-operating-policy">
      <section className="card-surface p-5"><SectionHeading eyebrow="Accountability" title="Reason for this change" /><p className="mb-4 text-xs text-[hsl(var(--muted-foreground))]">Add context for the next handover or incident review. This note is kept with the policy revision.</p><textarea className="field min-h-20" maxLength={500} value={draft.changeReason ?? ''} onChange={(e) => setDraftField('changeReason', e.target.value)} placeholder="For example: Align the night shift with the revised site coverage plan." data-testid="input-policy-change-reason" /></section>
      <section className="card-surface p-5"><SectionHeading eyebrow="Deployment context" title="Site and shift rules" /><div className="grid gap-4 md:grid-cols-3"><div><label className="field-label">Site name</label><input required className="field" value={draft.siteName} onChange={(e) => setDraftField('siteName', e.target.value)} data-testid="input-policy-site-name" /></div><div className="md:col-span-2"><label className="field-label">Site address</label><input required className="field" value={draft.siteAddress} onChange={(e) => setDraftField('siteAddress', e.target.value)} data-testid="input-policy-site-address" /></div><div><label className="field-label">Timezone</label><input required className="field" value={draft.timezone} onChange={(e) => setDraftField('timezone', e.target.value)} data-testid="input-policy-timezone" /></div></div><div className="mt-5 grid gap-3 md:grid-cols-3">{draft.shifts.map((shift: ShiftRule, index) => <div className="rounded-lg border border-[hsl(var(--border))] p-4" key={shift.id}><div className="mb-3 flex items-center justify-between"><span className="eyebrow">{`Shift ${index + 1}`}</span><span className="mono text-[10px] text-[hsl(var(--muted-foreground))]">{shift.id}</span></div><label className="field-label">Name</label><input required className="field mb-3" value={shift.name} onChange={(e) => setDraft({ ...draft, shifts: draft.shifts.map((item) => item.id === shift.id ? { ...item, name: e.target.value } : item) })} /><div className="grid grid-cols-2 gap-2"><div><label className="field-label">Starts</label><input required type="time" className="field" value={shift.startTime} onChange={(e) => setDraft({ ...draft, shifts: draft.shifts.map((item) => item.id === shift.id ? { ...item, startTime: e.target.value } : item) })} /></div><div><label className="field-label">Ends</label><input required type="time" className="field" value={shift.endTime} onChange={(e) => setDraft({ ...draft, shifts: draft.shifts.map((item) => item.id === shift.id ? { ...item, endTime: e.target.value } : item) })} /></div></div></div>)}</div></section>
      <section className="card-surface p-5"><SectionHeading eyebrow="Presence controls" title="Geofence and tracking" /><div className="grid gap-4 md:grid-cols-3"><div><label className="field-label">Geofence radius (metres)</label><input required min="1" max="10000" type="number" className="field" value={draft.geofenceRadiusMeters} onChange={(e) => setDraftField('geofenceRadiusMeters', Number(e.target.value))} data-testid="input-policy-geofence-radius" /></div><label className="flex items-center gap-3 pt-5 text-xs font-bold"><input type="checkbox" checked={draft.geofenceRequireInside} onChange={(e) => setDraftField('geofenceRequireInside', e.target.checked)} /> Require presence inside geofence to punch</label></div><div className="mt-5 border-t border-[hsl(var(--border))] pt-5"><div className="mb-4 flex items-center justify-between"><div><div className="field-label !mb-1">Location heartbeat</div><div className="text-xs text-[hsl(var(--muted-foreground))]">Field officers report only within this operating window.</div></div><label className="flex items-center gap-3 text-xs font-bold"><input type="checkbox" checked={draft.tracking.enabled} onChange={(e) => setDraft({ ...draft, tracking: { ...draft.tracking, enabled: e.target.checked } })} /> Enabled</label></div><div className="grid gap-4 md:grid-cols-4"><div><label className="field-label">Window opens</label><input required type="time" className="field" value={draft.tracking.startTime} onChange={(e) => setDraft({ ...draft, tracking: { ...draft.tracking, startTime: e.target.value } })} /></div><div><label className="field-label">Window closes</label><input required type="time" className="field" value={draft.tracking.endTime} onChange={(e) => setDraft({ ...draft, tracking: { ...draft.tracking, endTime: e.target.value } })} /></div><div><label className="field-label">Heartbeat (minutes)</label><input required min="1" type="number" className="field" value={draft.tracking.heartbeatMinutes} onChange={(e) => setDraft({ ...draft, tracking: { ...draft.tracking, heartbeatMinutes: Number(e.target.value) } })} /></div><div><label className="field-label">Offline after (minutes)</label><input required min="1" type="number" className="field" value={draft.tracking.offlineAfterMinutes} onChange={(e) => setDraft({ ...draft, tracking: { ...draft.tracking, offlineAfterMinutes: Number(e.target.value) } })} /></div></div></div></section>
      <section className="card-surface p-5"><SectionHeading eyebrow="Shift control" title="Checklist contents" action={<button type="button" className="btn btn-secondary !min-h-8" onClick={() => setDraft({ ...draft, checklist: [...draft.checklist, { id: `custom-${draft.checklist.length + 1}`, label: 'New checklist item', category: 'Readiness', required: true }] })}><Plus size={13} /> Add item</button>} /><div className="space-y-3">{draft.checklist.map((item: ChecklistRule) => <div className="grid gap-3 rounded-lg border border-[hsl(var(--border))] p-3 md:grid-cols-[1.2fr_.7fr_.6fr_auto] md:items-end" key={item.id}><div><label className="field-label">Checklist item</label><input required className="field" value={item.label} onChange={(e) => setDraft({ ...draft, checklist: draft.checklist.map((entry) => entry.id === item.id ? { ...entry, label: e.target.value } : entry) })} /></div><div><label className="field-label">Category</label><input required className="field" value={item.category} onChange={(e) => setDraft({ ...draft, checklist: draft.checklist.map((entry) => entry.id === item.id ? { ...entry, category: e.target.value } : entry) })} /></div><label className="flex items-center gap-2 pb-2 text-xs font-bold"><input type="checkbox" checked={item.required} onChange={(e) => setDraft({ ...draft, checklist: draft.checklist.map((entry) => entry.id === item.id ? { ...entry, required: e.target.checked } : entry) })} /> Required</label><button type="button" className="btn btn-quiet !min-h-9 !px-3" onClick={() => setDraft({ ...draft, checklist: draft.checklist.filter((entry) => entry.id !== item.id) })} aria-label={`Remove ${item.label}`}><X size={14} /></button></div>)}</div></section>
      <section className="card-surface p-5"><SectionHeading eyebrow="Escalation" title="SOS acknowledgement" /><div className="grid gap-4 md:grid-cols-[.35fr_1fr]"><div><label className="field-label">Acknowledge within (minutes)</label><input required min="1" max="120" type="number" className="field" value={draft.sosAcknowledgementMinutes} onChange={(e) => setDraftField('sosAcknowledgementMinutes', Number(e.target.value))} /></div><div><label className="field-label">Escalation instruction</label><textarea required className="field min-h-20" value={draft.sosEscalationMessage} onChange={(e) => setDraftField('sosEscalationMessage', e.target.value)} /></div></div></section>
      <section className="card-surface p-5"><SectionHeading eyebrow="Decision routing" title="Approval hierarchy" /><div className="grid gap-4 md:grid-cols-2">{approvalFields.map(({ key, label }) => <div key={key}><label className="field-label">{label} <span className="font-normal">(comma-separated roles)</span></label><input required className="field" value={draft.approvals[key].join(', ')} onChange={(e) => setDraft({ ...draft, approvals: { ...draft.approvals, [key]: e.target.value.split(',').map((role) => role.trim()).filter(Boolean) } })} data-testid={`input-policy-approval-${key}`} /></div>)}</div></section>
      <section className="card-surface p-5"><SectionHeading eyebrow="Employee requests" title="Bill and advance rules" /><div className="grid gap-5 md:grid-cols-2"><div className="rounded-lg border border-[hsl(var(--border))] p-4"><label className="flex items-center gap-3 text-xs font-bold"><input type="checkbox" checked={draft.requests.salaryAdvanceEnabled} onChange={(e) => setDraft({ ...draft, requests: { ...draft.requests, salaryAdvanceEnabled: e.target.checked } })} /> Allow salary advances</label><div className="mt-4"><label className="field-label">Maximum advance (₹)</label><input required min="1" type="number" className="field" value={draft.requests.salaryAdvanceMaxAmount} onChange={(e) => setDraft({ ...draft, requests: { ...draft.requests, salaryAdvanceMaxAmount: Number(e.target.value) } })} /></div></div><div className="rounded-lg border border-[hsl(var(--border))] p-4"><label className="flex items-center gap-3 text-xs font-bold"><input type="checkbox" checked={draft.requests.billSubmissionEnabled} onChange={(e) => setDraft({ ...draft, requests: { ...draft.requests, billSubmissionEnabled: e.target.checked } })} /> Allow bill submissions</label><div className="mt-4"><label className="field-label">Maximum bill (₹)</label><input required min="1" type="number" className="field" value={draft.requests.billMaxAmount} onChange={(e) => setDraft({ ...draft, requests: { ...draft.requests, billMaxAmount: Number(e.target.value) } })} /></div><label className="mt-4 flex items-center gap-3 text-xs font-bold"><input type="checkbox" checked={draft.requests.billReceiptRequired} onChange={(e) => setDraft({ ...draft, requests: { ...draft.requests, billReceiptRequired: e.target.checked } })} /> Require receipt reference</label></div></div></section>
         <div className="flex flex-col items-end gap-2"><p className="w-full text-right text-[10px] text-[hsl(var(--muted-foreground))]">Policy version {conflict?.currentPolicy.version ?? policy.data?.version} {conflict ? '· Resolve the comparison above before retrying.' : '· Changes apply immediately after save.'}</p><button className="btn btn-primary" type="submit" disabled={update.isPending || Boolean(conflict)} data-testid="button-save-policy"><Check size={14} />{conflict ? 'Resolve conflict above' : update.isPending ? 'Saving policy…' : 'Save operating policy'}</button></div>
    </form>
    <section className="card-surface mt-6 overflow-hidden" data-testid="policy-revision-history">
      <div className="border-b border-[hsl(var(--border))] p-5"><SectionHeading eyebrow="Accountability log" title="Policy revision history" /><p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">A durable record of the sections changed, who changed them, and when. Browse older pages for long-running audits and handovers.</p></div>
       {revisions.isLoading ? <div className="p-5"><LoadingState rows={3} /></div> : revisions.isError ? <div className="flex items-center justify-between gap-3 p-5 text-xs text-[hsl(var(--muted-foreground))]"><span>Revision history could not be loaded.</span><button className="btn btn-quiet !min-h-8 !px-3" onClick={() => revisions.refetch()}><RefreshCw size={13} /> Retry</button></div> : visibleRevisions.length === 0 ? <div className="p-5"><EmptyState icon={ActivityIcon} title={revisionOffset > 0 ? "No older revisions on this page" : "No revisions recorded yet"} detail={revisionOffset > 0 ? "Return to a newer page to continue reviewing the history." : "The next policy change will appear here with its actor and timestamp."} /></div> : <><div className="divide-y divide-[hsl(var(--border))]">{visibleRevisions.map((revision: OperatingPolicyRevision) => {
         const expanded = Boolean(expandedRevisions[revision.id]);
         const hasSnapshots = Object.keys(revision.before ?? {}).length > 0 || Object.keys(revision.after ?? {}).length > 0;
         return <div className="p-5" key={revision.id} data-testid={`policy-revision-${revision.id}`}>
           <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
             <div><div className="flex flex-wrap gap-2">{revision.changedSections.map((section) => <span className="status-pill status-neutral" key={section}>{policySectionLabels[section] ?? section}</span>)}</div><p className="mt-3 text-xs leading-5 text-[hsl(var(--foreground))]">{revision.reason || 'No reason provided.'}</p></div>
             <div className="flex shrink-0 items-start gap-2 text-left sm:text-right"><div><div className="text-xs font-bold">{display(revision.actor)}</div><div className="mono mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">{fmtDateTime(revision.createdAt)}</div></div><div className="flex gap-2 sm:order-first"><button type="button" className="btn btn-quiet !min-h-8 !px-2.5" onClick={() => exportRevision(revision)} disabled={exportingRevisionId === revision.id} title="Export comparison" data-testid={`button-export-revision-${revision.id}`}><FileText size={14} /><span className="hidden sm:inline">{exportingRevisionId === revision.id ? 'Exporting…' : 'Export'}</span></button><button type="button" className="btn btn-quiet !min-h-8 !px-2.5" onClick={() => setExpandedRevisions((current) => ({ ...current, [revision.id]: !expanded }))} aria-expanded={expanded} aria-controls={`policy-revision-values-${revision.id}`} data-testid={`button-toggle-revision-${revision.id}`}><span className="hidden sm:inline">{expanded ? 'Hide values' : 'Compare values'}</span>{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button></div></div>
           </div>
           {expanded && <div id={`policy-revision-values-${revision.id}`} className="mt-5 border-t border-[hsl(var(--border))] pt-4" data-testid={`policy-revision-values-${revision.id}`}>
             {!hasSnapshots ? <p className="text-xs text-[hsl(var(--muted-foreground))]">Before-and-after values were not recorded for this older revision.</p> : <div className="space-y-4">
               <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><ArrowUpRight size={13} className="rotate-90 text-[hsl(var(--primary))]" /> Each value is shown as it was before and after this revision.</div>
               {revision.changedSections.map((section) => <section key={section}>
                 <h3 className="mb-2 text-xs font-bold">{policySectionLabels[section] ?? section}</h3>
                 <div className="grid gap-3 md:grid-cols-2"><RevisionValueColumn section={section} value={revision.before?.[section]} label="Previous value" /><RevisionValueColumn section={section} value={revision.after?.[section]} label="New value" /></div>
               </section>)}
             </div>}
           </div>}
         </div>;
        })}</div><div className="flex flex-col gap-3 border-t border-[hsl(var(--border))] p-4 sm:flex-row sm:items-center sm:justify-between"><span className="mono text-[10px] text-[hsl(var(--muted-foreground))]" data-testid="policy-revision-page">Showing revisions {revisionOffset + 1}–{revisionOffset + visibleRevisions.length}</span><div className="flex gap-2"><button type="button" className="btn btn-quiet !min-h-8 !px-3" onClick={() => setRevisionOffset(Math.max(0, revisionOffset - revisionPageSize))} disabled={revisionOffset === 0 || revisions.isFetching} data-testid="button-newer-revisions"><ChevronUp size={13} className="-rotate-90" /> Newer</button><button type="button" className="btn btn-quiet !min-h-8 !px-3" onClick={() => setRevisionOffset(revisionOffset + revisionPageSize)} disabled={!hasOlderRevisions || revisions.isFetching} data-testid="button-older-revisions">Older <ChevronDown size={13} className="-rotate-90" /></button></div></div></>}
    </section>
  </div>;
}

function AccessManagement() {
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<WorkforceUser | null>(null);
  const [draft, setDraft] = useState<WorkforceUserAssignment | null>(null);
  const users = useGetAdminWorkforceUsers(
    submittedSearch ? { search: submittedSearch } : undefined,
    { query: { queryKey: getGetAdminWorkforceUsersQueryKey(submittedSearch ? { search: submittedSearch } : undefined) } },
  );
  const fieldOfficers = useGetAdminFieldOfficers();
  const update = useUpdateAdminWorkforceUserAssignment();
  const { toast } = useToast();

  const chooseUser = (user: WorkforceUser) => {
    setSelectedUser(user);
    setDraft({
      role: user.role,
      siteName: user.siteName,
      fieldOfficerId: user.fieldOfficerId,
    });
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedUser || !draft) return;
    if (draft.role === 'Field Officer' && !draft.fieldOfficerId) {
      toast({ title: 'Choose a field officer record', description: 'Field Officer access must be tied to one specific officer.', variant: 'destructive' });
      return;
    }
    update.mutate({ userId: selectedUser.userId, data: draft }, {
      onSuccess: (updated) => {
        setSelectedUser(updated);
        setDraft({ role: updated.role, siteName: updated.siteName, fieldOfficerId: updated.fieldOfficerId });
        queryClient.invalidateQueries({ queryKey: getGetAdminWorkforceUsersQueryKey() });
        toast({ title: 'Workforce access saved', description: 'The new role and site apply on the user’s next session.' });
      },
      onError: () => toast({ title: 'Access could not be saved', description: 'Confirm the site and Field Officer selection, then try again.', variant: 'destructive' }),
    });
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmittedSearch(search.trim());
    setSelectedUser(null);
    setDraft(null);
  };

  return <div className="page-wrap">
    <div className="mb-8">
      <div className="eyebrow mb-3">Management / identity controls</div>
      <h1 className="page-title">Access management</h1>
      <p className="mt-3 max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">Find a signed-in workforce account and assign the role and site it should receive. The browser never grants its own access.</p>
    </div>
    <div className="mb-6 rounded-lg border border-[hsl(var(--primary)_/_0.22)] bg-[hsl(var(--primary)_/_0.06)] p-4 text-xs">
      <div className="flex gap-3"><Shield className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" size={16} /><div><div className="font-bold">Least privilege by default</div><div className="mt-1 text-[hsl(var(--muted-foreground))]">Accounts without an assignment remain Guards. Access changes are stored in Clerk and take effect when the user starts their next session.</div></div></div>
    </div>
    <div className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]">
      <section className="card-surface overflow-hidden">
        <div className="border-b border-[hsl(var(--border))] p-5">
          <SectionHeading eyebrow="Clerk directory" title="Find a workforce account" action={<span className="mono text-[10px] text-[hsl(var(--muted-foreground))]">{users.data?.length ?? 0} shown</span>} />
          <form className="flex gap-2" onSubmit={submitSearch} data-testid="form-search-workforce-users">
            <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" size={15} /><input className="field !pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, email, or Clerk user ID" aria-label="Search workforce accounts" data-testid="input-search-workforce-users" /></div>
            <button className="btn btn-primary" type="submit" disabled={users.isFetching} data-testid="button-search-workforce-users"><Search size={14} />{users.isFetching ? 'Searching…' : 'Search'}</button>
          </form>
        </div>
        {users.isLoading ? <div className="p-5"><LoadingState rows={4} /></div> : users.isError ? <div className="p-5"><ErrorState onRetry={() => users.refetch()} /></div> : (users.data ?? []).length === 0 ? <div className="p-5"><EmptyState icon={Users} title="No accounts found" detail={submittedSearch ? 'Try a different name, email, or user ID.' : 'Clerk accounts will appear here when they are available.'} /></div> : <div className="divide-y divide-[hsl(var(--border))]">{(users.data ?? []).map((user) => <button className={cx('flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-[hsl(var(--muted))]', selectedUser?.userId === user.userId && 'bg-[hsl(var(--primary)_/_0.06)]')} key={user.userId} onClick={() => chooseUser(user)} data-testid={`workforce-user-${user.userId}`}><div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[hsl(var(--secondary))] text-[10px] font-bold text-[hsl(var(--primary))]">{initials(user.displayName)}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><span className="truncate text-xs font-bold">{user.displayName}</span><StatusPill value={user.role} /></div><div className="mt-1 truncate text-[10px] text-[hsl(var(--muted-foreground))]">{display(user.email, 'No email address')}</div><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[hsl(var(--muted-foreground))]"><span><MapPin className="mr-1 inline-block" size={11} />{user.siteName}</span>{user.fieldOfficerId && <span>Officer record · {user.fieldOfficerId}</span>}</div></div></button>)}</div>}
      </section>
      <section className="card-surface p-5">
        {!selectedUser || !draft ? <EmptyState icon={UserCog} title="Select an account" detail="Choose a Clerk user from the directory to review or change their workforce assignment." /> : <form className="space-y-5" onSubmit={save} data-testid="form-workforce-assignment">
          <div><div className="eyebrow mb-2">Selected account</div><h2 className="section-title">{selectedUser.displayName}</h2><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{display(selectedUser.email, 'No email address')} · <span className="mono">{selectedUser.userId}</span></div></div>
          <div className="rounded-lg bg-[hsl(var(--muted))] p-3 text-[10px] text-[hsl(var(--muted-foreground))]">Saving replaces only the workforce assignment fields. Other Clerk public metadata is preserved.</div>
          <div><label className="field-label">Workforce role</label><select className="field" value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as WorkforceUserAssignment['role'], fieldOfficerId: event.target.value === 'Field Officer' ? draft.fieldOfficerId : null })} data-testid="select-workforce-role">{allRoles.map((role) => <option key={role} value={role}>{role}</option>)}</select></div>
          <div><label className="field-label">Assigned site</label><input required className="field" value={draft.siteName} onChange={(event) => setDraft({ ...draft, siteName: event.target.value })} placeholder="For example: Northgate Business Park" data-testid="input-workforce-site" /></div>
          <div><label className="field-label">Field Officer record <span className="font-normal">({draft.role === 'Field Officer' ? 'required' : 'only for Field Officer access'})</span></label><select className="field" disabled={draft.role !== 'Field Officer' || fieldOfficers.isLoading} value={draft.fieldOfficerId ?? ''} onChange={(event) => setDraft({ ...draft, fieldOfficerId: event.target.value || null })} data-testid="select-field-officer"><option value="">Select an officer record</option>{(fieldOfficers.data ?? []).map((officer) => <option key={officer.id} value={officer.id}>{officer.name} · {officer.city} · {officer.id}</option>)}</select></div>
          <div className="flex items-center justify-between gap-3 border-t border-[hsl(var(--border))] pt-5"><div className="text-[10px] text-[hsl(var(--muted-foreground))]"><div>Current: {selectedUser.role} · {selectedUser.siteName}</div><div className="mt-1">{selectedUser.assignmentUpdatedAt ? `Last changed ${fmtDateTime(selectedUser.assignmentUpdatedAt)}` : 'No previous assignment change recorded'}</div></div><button className="btn btn-primary" type="submit" disabled={update.isPending} data-testid="button-save-workforce-assignment"><Check size={14} />{update.isPending ? 'Saving…' : 'Save access'}</button></div>
        </form>}
      </section>
    </div>
  </div>;
}

function Landing() {
  return <div className="grid min-h-[100dvh] place-items-center bg-[hsl(var(--background))] p-6"><div className="w-full max-w-5xl"><div className="card-surface overflow-hidden"><div className="grid gap-10 p-8 md:grid-cols-[1.1fr_.9fr] md:p-14"><div><div className="mb-8 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg bg-[hsl(var(--primary))] text-white"><Shield size={20} /></div><div><div className="font-['Space_Grotesk'] text-lg font-bold">BLACKBELT</div><div className="mono text-[9px] tracking-[.14em] text-[hsl(var(--muted-foreground))]">COMMANDOS</div></div></div><div className="eyebrow mb-4">Secure workforce operations</div><h1 className="page-title max-w-xl">The field stays ready. The control room stays clear.</h1><p className="mt-5 max-w-lg text-sm leading-6 text-[hsl(var(--muted-foreground))]">A protected command center for attendance, site readiness, incident response, employee verification, and field operations.</p><div className="mt-8 flex flex-wrap gap-3"><Link href="/sign-in" className="btn btn-primary"><LogIn size={15} /> Sign in to workspace</Link><Link href="/sign-up" className="btn btn-secondary">Create an account</Link></div></div><div className="rounded-xl bg-[hsl(var(--sidebar))] p-6 text-[hsl(var(--sidebar-foreground))]"><div className="eyebrow !text-[hsl(var(--accent))]">Built for accountable access</div><div className="mt-6 space-y-5 text-sm"><div className="flex gap-3"><Shield className="shrink-0 text-[hsl(var(--accent))]" size={18} /><span>Role and site assignments decide which records and actions are available.</span></div><div className="flex gap-3"><LocateFixed className="shrink-0 text-[hsl(var(--accent))]" size={18} /><span>Field locations are visible only to authorized roles during active duty windows.</span></div><div className="flex gap-3"><UserCheck className="shrink-0 text-[hsl(var(--accent))]" size={18} /><span>Employee details stay behind workforce permissions and managed sign-in.</span></div></div></div></div></div><div className="mt-5 text-center text-xs text-[hsl(var(--muted-foreground))]">Access is managed by your organization. Sign in to continue to your assigned workspace.</div></div></div>;
}

function HomeRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <AuthLoading />;
  return isSignedIn ? <Redirect to="/dashboard" /> : <Landing />;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const previousUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (previousUserId.current !== undefined && previousUserId.current !== userId) queryClient.clear();
      previousUserId.current = userId;
    });
    return unsubscribe;
  }, [addListener]);
  return null;
}

function ProtectedRoutes() {
  const { isLoaded, isSignedIn } = useAuth();
  const access = useGetWorkforceSession({
    query: {
      queryKey: getGetWorkforceSessionQueryKey(),
      enabled: isLoaded && Boolean(isSignedIn),
      staleTime: 60_000,
    },
  });

  if (!isLoaded) return <AuthLoading />;
  if (!isSignedIn) return <Redirect to="/" />;
  if (access.isLoading) return <AuthLoading label="Loading your assigned access…" />;
  if (access.isError || !access.data) return <AuthLoading label="Your workforce access could not be loaded." />;

  return <AccessContext.Provider value={access.data}><Router /></AccessContext.Provider>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Shell><Switch><Route path="/dashboard"><RoleRoute path="/dashboard"><Dashboard /></RoleRoute></Route><Route path="/operations"><RoleRoute path="/operations"><WorkforceWorkbenchPage /></RoleRoute></Route><Route path="/attendance"><RoleRoute path="/attendance"><Attendance /></RoleRoute></Route><Route path="/team"><RoleRoute path="/team"><Team /></RoleRoute></Route><Route path="/tracking"><RoleRoute path="/tracking"><Tracking /></RoleRoute></Route><Route path="/verification"><RoleRoute path="/verification"><Verification /></RoleRoute></Route><Route path="/requests"><RoleRoute path="/requests"><Requests /></RoleRoute></Route><Route path="/payslips"><RoleRoute path="/payslips"><Payslips /></RoleRoute></Route><Route path="/client-portal"><RoleRoute path="/client-portal"><WorkforceWorkbenchPage readOnly /></RoleRoute></Route><Route path="/policies"><RoleRoute path="/policies"><PolicySettings /></RoleRoute></Route><Route path="/access"><RoleRoute path="/access"><AccessManagement /></RoleRoute></Route><Route component={NotFound} /></Switch></Shell></ErrorBoundary>;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: 'hsl(174 62% 32%)',
    colorForeground: 'hsl(205 31% 17%)',
    colorMutedForeground: 'hsl(205 13% 46%)',
    colorDanger: 'hsl(4 67% 49%)',
    colorBackground: 'hsl(44 40% 99%)',
    colorInput: 'hsl(44 40% 99%)',
    colorInputForeground: 'hsl(205 31% 17%)',
    colorNeutral: 'hsl(39 20% 84%)',
    fontFamily: 'Manrope, sans-serif',
    borderRadius: '0.75rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#fffdfa] rounded-2xl w-[440px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#1e3038]',
    headerSubtitle: 'text-[#6b7778]',
    socialButtonsBlockButtonText: 'text-[#1e3038]',
    formFieldLabel: 'text-[#1e3038]',
    footerActionLink: 'text-[#0f766e]',
    footerActionText: 'text-[#6b7778]',
    dividerText: 'text-[#6b7778]',
    alertText: 'text-[#9b3028]',
    formButtonPrimary: 'bg-[#0f766e] hover:bg-[#0b5f59]',
    formFieldInput: 'border-[#d8d1c4] text-[#1e3038]',
    socialButtonsBlockButton: 'border-[#d8d1c4]',
    logoBox: 'h-10',
    logoImage: 'h-10',
  },
};

function SignInPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] px-4"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>;
}

function SignUpPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] px-4"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>;
}

function ClerkApp() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to access your assigned workspace' } }, signUp: { start: { title: 'Create your workforce account', subtitle: 'Request access to your assigned workspace' } } }} routerPush={(to) => setLocation(to.startsWith(basePath) ? to.slice(basePath.length) || '/' : to)} routerReplace={(to) => setLocation(to.startsWith(basePath) ? to.slice(basePath.length) || '/' : to, { replace: true })}><QueryClientProvider client={queryClient}><TooltipProvider><ClerkQueryClientCacheInvalidator /><Switch><Route path="/" component={HomeRedirect} /><Route path="/sign-in/*?" component={SignInPage} /><Route path="/sign-up/*?" component={SignUpPage} /><Route component={ProtectedRoutes} /></Switch><Toaster /></TooltipProvider></QueryClientProvider></ClerkProvider>;
}

function App() {
  return <WouterRouter base={basePath}><ClerkApp /></WouterRouter>;
}
export default App;