import { useState, useMemo, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, type Visitor, type Visit, type Officer, type Directorate } from '@/lib/api';
import { cn, getInitials, formatDate } from '@/lib/utils';
import { ID_TYPES } from '@/lib/constants';
import {
  Search,
  UserPlus,
  ChevronLeft,
  Check,
  Building2,
  User,
  Phone,
  Mail,
  Briefcase,
  CreditCard,
  ArrowRight,
  CheckCircle2,
  X,
} from 'lucide-react';

/* ---- Schemas ---- */

const newVisitorSchema = z.object({
  first_name: z.string().min(1, 'First name is required').max(100),
  last_name: z.string().min(1, 'Last name is required').max(100),
  phone: z
    .string()
    .regex(/^(\+233|0)\d{9}$/, 'Invalid Ghana phone (e.g. 0241234567)')
    .or(z.literal(''))
    .optional(),
  email: z.string().email('Invalid email').or(z.literal('')).optional(),
  organisation: z.string().max(200).optional(),
  id_type: z.enum(['ghana_card', 'passport', 'drivers_license', 'staff_id', 'other']).optional(),
  id_number: z.string().max(50).optional(),
});
type NewVisitorForm = z.infer<typeof newVisitorSchema>;

const checkInSchema = z.object({
  directorate_id: z.string().optional(),
  host_officer_id: z.string().optional(),
  purpose_raw: z.string().max(500).optional(),
});
type CheckInForm = z.infer<typeof checkInSchema>;

/* ---- Steps ---- */
type Step = 'search' | 'new-visitor' | 'check-in' | 'success';

export function CheckInPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedVisitor, setSelectedVisitor] = useState<Visitor | null>(null);
  const [createdVisit, setCreatedVisit] = useState<Visit | null>(null);

  /* ---- Data queries ---- */
  const { data: searchResults, isFetching: isSearching } = useQuery({
    queryKey: ['visitors', 'search', searchQuery],
    queryFn: () => api.get<Visitor[]>(`/visitors?q=${encodeURIComponent(searchQuery)}&limit=10`),
    enabled: searchQuery.length >= 2,
    placeholderData: (prev) => prev,
  });

  const { data: directoratesData } = useQuery({
    queryKey: ['directorates'],
    queryFn: () => api.get<Directorate[]>('/directorates'),
    staleTime: 5 * 60_000,
  });

  const { data: officersData } = useQuery({
    queryKey: ['officers'],
    queryFn: () => api.get<Officer[]>('/officers'),
    staleTime: 5 * 60_000,
  });

  const directorates = directoratesData?.data ?? [];
  const allOfficers = officersData?.data ?? [];
  const visitors = searchResults?.data ?? [];

  /* ---- New visitor form ---- */
  const newVisitorForm = useForm<NewVisitorForm>({
    resolver: zodResolver(newVisitorSchema),
    defaultValues: { first_name: '', last_name: '', phone: '', email: '', organisation: '', id_number: '' },
  });

  const createVisitorMutation = useMutation({
    mutationFn: (data: NewVisitorForm) => api.post<Visitor>('/visitors', data),
    onSuccess: (res) => {
      const visitor = res.data;
      if (visitor) {
        setSelectedVisitor(visitor);
        setStep('check-in');
        queryClient.invalidateQueries({ queryKey: ['visitors'] });
      }
    },
  });

  /* ---- Check-in form ---- */
  const checkInForm = useForm<CheckInForm>({
    resolver: zodResolver(checkInSchema),
    defaultValues: { directorate_id: '', host_officer_id: '', purpose_raw: '' },
  });

  const selectedDirectorateId = checkInForm.watch('directorate_id');
  const filteredOfficers = useMemo(
    () =>
      selectedDirectorateId
        ? allOfficers.filter((o) => o.directorate_id === selectedDirectorateId)
        : allOfficers,
    [selectedDirectorateId, allOfficers]
  );

  const checkInMutation = useMutation({
    mutationFn: (data: CheckInForm) =>
      api.post<Visit>('/visits/check-in', {
        visitor_id: selectedVisitor!.id,
        ...data,
      }),
    onSuccess: (res) => {
      setCreatedVisit(res.data ?? null);
      setStep('success');
      queryClient.invalidateQueries({ queryKey: ['visits'] });
    },
  });

  /* ---- Select existing visitor ---- */
  function selectVisitor(visitor: Visitor) {
    setSelectedVisitor(visitor);
    setStep('check-in');
  }

  /* ---- Pre-fill new visitor name from search ---- */
  function goToNewVisitor() {
    const parts = searchQuery.trim().split(/\s+/);
    newVisitorForm.reset({
      first_name: parts[0] ?? '',
      last_name: parts.slice(1).join(' '),
      phone: '',
      email: '',
      organisation: '',
      id_number: '',
    });
    setStep('new-visitor');
  }

  function reset() {
    setStep('search');
    setSearchQuery('');
    setSelectedVisitor(null);
    setCreatedVisit(null);
    newVisitorForm.reset();
    checkInForm.reset();
  }

  /* ---- Render ---- */
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Breadcrumb / step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {step !== 'search' && step !== 'success' && (
          <button
            onClick={() => step === 'new-visitor' ? setStep('search') : setStep('search')}
            className="inline-flex items-center gap-1 text-muted hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
        )}
        <StepIndicator current={step} />
      </div>

      {/* STEP 1: Search visitor */}
      {step === 'search' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Find or Register Visitor</h2>
            <p className="text-sm text-muted mt-0.5">Search by name, phone, or organisation</p>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="e.g. Kwame Asante or 0241234567"
              className="w-full h-11 pl-10 pr-4 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              autoFocus
            />
            {isSearching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="h-4 w-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            )}
          </div>

          {/* Search results */}
          {searchQuery.length >= 2 && (
            <div className="bg-surface rounded-xl border border-border shadow-sm overflow-hidden">
              {visitors.length > 0 ? (
                <div className="divide-y divide-border">
                  {visitors.map((visitor) => (
                    <button
                      key={visitor.id}
                      onClick={() => selectVisitor(visitor)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-background transition-colors"
                    >
                      <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
                        {getInitials(visitor.first_name, visitor.last_name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {visitor.first_name} {visitor.last_name}
                        </p>
                        <p className="text-xs text-muted truncate">
                          {[visitor.organisation, visitor.phone].filter(Boolean).join(' · ') || 'No details'}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-muted">{visitor.total_visits} visits</p>
                        {visitor.last_visit_at && (
                          <p className="text-xs text-muted-foreground">Last: {formatDate(visitor.last_visit_at)}</p>
                        )}
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </button>
                  ))}
                </div>
              ) : (
                !isSearching && (
                  <div className="px-4 py-6 text-center">
                    <p className="text-sm text-muted">No visitors found for "{searchQuery}"</p>
                  </div>
                )
              )}

              {/* New visitor button always visible in results area */}
              <div className="border-t border-border px-4 py-3 bg-background/50">
                <button
                  onClick={goToNewVisitor}
                  className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                >
                  <UserPlus className="h-4 w-4" />
                  Register new visitor{searchQuery.trim() ? `: "${searchQuery.trim()}"` : ''}
                </button>
              </div>
            </div>
          )}

          {searchQuery.length < 2 && (
            <div className="bg-surface rounded-xl border border-border shadow-sm px-4 py-6 text-center">
              <Search className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted">Type at least 2 characters to search</p>
              <button
                onClick={() => setStep('new-visitor')}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary mt-3 hover:underline"
              >
                <UserPlus className="h-4 w-4" />
                Register a new visitor
              </button>
            </div>
          )}
        </div>
      )}

      {/* STEP 2: New visitor registration */}
      {step === 'new-visitor' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Register New Visitor</h2>
            <p className="text-sm text-muted mt-0.5">Enter visitor details to create a record</p>
          </div>

          <form
            onSubmit={newVisitorForm.handleSubmit((data) => createVisitorMutation.mutate(data))}
            className="bg-surface rounded-xl border border-border shadow-sm p-5 space-y-4"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FieldWrapper icon={<User className="h-4 w-4" />} label="First Name" error={newVisitorForm.formState.errors.first_name?.message}>
                <input {...newVisitorForm.register('first_name')} className={fieldCls} placeholder="Kwame" autoFocus />
              </FieldWrapper>
              <FieldWrapper icon={<User className="h-4 w-4" />} label="Last Name" error={newVisitorForm.formState.errors.last_name?.message}>
                <input {...newVisitorForm.register('last_name')} className={fieldCls} placeholder="Asante" />
              </FieldWrapper>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FieldWrapper icon={<Phone className="h-4 w-4" />} label="Phone" error={newVisitorForm.formState.errors.phone?.message}>
                <input {...newVisitorForm.register('phone')} className={fieldCls} placeholder="0241234567" />
              </FieldWrapper>
              <FieldWrapper icon={<Mail className="h-4 w-4" />} label="Email" error={newVisitorForm.formState.errors.email?.message}>
                <input {...newVisitorForm.register('email')} type="email" className={fieldCls} placeholder="visitor@email.com" />
              </FieldWrapper>
            </div>

            <FieldWrapper icon={<Briefcase className="h-4 w-4" />} label="Organisation">
              <input {...newVisitorForm.register('organisation')} className={fieldCls} placeholder="e.g. Ministry of Finance" />
            </FieldWrapper>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FieldWrapper icon={<CreditCard className="h-4 w-4" />} label="ID Type">
                <select {...newVisitorForm.register('id_type')} className={fieldCls}>
                  <option value="">Select...</option>
                  {ID_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </FieldWrapper>
              <FieldWrapper icon={<CreditCard className="h-4 w-4" />} label="ID Number">
                <input {...newVisitorForm.register('id_number')} className={fieldCls} placeholder="GHA-XXXXXXXXX-X" />
              </FieldWrapper>
            </div>

            {createVisitorMutation.isError && (
              <p className="text-danger text-xs">
                {createVisitorMutation.error instanceof Error ? createVisitorMutation.error.message : 'Failed to create visitor'}
              </p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setStep('search')} className="h-10 px-4 text-sm text-muted hover:text-foreground transition-colors">
                Cancel
              </button>
              <button
                type="submit"
                disabled={createVisitorMutation.isPending}
                className="h-10 px-5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-light transition-colors disabled:opacity-50"
              >
                {createVisitorMutation.isPending ? 'Creating...' : 'Register & Continue'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* STEP 3: Check-in form */}
      {step === 'check-in' && selectedVisitor && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Check In Visitor</h2>
            <p className="text-sm text-muted mt-0.5">Assign host and purpose for this visit</p>
          </div>

          {/* Selected visitor card */}
          <div className="bg-surface rounded-xl border border-border shadow-sm p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold shrink-0">
              {getInitials(selectedVisitor.first_name, selectedVisitor.last_name)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">
                {selectedVisitor.first_name} {selectedVisitor.last_name}
              </p>
              <p className="text-xs text-muted truncate">
                {[selectedVisitor.organisation, selectedVisitor.phone].filter(Boolean).join(' · ')}
              </p>
            </div>
            <button onClick={reset} className="h-7 w-7 rounded-md text-muted hover:text-foreground hover:bg-background transition-colors flex items-center justify-center">
              <X className="h-4 w-4" />
            </button>
          </div>

          <form
            onSubmit={checkInForm.handleSubmit((data) => checkInMutation.mutate(data))}
            className="bg-surface rounded-xl border border-border shadow-sm p-5 space-y-4"
          >
            <FieldWrapper icon={<Building2 className="h-4 w-4" />} label="Directorate">
              <select {...checkInForm.register('directorate_id')} className={fieldCls}>
                <option value="">Select directorate...</option>
                {directorates.map((d) => (
                  <option key={d.id} value={d.id}>{d.abbreviation} — {d.name}</option>
                ))}
              </select>
            </FieldWrapper>

            <FieldWrapper icon={<User className="h-4 w-4" />} label="Host Officer">
              <select {...checkInForm.register('host_officer_id')} className={fieldCls}>
                <option value="">Select host officer...</option>
                {filteredOfficers.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}{o.title ? ` — ${o.title}` : ''}{o.directorate_abbr ? ` (${o.directorate_abbr})` : ''}
                  </option>
                ))}
              </select>
            </FieldWrapper>

            <FieldWrapper label="Purpose of Visit">
              <textarea
                {...checkInForm.register('purpose_raw')}
                rows={3}
                className={cn(fieldCls, 'h-auto py-2.5 resize-none')}
                placeholder="e.g. Meeting with Director about procurement documents"
              />
            </FieldWrapper>

            {checkInMutation.isError && (
              <p className="text-danger text-xs">
                {checkInMutation.error instanceof Error ? checkInMutation.error.message : 'Failed to check in visitor'}
              </p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={reset} className="h-10 px-4 text-sm text-muted hover:text-foreground transition-colors">
                Cancel
              </button>
              <button
                type="submit"
                disabled={checkInMutation.isPending}
                className="h-10 px-5 bg-secondary text-white text-sm font-medium rounded-lg hover:brightness-110 transition-all disabled:opacity-50"
              >
                {checkInMutation.isPending ? 'Checking in...' : 'Check In'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* STEP 4: Success */}
      {step === 'success' && createdVisit && (
        <div className="bg-surface rounded-xl border border-border shadow-sm p-8 text-center space-y-4">
          <div className="w-14 h-14 bg-success/10 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-7 w-7 text-success" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Visitor Checked In</h2>
            <p className="text-sm text-muted mt-1">
              {createdVisit.first_name} {createdVisit.last_name} has been checked in successfully
            </p>
          </div>

          {createdVisit.badge_code && (
            <>
              <div className="inline-flex items-center gap-2 h-10 px-4 bg-accent/10 rounded-lg">
                <span className="text-xs text-muted">Badge:</span>
                <span className="text-sm font-mono font-bold text-accent">{createdVisit.badge_code}</span>
              </div>
              <div className="pt-2">
                <p className="text-xs text-muted mb-3">Have the visitor scan this code for their digital badge</p>
                <BadgeQRCode badgeCode={createdVisit.badge_code} />
              </div>
            </>
          )}

          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              onClick={reset}
              className="h-10 px-5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-light transition-colors"
            >
              Check In Another
            </button>
            <button
              onClick={() => navigate('/')}
              className="h-10 px-5 bg-surface text-foreground text-sm font-medium rounded-lg border border-border hover:bg-background transition-colors"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- Helpers ---- */

const fieldCls =
  'w-full h-10 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary';

function FieldWrapper({
  icon,
  label,
  error,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-xs font-medium text-foreground mb-1.5">
        {icon && <span className="text-muted">{icon}</span>}
        {label}
      </label>
      {children}
      {error && <p className="text-danger text-xs mt-1">{error}</p>}
    </div>
  );
}

function BadgeQRCode({ badgeCode }: { badgeCode: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      const badgeUrl = `${window.location.origin}/badge/${badgeCode}`;
      QRCode.toCanvas(canvasRef.current, badgeUrl, {
        width: 200,
        margin: 2,
        color: { dark: '#1B3A5C', light: '#FFFFFF' },
      });
    }
  }, [badgeCode]);

  return <canvas ref={canvasRef} className="mx-auto rounded-lg" />;
}

function StepIndicator({ current }: { current: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'search', label: 'Find Visitor' },
    { key: 'check-in', label: 'Check In' },
    { key: 'success', label: 'Done' },
  ];

  const currentIdx = current === 'new-visitor' ? 0 : steps.findIndex((s) => s.key === current);

  return (
    <div className="flex items-center gap-1 ml-auto">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1">
          <span
            className={cn(
              'inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold',
              i < currentIdx
                ? 'bg-success text-white'
                : i === currentIdx
                  ? 'bg-primary text-white'
                  : 'bg-border text-muted'
            )}
          >
            {i < currentIdx ? <Check className="h-3 w-3" /> : i + 1}
          </span>
          <span className={cn('text-xs', i === currentIdx ? 'text-foreground font-medium' : 'text-muted')}>
            {s.label}
          </span>
          {i < steps.length - 1 && <span className="text-border-strong mx-1">—</span>}
        </div>
      ))}
    </div>
  );
}
