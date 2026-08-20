import { z } from "zod";

const email = z.string().trim().email("Enter a valid email address").toLowerCase();

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must include an uppercase letter")
  .regex(/[a-z]/, "Password must include a lowercase letter")
  .regex(/[0-9]/, "Password must include a number");

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, "Enter your name").max(120),
    email,
    password: passwordSchema,
    confirmPassword: z.string(),
    terms: z.literal("on", {
      error: "You must accept the terms"
    }),
    next: z.string().optional()
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"]
  });

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password"),
  next: z.string().optional()
});

export const emailSchema = z.object({
  email
});

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string()
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"]
  });

export const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  timezone: z.string().trim().min(1).max(80).default("UTC"),
  locale: z.string().trim().min(2).max(20).default("en")
});

export const mfaCodeSchema = z.object({
  code: z.string().trim().regex(/^[0-9]{6}$/, "Enter the 6-digit authenticator code"),
  factorId: z.string().uuid().optional(),
  challengeId: z.string().uuid().optional()
});

export function formDataToObject(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

export function firstZodError(error: z.ZodError) {
  return error.issues[0]?.message ?? "Invalid form submission";
}
