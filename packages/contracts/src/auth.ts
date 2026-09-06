import { z } from 'zod';
import { UtcInstantSchema, UuidSchema } from './common.ts';

export const AuthRoleSchema = z.enum(['owner', 'adult']);

export const AuthIdentifierSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .transform((identifier) => identifier.toLocaleLowerCase('fr-FR'))
  .refine(
    (identifier) => /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(identifier),
    'Utilisez des lettres, chiffres, points, tirets ou tirets bas, sans espace.',
  );

export const AuthCredentialsSchema = z
  .object({
    deviceId: UuidSchema,
    deviceName: z.string().trim().min(1).max(80),
    identifier: AuthIdentifierSchema,
    password: z.string().min(12).max(128),
  })
  .strict();

export const AuthBootstrapRequestSchema = AuthCredentialsSchema.extend({
  name: z.string().trim().min(1).max(80),
}).strict();

export const AuthLoginRequestSchema = AuthCredentialsSchema;

export const AuthPairRequestSchema = AuthBootstrapRequestSchema.extend({
  code: z.string().regex(/^\d{8}$/u),
}).strict();

export const AuthMemberSchema = z
  .object({
    identifier: AuthIdentifierSchema,
    name: z.string().min(1).max(80),
    profileId: UuidSchema,
    role: AuthRoleSchema,
  })
  .strict();

export const AuthSessionSchema = z
  .object({
    deviceId: UuidSchema,
    deviceName: z.string().min(1).max(80),
    member: AuthMemberSchema,
  })
  .strict();

export const AuthStateResponseSchema = z
  .object({
    bootstrapRequired: z.boolean(),
    session: AuthSessionSchema.nullable(),
  })
  .strict();

export const PairingCodeResponseSchema = z
  .object({
    code: z.string().regex(/^\d{8}$/u),
    expiresAt: UtcInstantSchema,
  })
  .strict();

export const AuthDeviceSchema = z
  .object({
    createdAt: UtcInstantSchema,
    current: z.boolean(),
    id: UuidSchema,
    lastSeenAt: UtcInstantSchema,
    memberName: z.string().min(1).max(80),
    name: z.string().min(1).max(80),
    revokedAt: UtcInstantSchema.nullable(),
  })
  .strict();

export const AuthDevicesResponseSchema = z
  .object({ devices: z.array(AuthDeviceSchema).max(50) })
  .strict();

export const AuthMembersResponseSchema = z
  .object({ members: z.array(AuthMemberSchema).max(2) })
  .strict();

export const AuthDeviceApprovalStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'expired',
]);

export const AuthDeviceApprovalRequiredSchema = z
  .object({
    approvalRequired: z.literal(true),
    expiresAt: UtcInstantSchema,
    requestId: UuidSchema,
    statusToken: z.string().min(32).max(128),
  })
  .strict();

export const AuthLoginResponseSchema = z.union([
  AuthSessionSchema,
  AuthDeviceApprovalRequiredSchema,
]);

export const AuthDeviceApprovalRequestSchema = z
  .object({
    createdAt: UtcInstantSchema,
    deviceId: UuidSchema,
    deviceName: z.string().min(1).max(80),
    expiresAt: UtcInstantSchema,
    id: UuidSchema,
    requestIp: z.string().min(1).max(80).nullable(),
    status: AuthDeviceApprovalStatusSchema,
  })
  .strict();

export const AuthDeviceApprovalRequestsResponseSchema = z
  .object({ requests: z.array(AuthDeviceApprovalRequestSchema).max(10) })
  .strict();

export const AuthDeviceApprovalStatusResponseSchema = z
  .object({ status: AuthDeviceApprovalStatusSchema })
  .strict();

export type AuthBootstrapRequest = z.infer<typeof AuthBootstrapRequestSchema>;

export type AuthLoginRequest = z.infer<typeof AuthLoginRequestSchema>;

export type AuthPairRequest = z.infer<typeof AuthPairRequestSchema>;

export type AuthMember = z.infer<typeof AuthMemberSchema>;

export type AuthSession = z.infer<typeof AuthSessionSchema>;

export type AuthStateResponse = z.infer<typeof AuthStateResponseSchema>;

export type AuthDevice = z.infer<typeof AuthDeviceSchema>;

export type AuthDeviceApprovalRequest = z.infer<
  typeof AuthDeviceApprovalRequestSchema
>;

export type AuthDeviceApprovalRequired = z.infer<
  typeof AuthDeviceApprovalRequiredSchema
>;

export type AuthDeviceApprovalStatus = z.infer<
  typeof AuthDeviceApprovalStatusSchema
>;

export type AuthLoginResponse = z.infer<typeof AuthLoginResponseSchema>;
