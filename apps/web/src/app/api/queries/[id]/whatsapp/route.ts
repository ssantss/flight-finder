import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { authorizeMutation } from '@/lib/query-auth';

async function authorize(id: string, token: string | null | undefined) {
  const query = await prisma.query.findUnique({
    where: { id },
    select: { deleteToken: true, groupId: true, userId: true, active: true, isSeed: true, expiresAt: true },
  });
  if (!query) return { error: apiError('Tracker not found', 404) };
  const auth = await authorizeMutation(query, token ?? undefined);
  if (!auth.ok) return { error: apiError(auth.error ?? 'Forbidden', auth.status ?? 403) };
  return { error: null };
}

/** Digits only; a bare 10-digit Colombian mobile (starts with 3) gets the 57
 * country code so the Baileys service can route it. Returns null when the
 * result is not a plausible E.164 number. */
function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('3')) digits = `57${digits}`;
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = request.headers.get('x-delete-token');
  const gate = await authorize(id, token);
  if (gate.error) return gate.error;

  const alerts = await prisma.whatsAppAlert.findMany({
    where: { queryId: id },
    select: { id: true, phone: true, label: true, enabled: true },
    orderBy: { createdAt: 'asc' },
  });
  return apiSuccess({ alerts });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const gate = await authorize(id, body?.deleteToken);
  if (gate.error) return gate.error;

  const phone = normalizePhone(body?.phone);
  if (!phone) return apiError('Número inválido. Usa el formato con indicativo, ej. 573001234567.', 400);

  const label = typeof body?.label === 'string' && body.label.trim() !== '' ? body.label.trim().slice(0, 60) : null;

  const existing = await prisma.whatsAppAlert.findFirst({ where: { queryId: id, phone } });
  if (existing) return apiError('Ese número ya está agregado a este tracker.', 409);

  const alert = await prisma.whatsAppAlert.create({
    data: { queryId: id, phone, label },
    select: { id: true, phone: true, label: true, enabled: true },
  });
  return apiSuccess({ alert });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const gate = await authorize(id, body?.deleteToken);
  if (gate.error) return gate.error;

  const alertId = typeof body?.alertId === 'string' ? body.alertId : null;
  if (!alertId) return apiError('alertId requerido', 400);

  await prisma.whatsAppAlert.deleteMany({ where: { id: alertId, queryId: id } });
  return apiSuccess({ deleted: true });
}
