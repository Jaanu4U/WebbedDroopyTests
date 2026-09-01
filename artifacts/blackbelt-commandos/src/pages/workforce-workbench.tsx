import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  Filter,
  Flag,
  LocateFixed,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Siren,
  Users,
  Building,
  Calendar,
  Lock,
  Camera as CameraIcon,
  Navigation,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetWorkforceWorkbench,
  getGetWorkforceWorkbenchQueryKey,
  useCreateWorkforceItem,
  useUpdateWorkforceItem,
  useTransitionWorkforceItem,
  useGetIncidents,
  useCreateIncident,
  useTransitionIncident,
  useGetPatrolCheckpoints,
  useGetPatrolSummary,
  useRecordPatrolScan,
  useGetTodayRoster,
  getGetTodayRosterQueryKey,
  useTransitionRosterAssignment,
  useGetComplianceRecords,
  useGetTodayOperationalReport,
  WorkforceItem,
  AuditEvent,
} from '@workspace/api-client-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';

const KINDS = [
  { kind: 'roster', group: 'Workforce Planning', label: 'Roster' },
  { kind: 'coverage', group: 'Workforce Planning', label: 'Coverage' },
  { kind: 'replacement', group: 'Workforce Planning', label: 'Replacement' },
  { kind: 'roster_exception', group: 'Workforce Planning', label: 'Roster Exception' },
  { kind: 'credential', group: 'Compliance', label: 'Credential' },
  { kind: 'eligibility', group: 'Compliance', label: 'Eligibility' },
  { kind: 'attendance_exception', group: 'Attendance/Tasks', label: 'Attendance Exception' },
  { kind: 'attendance_correction', group: 'Attendance/Tasks', label: 'Attendance Correction' },
  { kind: 'late_alert', group: 'Attendance/Tasks', label: 'Late Alert' },
  { kind: 'task', group: 'Attendance/Tasks', label: 'Task' },
  { kind: 'handover', group: 'Attendance/Tasks', label: 'Handover' },
  { kind: 'incident', group: 'Incident Command', label: 'Incident' },
  { kind: 'sos', group: 'Incident Command', label: 'SOS Alert' },
  { kind: 'event', group: 'Incident Command', label: 'Event' },
  { kind: 'dispatch', group: 'Incident Command', label: 'Dispatch' },
  { kind: 'communication', group: 'Incident Command', label: 'Communication' },
  { kind: 'leave', group: 'Finance', label: 'Leave' },
  { kind: 'bill', group: 'Finance', label: 'Bill' },
  { kind: 'payroll_reconciliation', group: 'Finance', label: 'Payroll Reconciliation' },
  { kind: 'payslip_governance', group: 'Finance', label: 'Payslip Governance' },
  { kind: 'daily_report', group: 'Reporting/Governance', label: 'Daily Report' },
  { kind: 'dashboard', group: 'Reporting/Governance', label: 'Dashboard' },
  { kind: 'scheduled_report', group: 'Reporting/Governance', label: 'Scheduled Report' },
  { kind: 'client_portal', group: 'Client Portal', label: 'Client Portal Config' },
];

const SAFE_CLIENT_KINDS = ['client_portal', 'dashboard', 'daily_report', 'coverage', 'incident'];

function getStatusClass(status: string) {
  const s = status.toLowerCase();
  if (['published', 'resolved', 'active', 'completed', 'approved'].includes(s)) return 'status-ok';
  if (['pending', 'draft', 'in_progress', 'review'].includes(s)) return 'status-warn';
  if (['failed', 'rejected', 'cancelled', 'open', 'overdue'].includes(s)) return 'status-danger';
  return 'status-neutral';
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function CreateItemDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createItem = useCreateWorkforceItem();

  const schema = z.object({
    kind: z.string().min(1, 'Kind is required'),
    title: z.string().min(1, 'Title is required'),
    priority: z.string().optional(),
    site: z.string().optional(),
    description: z.string().optional(),
    dueAt: z.string().optional(),
    details: z.string().optional(),
    evidence: z.string().optional(),
  });

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      kind: 'task',
      title: '',
      priority: 'medium',
      site: '',
      description: '',
      dueAt: '',
      details: '',
      evidence: '',
    },
  });

  const onSubmit = (data: z.infer<typeof schema>) => {
    const structuredData = Object.fromEntries(
      (data.details ?? '')
        .split('\n')
        .map((line) => line.split('=').map((part) => part.trim()))
        .filter(([key, value]) => Boolean(key && value))
        .map(([key, value]) => [key, value]),
    );
    if (data.evidence?.trim()) structuredData.evidenceRef = data.evidence.trim();
    createItem.mutate(
      {
        data: {
          kind: data.kind,
          title: data.title,
          priority: data.priority,
          site: data.site,
          description: data.description,
          status: 'Open',
          dueAt: data.dueAt ? new Date(data.dueAt).toISOString() : null,
          data: structuredData,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetWorkforceWorkbenchQueryKey() });
          toast({ title: 'Item created successfully' });
          onOpenChange(false);
          form.reset();
        },
        onError: () => {
          toast({ title: 'Failed to create item', variant: 'destructive' });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Operation Item</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="kind"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {KINDS.map((k) => (
                          <SelectItem key={k.kind} value={k.kind}>
                            {k.label} ({k.group})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select priority" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="E.g., Night shift roster exception" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="site"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Site (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="E.g., North Facility" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dueAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Due Date (Optional)</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description & Details</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Provide detailed context or structured evidence..." className="min-h-[100px]" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="details"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Structured details (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={'One field per line, for example:\npost=Gate A\nemployee=Rakesh Patel\napprovalPath=Supervisor > Management'}
                      className="min-h-[90px] font-mono text-xs"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="evidence"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Evidence reference (Optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="Live image, document, dispatch or ticket reference" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={createItem.isPending} className="btn-primary">
                {createItem.isPending ? 'Creating...' : 'Create Item'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ItemCard({ item, readOnly }: { item: WorkforceItem; readOnly: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const transition = useTransitionWorkforceItem();

  const handleTransition = (newStatus: string) => {
    transition.mutate(
      { id: item.id, data: { status: newStatus } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetWorkforceWorkbenchQueryKey() });
          toast({ title: `Marked as ${newStatus}` });
        },
        onError: () => toast({ title: 'Update failed', variant: 'destructive' }),
      }
    );
  };

  const kindDef = KINDS.find((k) => k.kind === item.kind) || { label: item.kind, group: 'Unknown' };

  return (
    <div className="card-surface p-4 flex flex-col gap-3 group relative overflow-hidden transition-all hover:border-[hsl(var(--primary))]">
      <div className="flex justify-between items-start">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className={`status-pill ${getStatusClass(item.status)}`}>
              {item.status.replace('_', ' ').toUpperCase()}
            </span>
            <span className="text-xs font-bold text-[hsl(var(--muted-foreground))]">
              {kindDef.label}
            </span>
          </div>
          <h3 className="font-semibold text-[15px] leading-tight mt-1">{item.title}</h3>
        </div>
        {item.priority === 'critical' && <AlertTriangle className="text-red-500 h-5 w-5 shrink-0" />}
        {item.priority === 'high' && <Flag className="text-orange-500 h-4 w-4 shrink-0" />}
      </div>

      {item.description && (
        <p className="text-xs text-[hsl(var(--muted-foreground))] line-clamp-2 leading-relaxed mt-1">
          {item.description}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-[hsl(var(--muted-foreground))] font-medium mt-auto pt-3 border-t border-[hsl(var(--border))]">
        {item.site && (
          <div className="flex items-center gap-1">
            <Building className="h-3 w-3" /> {item.site}
          </div>
        )}
        <div className="flex items-center gap-1">
          <Clock className="h-3 w-3" /> {formatDate(item.createdAt)}
        </div>
        {item.dueAt && (
          <div className="flex items-center gap-1 text-[hsl(var(--primary))]">
            <Calendar className="h-3 w-3" /> Due {formatDate(item.dueAt)}
          </div>
        )}
      </div>

      {!readOnly && (
        <div className="absolute right-4 bottom-4 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2 bg-[hsl(var(--card))] pl-2 shadow-[-10px_0_10px_hsl(var(--card))]">
          {item.status !== 'resolved' && item.status !== 'closed' && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs bg-[hsl(var(--secondary))]"
              onClick={() => handleTransition('resolved')}
              disabled={transition.isPending}
            >
              Resolve
            </Button>
          )}
          {item.status !== 'published' && item.kind === 'incident' && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs bg-[hsl(var(--primary))] text-white hover:bg-[hsl(var(--primary))] hover:text-white"
              onClick={() => handleTransition('published')}
              disabled={transition.isPending}
            >
              Publish
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function LiveControls({ readOnly }: { readOnly: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const incidents = useGetIncidents();
  const createIncident = useCreateIncident();
  const transitionIncident = useTransitionIncident();
  const checkpoints = useGetPatrolCheckpoints();
  const patrolSummary = useGetPatrolSummary();
  const recordScan = useRecordPatrolScan();
  const roster = useGetTodayRoster();
  const transitionRoster = useTransitionRosterAssignment();
  const compliance = useGetComplianceRecords();
  const report = useGetTodayOperationalReport();
  const [scanToken, setScanToken] = useState('');
  const [roundId, setRoundId] = useState(`round-${new Date().toISOString().slice(0, 10)}`);
  const [incident, setIncident] = useState({ category: 'Safety', severity: 'Medium', title: '', narrative: '' });
  const [evidencePath, setEvidencePath] = useState('');

  const uploadEvidence = async (file: File) => {
    const response = await fetch('/api/storage/uploads/request-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || 'image/jpeg' }),
    });
    if (!response.ok) throw new Error('Could not reserve secure evidence storage');
    const upload = await response.json() as { uploadURL: string; objectPath: string };
    const put = await fetch(upload.uploadURL, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'image/jpeg' } });
    if (!put.ok) throw new Error('Evidence upload failed');
    setEvidencePath(upload.objectPath);
    toast({ title: 'Evidence uploaded', description: 'The secure object reference is ready to attach to an operation.' });
  };

  const submitIncident = (event: React.FormEvent) => {
    event.preventDefault();
    createIncident.mutate({
      data: {
        category: incident.category,
        severity: incident.severity as 'Low' | 'Medium' | 'High' | 'Critical',
        title: incident.title,
        narrative: incident.narrative,
        affectedPeople: [],
        affectedAssets: [],
      },
    }, {
      onSuccess: () => {
        setIncident({ category: 'Safety', severity: 'Medium', title: '', narrative: '' });
        queryClient.invalidateQueries({ queryKey: ['/api/incidents'] });
        toast({ title: 'Incident submitted', description: 'Control Room can now acknowledge, assign, contain and close it.' });
      },
      onError: () => toast({ title: 'Incident submission failed', variant: 'destructive' }),
    });
  };

  const scanCheckpoint = (event: React.FormEvent) => {
    event.preventDefault();
    recordScan.mutate({
      data: {
        checkpointToken: scanToken,
        roundId,
        note: evidencePath ? `Evidence: ${evidencePath}` : undefined,
        evidence: evidencePath ? { objectPath: evidencePath, captureMode: 'camera' } : undefined,
      },
    }, {
      onSuccess: (result) => {
        setScanToken('');
        queryClient.invalidateQueries({ queryKey: ['/api/patrol'] });
        toast({ title: `Checkpoint ${result.status.toLowerCase()}`, description: result.note ?? 'Patrol scan recorded.' });
      },
      onError: () => toast({ title: 'Checkpoint not accepted', description: 'Check the QR token, round sequence and site location.', variant: 'destructive' }),
    });
  };

  return <div className="mb-8 grid gap-4 xl:grid-cols-3">
    {!readOnly && <div className="card-surface p-5 xl:col-span-2">
      <div className="flex items-start justify-between gap-4">
        <div><div className="eyebrow mb-2">Control Room / incident command</div><h2 className="section-title">Structured incident queue</h2></div>
        <span className="status-pill status-warn">{incidents.data?.length ?? 0} live</span>
      </div>
      <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={submitIncident}>
        <input className="field" placeholder="Incident title" required value={incident.title} onChange={(event) => setIncident({ ...incident, title: event.target.value })} />
        <select className="field" value={incident.severity} onChange={(event) => setIncident({ ...incident, severity: event.target.value })}><option>Low</option><option>Medium</option><option>High</option><option>Critical</option></select>
        <select className="field" value={incident.category} onChange={(event) => setIncident({ ...incident, category: event.target.value })}><option>Safety</option><option>Security</option><option>Medical</option><option>Asset</option><option>Attendance</option></select>
        <input className="field" placeholder="Narrative and immediate action" required value={incident.narrative} onChange={(event) => setIncident({ ...incident, narrative: event.target.value })} />
        <button className="btn btn-primary sm:col-span-2" disabled={createIncident.isPending} type="submit"><Siren size={14} />{createIncident.isPending ? 'Submitting…' : 'Submit incident'}</button>
      </form>
      <div className="mt-4 space-y-2">{(incidents.data ?? []).slice(0, 4).map((item) => <div key={item.id} className="rounded-lg border border-[hsl(var(--border))] p-3"><div className="flex items-center justify-between gap-3"><div className="text-xs font-bold">{item.title}</div><span className="status-pill status-danger">{item.severity} · {item.status}</span></div><div className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">{item.category} · {formatDate(item.reportedAt)}</div>{!readOnly && !['Closed'].includes(item.status) && <div className="mt-2 flex flex-wrap gap-2">{item.status === 'Submitted' && <Button size="sm" className="h-7 text-xs" onClick={() => transitionIncident.mutate({ id: item.id, data: { status: 'Acknowledged' } })}>Acknowledge</Button>}{item.status === 'Acknowledged' && <Button size="sm" className="h-7 text-xs" onClick={() => transitionIncident.mutate({ id: item.id, data: { status: 'Assigned' } })}>Assign</Button>}{item.status === 'Assigned' && <Button size="sm" className="h-7 text-xs" onClick={() => transitionIncident.mutate({ id: item.id, data: { status: 'In Progress' } })}>Start work</Button>}<Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => transitionIncident.mutate({ id: item.id, data: { status: 'Closed' } })}>Close</Button></div>}</div>)}</div>
    </div>}
    {!readOnly && <div className="card-surface p-5">
      <div className="eyebrow mb-2">Patrol / QR checkpoints</div><h2 className="section-title">Scan a round</h2>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-[hsl(var(--muted))] p-3"><span className="font-bold">{patrolSummary.data?.completionPercent ?? 0}%</span><span className="ml-1 text-[hsl(var(--muted-foreground))]">verified</span></div><div className="rounded-lg bg-[hsl(var(--muted))] p-3"><span className="font-bold">{checkpoints.data?.length ?? 0}</span><span className="ml-1 text-[hsl(var(--muted-foreground))]">checkpoints</span></div></div>
      <form className="mt-4 space-y-3" onSubmit={scanCheckpoint}><input className="field" placeholder="Scan or enter QR token" required value={scanToken} onChange={(event) => setScanToken(event.target.value)} /><input className="field" placeholder="Round ID" required value={roundId} onChange={(event) => setRoundId(event.target.value)} /><label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-[hsl(var(--border))] p-3 text-[10px] text-[hsl(var(--muted-foreground))]"><CameraIcon />Live evidence (camera required)<input className="sr-only" type="file" accept="image/*" capture="environment" onChange={(event) => event.target.files?.[0] && uploadEvidence(event.target.files[0]).catch(() => toast({ title: 'Evidence upload failed', variant: 'destructive' }))} /></label><button className="btn btn-primary w-full" disabled={recordScan.isPending} type="submit"><Navigation size={14} />{recordScan.isPending ? 'Recording…' : 'Record checkpoint'}</button></form>
    </div>}
    <div className="card-surface p-5 xl:col-span-3">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="eyebrow mb-2">Workforce governance</div><h2 className="section-title">Roster, compliance and reporting state</h2></div><span className="text-[10px] text-[hsl(var(--muted-foreground))]">All values are persisted</span></div>
       <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-lg border border-[hsl(var(--border))] p-3"><div className="field-label">Today’s roster</div><div className="mt-2 text-2xl font-bold">{roster.data?.length ?? 0}</div><div className="text-[10px] text-[hsl(var(--muted-foreground))]">assignments</div>{!readOnly && (roster.data ?? []).length > 0 && <div className="mt-3 space-y-2">{(roster.data ?? []).slice(0, 3).map((assignment) => <div key={assignment.id} className="rounded-md bg-[hsl(var(--muted))] p-2"><div className="text-[10px] font-bold">{assignment.employeeName} · {assignment.post}</div><div className="mt-1 flex items-center justify-between gap-2"><span className="text-[10px] text-[hsl(var(--muted-foreground))]">{assignment.status}</span>{assignment.status === 'Published' && <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={transitionRoster.isPending} onClick={() => transitionRoster.mutate({ id: assignment.id, data: { action: 'acknowledge' } }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetTodayRosterQueryKey() }); toast({ title: 'Roster acknowledged' }); }, onError: () => toast({ title: 'Could not acknowledge roster', variant: 'destructive' }) })}>Acknowledge</Button>}</div></div>)}</div>}</div><div className="rounded-lg border border-[hsl(var(--border))] p-3"><div className="field-label">Compliance records</div><div className="mt-2 text-2xl font-bold">{compliance.data?.length ?? 0}</div><div className="text-[10px] text-[hsl(var(--muted-foreground))]">expiry tracked</div></div><div className="rounded-lg border border-[hsl(var(--border))] p-3"><div className="field-label">Daily report</div><div className="mt-2 text-sm font-bold">{report.data?.status ?? 'Not submitted'}</div><div className="text-[10px] text-[hsl(var(--muted-foreground))]">approval handoff state</div></div></div>
    </div>
  </div>;
}

export function WorkforceWorkbenchPage({ readOnly = false }: { readOnly?: boolean }) {
  const [filterKind, setFilterKind] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [createOpen, setCreateOpen] = useState(false);

  const { data: workbench, isLoading, isError, refetch } = useGetWorkforceWorkbench();

  const filteredItems = useMemo(() => {
    if (!workbench) return [];
    return workbench.items.filter((item) => {
      if (readOnly) {
        if (!SAFE_CLIENT_KINDS.includes(item.kind)) return false;
        if (!['published', 'resolved'].includes(item.status.toLowerCase())) return false;
      }
      if (filterKind !== 'all' && item.kind !== filterKind) return false;
      if (filterStatus !== 'all' && item.status !== filterStatus) return false;
      return true;
    });
  }, [workbench, filterKind, filterStatus, readOnly]);

  const metrics = workbench?.metrics;

  if (isError) {
    return (
      <div className="page-wrap flex flex-col items-center justify-center py-20 text-center">
        <AlertTriangle className="h-10 w-10 text-red-500 mb-4" />
        <h2 className="section-title mb-2">Failed to load Operations</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6">
          Could not retrieve the workforce workbench data.
        </p>
        <Button onClick={() => refetch()} variant="outline">
          <RefreshCw className="mr-2 h-4 w-4" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="page-wrap">
      <div className="reveal mb-8 flex flex-col gap-5 md:flex-row md:items-end justify-between">
        <div>
          <div className="eyebrow mb-3">
            {readOnly ? 'Client View / Site Feed' : 'Unified Operations / 24h Feed'}
          </div>
          <h1 className="page-title">
            {readOnly ? 'Verified Operations Feed' : 'Workforce Workbench'}
          </h1>
          <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))] max-w-xl">
            {readOnly
              ? 'View published incidents, coverage reports, and site governance documentation in real time.'
              : 'Direct operations, manage compliance exceptions, track incidents, and command the workforce from a single unified pane.'}
          </p>
        </div>
        {!readOnly && (
          <Button className="btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> New Operation
          </Button>
        )}
      </div>

      {!readOnly && metrics && (
        <div className="reveal-2 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-8">
          <div className="metric-card">
            <div className="eyebrow !text-[hsl(var(--muted-foreground))]">Open Incidents</div>
            <div className="metric-value mt-3 text-[hsl(var(--destructive))]">{metrics.openIncidents}</div>
          </div>
          <div className="metric-card">
            <div className="eyebrow !text-[hsl(var(--muted-foreground))]">Active SOS</div>
            <div className="metric-value mt-3 text-[hsl(var(--destructive))]">{metrics.activeSos}</div>
          </div>
          <div className="metric-card">
            <div className="eyebrow !text-[hsl(var(--muted-foreground))]">At Risk Posts</div>
            <div className="metric-value mt-3 text-[hsl(var(--primary))]">{metrics.atRiskPosts}</div>
          </div>
          <div className="metric-card">
            <div className="eyebrow !text-[hsl(var(--muted-foreground))]">Pending Approvals</div>
            <div className="metric-value mt-3 text-[hsl(var(--primary))]">{metrics.pendingApprovals}</div>
          </div>
          <div className="metric-card">
            <div className="eyebrow !text-[hsl(var(--muted-foreground))]">Coverage</div>
            <div className="metric-value mt-3">{metrics.coverage}%</div>
          </div>
          <div className="metric-card">
            <div className="eyebrow !text-[hsl(var(--muted-foreground))]">Patrol Compl.</div>
            <div className="metric-value mt-3">{metrics.patrolCompletion}%</div>
          </div>
        </div>
      )}

      <LiveControls readOnly={readOnly} />

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Main Feed Column */}
        <div className="flex-1 space-y-4">
          <div className="flex items-center gap-3 bg-[hsl(var(--card))] p-2 rounded-lg border border-[hsl(var(--border))] sticky top-[74px] z-10 shadow-sm">
            <div className="flex items-center text-[hsl(var(--muted-foreground))] pl-2">
              <Filter className="h-4 w-4 mr-2" />
              <span className="text-xs font-bold uppercase tracking-wider">Filters</span>
            </div>
            <div className="w-px h-5 bg-[hsl(var(--border))] mx-1" />
            <Select value={filterKind} onValueChange={setFilterKind}>
              <SelectTrigger className="w-[180px] h-8 text-xs bg-transparent border-none shadow-none focus:ring-0">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {(readOnly ? KINDS.filter((k) => SAFE_CLIENT_KINDS.includes(k.kind)) : KINDS).map(
                  (k) => (
                    <SelectItem key={k.kind} value={k.kind}>
                      {k.label}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
            <div className="w-px h-5 bg-[hsl(var(--border))] mx-1" />
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[140px] h-8 text-xs bg-transparent border-none shadow-none focus:ring-0">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {isLoading ? (
              <>
                <Skeleton className="h-[120px] w-full rounded-xl bg-[hsl(var(--muted))]" />
                <Skeleton className="h-[120px] w-full rounded-xl bg-[hsl(var(--muted))]" />
                <Skeleton className="h-[120px] w-full rounded-xl bg-[hsl(var(--muted))]" />
              </>
            ) : filteredItems.length === 0 ? (
              <div className="col-span-full py-16 text-center text-[hsl(var(--muted-foreground))]">
                <CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-[hsl(var(--primary))]" />
                <p className="font-semibold text-[hsl(var(--foreground))]">No records found</p>
                <p className="text-sm">Try adjusting your filters.</p>
              </div>
            ) : (
              filteredItems.map((item) => <ItemCard key={item.id} item={item} readOnly={readOnly} />)
            )}
          </div>
        </div>

        {/* Audit Column */}
        {!readOnly && (
          <div className="w-full lg:w-[320px] shrink-0">
            <div className="card-surface p-4 sticky top-[74px]">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-sm flex items-center gap-2">
                  <Activity className="h-4 w-4 text-[hsl(var(--primary))]" /> Operational Log
                </h3>
              </div>
              <div className="space-y-4">
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex gap-3">
                      <Skeleton className="h-8 w-8 rounded-full shrink-0 bg-[hsl(var(--muted))]" />
                      <div className="space-y-2 flex-1">
                        <Skeleton className="h-3 w-full bg-[hsl(var(--muted))]" />
                        <Skeleton className="h-3 w-2/3 bg-[hsl(var(--muted))]" />
                      </div>
                    </div>
                  ))
                ) : !workbench?.audit?.length ? (
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">No recent activity.</p>
                ) : (
                  workbench.audit.slice(0, 15).map((event) => (
                    <div key={event.id} className="flex gap-3 text-sm">
                      <div className="h-7 w-7 rounded-full bg-[hsl(var(--secondary))] text-[hsl(var(--primary))] grid place-items-center shrink-0">
                        {event.action.includes('create') ? (
                          <Plus className="h-3 w-3" />
                        ) : event.action.includes('update') ? (
                          <RefreshCw className="h-3 w-3" />
                        ) : (
                          <Flag className="h-3 w-3" />
                        )}
                      </div>
                      <div>
                        <p className="text-xs leading-relaxed text-[hsl(var(--foreground))]">
                          <span className="font-semibold">{event.actorId}</span> {event.summary}
                        </p>
                        <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1 font-mono">
                          {formatDate(event.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <CreateItemDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
