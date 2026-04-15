export const VISIT_STATUS = {
  checked_in: { label: 'Checked In', color: 'bg-success text-white' },
  checked_out: { label: 'Checked Out', color: 'bg-muted-foreground text-white' },
  cancelled: { label: 'Cancelled', color: 'bg-danger text-white' },
} as const;

export const ID_TYPES = [
  { value: 'ghana_card', label: 'Ghana Card' },
  { value: 'passport', label: 'Passport' },
  { value: 'drivers_license', label: "Driver's License" },
  { value: 'staff_id', label: 'Staff ID' },
  { value: 'other', label: 'Other' },
] as const;

export const API_BASE = import.meta.env.PROD
  ? 'https://ohcs-smartgate-api.ghwmelite.workers.dev/api'
  : '/api';
