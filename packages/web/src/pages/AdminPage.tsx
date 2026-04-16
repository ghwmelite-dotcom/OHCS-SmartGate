import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';
import { DirectoratesTab } from '@/components/admin/DirectoratesTab';
import {
  Users,
  UserPlus,
  Shield,
  Pencil,
  Power,
  X,
  Check,
  KeyRound,
} from 'lucide-react';

interface UserRecord {
  id: string;
  name: string;
  email: string;
  staff_id: string | null;
  role: string;
  is_active: number;
  last_login_at: string | null;
  created_at: string;
}

const ROLES = [
  { value: 'superadmin', label: 'Super Admin', color: 'bg-secondary/10 text-secondary' },
  { value: 'admin', label: 'Admin', color: 'bg-accent/15 text-accent-warm' },
  { value: 'receptionist', label: 'Receptionist', color: 'bg-primary/10 text-primary' },
  { value: 'director', label: 'Director', color: 'bg-info/10 text-info' },
  { value: 'officer', label: 'Officer', color: 'bg-success/10 text-success' },
] as const;

const createUserSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email('Invalid email').max(255),
  staff_id: z.string().min(1, 'Staff ID is required').max(20),
  pin: z.string().length(4, 'PIN must be 4 digits').regex(/^\d{4}$/, 'PIN must be 4 digits'),
  role: z.enum(['superadmin', 'admin', 'receptionist', 'director', 'officer']),
});
type CreateUserForm = z.infer<typeof createUserSchema>;

const editUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(255),
  staff_id: z.string().min(1).max(20),
  role: z.enum(['superadmin', 'admin', 'receptionist', 'director', 'officer']),
  pin: z.string().length(4).regex(/^\d{4}$/).or(z.literal('')).optional(),
});
type EditUserForm = z.infer<typeof editUserSchema>;

export function AdminPage() {
  const [activeTab, setActiveTab] = useState<'users' | 'org'>('users');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between animate-fade-in-up">
        <div>
          <h1 className="text-[28px] font-bold text-foreground tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
            Administration
          </h1>
          <p className="text-[15px] text-muted mt-0.5">Manage users, directorates, and officers</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface rounded-xl border border-border p-1 w-fit animate-fade-in-up stagger-1">
        {([
          { value: 'users' as const, label: 'Users' },
          { value: 'org' as const, label: 'Org Entities & Officers' },
        ]).map(tab => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={cn(
              'h-9 px-5 rounded-lg text-[14px] font-medium transition-all',
              activeTab === tab.value
                ? 'bg-primary text-white shadow-sm'
                : 'text-muted hover:text-foreground'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'users' ? <UsersTab /> : <DirectoratesTab />}
    </div>
  );
}


function UsersTab() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<UserRecord[]>('/users'),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (user: UserRecord) =>
      user.is_active
        ? api.delete(`/users/${user.id}`)
        : api.put(`/users/${user.id}`, { is_active: 1 }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  const users = data?.data ?? [];

  return (
    <div className="space-y-6">
      {/* Add User button */}
      <div className="flex justify-end">
        <button
          onClick={() => { setShowCreate(true); setEditingUser(null); }}
          className="inline-flex items-center gap-2 h-11 px-5 bg-primary text-white text-[14px] font-semibold rounded-xl hover:bg-primary-light transition-all shadow-lg shadow-primary/15 active:scale-[0.98]"
        >
          <UserPlus className="h-4.5 w-4.5" />
          Add User
        </button>
      </div>

      {/* Create / Edit modal */}
      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onSuccess={() => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['users'] });
          }}
        />
      )}

      {editingUser && (
        <EditUserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSuccess={() => {
            setEditingUser(null);
            queryClient.invalidateQueries({ queryKey: ['users'] });
          }}
        />
      )}

      {/* Users table */}
      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden animate-fade-in-up stagger-2">
        <div className="h-[2px]" style={{
          background: 'linear-gradient(90deg, #D4A017, #F5D76E 50%, #D4A017)',
        }} />

        <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <Users className="h-4.5 w-4.5 text-primary" />
          </div>
          <div>
            <h2 className="text-base font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
              System Users
            </h2>
            <p className="text-[13px] text-muted">{users.length} user{users.length !== 1 ? 's' : ''} registered</p>
          </div>
        </div>

        {isLoading ? (
          <div className="p-10 text-center">
            <div className="h-5 w-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-3" />
            <p className="text-[14px] text-muted">Loading users...</p>
          </div>
        ) : users.length === 0 ? (
          <div className="p-10 text-center">
            <Users className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-[15px] text-muted font-medium">No users yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-background/50">
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Name</th>
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Staff ID</th>
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Email</th>
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Role</th>
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Status</th>
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Last Login</th>
                  <th className="text-right px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((user) => {
                  const roleCfg = ROLES.find(r => r.value === user.role);
                  return (
                    <tr key={user.id} className="hover:bg-background-warm/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center text-[13px] font-bold shrink-0">
                            {user.name.charAt(0)}
                          </div>
                          <span className="text-[15px] font-semibold text-foreground">{user.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-[14px] font-mono font-medium text-foreground">{user.staff_id ?? '—'}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-[14px] text-muted">{user.email}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          'inline-flex items-center h-7 px-3 text-[11px] font-bold rounded-lg uppercase tracking-wide',
                          roleCfg?.color ?? 'bg-border text-muted'
                        )}>
                          {roleCfg?.label ?? user.role}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          'inline-flex items-center gap-1.5 text-[13px] font-medium',
                          user.is_active ? 'text-success' : 'text-muted-foreground'
                        )}>
                          <div className={cn(
                            'w-2 h-2 rounded-full',
                            user.is_active ? 'bg-success' : 'bg-muted-foreground'
                          )} />
                          {user.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-[13px] text-muted">
                          {user.last_login_at ? formatDate(user.last_login_at) : 'Never'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setEditingUser(user)}
                            className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-primary hover:bg-primary/5 transition-all"
                            title="Edit user"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => toggleActiveMutation.mutate(user)}
                            className={cn(
                              'h-8 w-8 rounded-lg flex items-center justify-center transition-all',
                              user.is_active
                                ? 'text-muted hover:text-secondary hover:bg-secondary/10'
                                : 'text-muted hover:text-success hover:bg-success/10'
                            )}
                            title={user.is_active ? 'Deactivate' : 'Reactivate'}
                          >
                            <Power className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---- Create User Modal ---- */

function CreateUserModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const form = useForm<CreateUserForm>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: '', email: '', staff_id: '', pin: '', role: 'receptionist' },
  });

  const mutation = useMutation({
    mutationFn: (data: CreateUserForm) => api.post('/users', data),
    onSuccess,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-2xl border border-border w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)' }} />
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <UserPlus className="h-4 w-4 text-primary" />
            </div>
            <h3 className="text-lg font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>Add New User</h3>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-background transition-all">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={form.handleSubmit(data => mutation.mutate(data))} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Full Name" error={form.formState.errors.name?.message}>
              <input {...form.register('name')} className={inputCls} placeholder="Kwame Mensah" autoFocus />
            </FormField>
            <FormField label="Email" error={form.formState.errors.email?.message}>
              <input {...form.register('email')} type="email" className={inputCls} placeholder="k.mensah@ohcs.gov.gh" />
            </FormField>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <FormField label="Staff ID" error={form.formState.errors.staff_id?.message}>
              <input {...form.register('staff_id')} className={cn(inputCls, 'uppercase')} placeholder="OHCS-002" />
            </FormField>
            <FormField label="4-Digit PIN" error={form.formState.errors.pin?.message}>
              <input {...form.register('pin')} type="password" maxLength={4} className={cn(inputCls, 'text-center tracking-[0.3em] font-mono')} placeholder="****" inputMode="numeric" />
            </FormField>
            <FormField label="Role" error={form.formState.errors.role?.message}>
              <select {...form.register('role')} className={inputCls}>
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </FormField>
          </div>

          {mutation.isError && (
            <p className="text-danger text-[13px] font-medium">
              {mutation.error instanceof Error ? mutation.error.message : 'Failed to create user'}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="h-11 px-5 text-[14px] text-muted hover:text-foreground transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="h-11 px-6 bg-primary text-white text-[14px] font-semibold rounded-xl hover:bg-primary-light transition-all disabled:opacity-50 shadow-lg shadow-primary/15"
            >
              {mutation.isPending ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---- Edit User Modal ---- */

function EditUserModal({ user, onClose, onSuccess }: { user: UserRecord; onClose: () => void; onSuccess: () => void }) {
  const form = useForm<EditUserForm>({
    resolver: zodResolver(editUserSchema),
    defaultValues: {
      name: user.name,
      email: user.email,
      staff_id: user.staff_id ?? '',
      role: user.role as EditUserForm['role'],
      pin: '',
    },
  });

  const mutation = useMutation({
    mutationFn: (data: EditUserForm) => {
      const payload: Record<string, unknown> = { ...data };
      if (!data.pin) delete payload.pin;
      return api.put(`/users/${user.id}`, payload);
    },
    onSuccess,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-2xl border border-border w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)' }} />
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
              <Pencil className="h-4 w-4 text-accent-warm" />
            </div>
            <h3 className="text-lg font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>Edit User</h3>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-background transition-all">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={form.handleSubmit(data => mutation.mutate(data))} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Full Name" error={form.formState.errors.name?.message}>
              <input {...form.register('name')} className={inputCls} autoFocus />
            </FormField>
            <FormField label="Email" error={form.formState.errors.email?.message}>
              <input {...form.register('email')} type="email" className={inputCls} />
            </FormField>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <FormField label="Staff ID" error={form.formState.errors.staff_id?.message}>
              <input {...form.register('staff_id')} className={cn(inputCls, 'uppercase')} />
            </FormField>
            <FormField label="New PIN (optional)" error={form.formState.errors.pin?.message}>
              <input {...form.register('pin')} type="password" maxLength={4} className={cn(inputCls, 'text-center tracking-[0.3em] font-mono')} placeholder="****" inputMode="numeric" />
            </FormField>
            <FormField label="Role" error={form.formState.errors.role?.message}>
              <select {...form.register('role')} className={inputCls}>
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </FormField>
          </div>

          {mutation.isError && (
            <p className="text-danger text-[13px] font-medium">
              {mutation.error instanceof Error ? mutation.error.message : 'Failed to update user'}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="h-11 px-5 text-[14px] text-muted hover:text-foreground transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="h-11 px-6 bg-primary text-white text-[14px] font-semibold rounded-xl hover:bg-primary-light transition-all disabled:opacity-50 shadow-lg shadow-primary/15"
            >
              {mutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---- Helpers ---- */

const inputCls = 'w-full h-11 px-3.5 rounded-xl border border-border bg-background text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all';

function FormField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-foreground/70 uppercase tracking-wide mb-1.5">{label}</label>
      {children}
      {error && <p className="text-danger text-[12px] mt-1">{error}</p>}
    </div>
  );
}
