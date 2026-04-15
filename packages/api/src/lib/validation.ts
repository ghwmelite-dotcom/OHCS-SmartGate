import { z } from 'zod';

export const ghanaPhoneSchema = z.string()
  .regex(/^(\+233|0)\d{9}$/, 'Invalid Ghana phone number (e.g. 0241234567 or +233241234567)')
  .optional()
  .or(z.literal(''));

export const idTypeSchema = z.enum(['ghana_card', 'passport', 'drivers_license', 'staff_id', 'other']);

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const CreateVisitorSchema = z.object({
  first_name: z.string().min(1).max(100).trim(),
  last_name: z.string().min(1).max(100).trim(),
  phone: ghanaPhoneSchema,
  email: z.string().email().max(255).optional().or(z.literal('')),
  organisation: z.string().max(200).optional().or(z.literal('')),
  id_type: idTypeSchema.optional(),
  id_number: z.string().max(50).optional().or(z.literal('')),
});

export const UpdateVisitorSchema = CreateVisitorSchema.partial();

export const CheckInSchema = z.object({
  visitor_id: z.string().min(1),
  host_officer_id: z.string().optional(),
  directorate_id: z.string().optional(),
  purpose_raw: z.string().max(500).optional(),
  purpose_category: z.string().optional(),
  notes: z.string().max(500).optional(),
});

export const LoginSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
});

export const VerifyOtpSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
  code: z.string().length(6),
});
