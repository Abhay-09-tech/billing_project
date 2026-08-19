import { z } from 'zod'

/** Indian mobile: 10 digits, cannot start 0–5. Shared by form + service. */
export const mobileSchema = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number')

export const customerSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter the customer name'),
  mobile: mobileSchema,
  whatsappNumber: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit number')
    .optional()
    .or(z.literal('')),
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
  dob: z.string().optional().or(z.literal('')),
  gender: z.enum(['male', 'female', 'other']).optional().or(z.literal('')),
  city: z.string().trim().optional().or(z.literal('')),
  addressLine: z.string().trim().optional().or(z.literal('')),
  notes: z.string().trim().optional().or(z.literal('')),
  whatsappOptIn: z.boolean().optional(),
})

export type CustomerFormValues = z.infer<typeof customerSchema>
