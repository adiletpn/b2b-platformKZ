import type { TicketStatus } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { formatDateTime } from '@/lib/format';
import { notify } from '@/mocks/notifications';
import { writeAdminAudit } from '@/lib/admin/session';

/** Обращения в поддержку (раздел 3.13 ТЗ): компания пишет из приложения, платформа отвечает. */
export const SUBJECT_MAX = 200;
export const TEXT_MAX = 4000;

export type TicketRow = {
  id: string;
  subject: string;
  status: TicketStatus;
  companyName: string;
  assignee: string | null;
  updatedAt: string;
};

export type TicketView = TicketRow & {
  messages: { id: string; fromAdmin: boolean; text: string; createdAt: string }[];
};

function check(text: string, max: number) {
  const value = text.trim();
  return value.length >= 2 && value.length <= max ? value : null;
}

export async function createTicket(
  companyId: string,
  userId: string,
  input: { subject: string; text: string },
) {
  const subject = check(input.subject, SUBJECT_MAX);
  const text = check(input.text, TEXT_MAX);
  if (!subject || !text) return { status: 'invalid' as const };
  const ticket = await prisma.supportTicket.create({
    data: { companyId, userId, subject, messages: { create: { text } } },
  });
  return { status: 'ok' as const, id: ticket.id };
}

function toRow(ticket: {
  id: string;
  subject: string;
  status: TicketStatus;
  company: { name: string };
  assignee: { name: string } | null;
  updatedAt: Date;
}): TicketRow {
  return {
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    companyName: ticket.company.name,
    assignee: ticket.assignee?.name ?? null,
    updatedAt: formatDateTime(ticket.updatedAt),
  };
}

const INCLUDE = {
  company: { select: { name: true } },
  assignee: { select: { name: true } },
} as const;

/** Обращения своей компании (правило 4). */
export async function listCompanyTickets(companyId: string): Promise<TicketRow[]> {
  const rows = await prisma.supportTicket.findMany({
    where: { companyId },
    include: INCLUDE,
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });
  return rows.map(toRow);
}

/** Переписка по обращению: компании — только своё, администратору — любое. */
export async function getTicket(id: string, companyId: string | null): Promise<TicketView | null> {
  const ticket = await prisma.supportTicket.findFirst({
    where: { id, ...(companyId ? { companyId } : {}) },
    include: { ...INCLUDE, messages: { orderBy: { createdAt: 'asc' } } },
  });
  if (!ticket) return null;
  return {
    ...toRow(ticket),
    messages: ticket.messages.map((message) => ({
      id: message.id,
      fromAdmin: message.fromAdmin,
      text: message.text,
      createdAt: formatDateTime(message.createdAt),
    })),
  };
}

export async function replyAsCompany(id: string, companyId: string, rawText: string) {
  const text = check(rawText, TEXT_MAX);
  if (!text) return { status: 'invalid' as const };
  const ticket = await prisma.supportTicket.findFirst({ where: { id, companyId } });
  if (!ticket) return { status: 'not_found' as const };
  await prisma.supportTicket.update({
    where: { id },
    // Ответ компании снова открывает закрытое обращение.
    data: {
      status: ticket.status === 'CLOSED' ? 'OPEN' : ticket.status,
      messages: { create: { text } },
    },
  });
  return { status: 'ok' as const };
}

/** Очередь обращений для поддержки, по умолчанию — незакрытые. */
export async function listTickets(status?: TicketStatus): Promise<TicketRow[]> {
  const rows = await prisma.supportTicket.findMany({
    where: status ? { status } : { status: { not: 'CLOSED' } },
    include: INCLUDE,
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  return rows.map(toRow);
}

/** Ответ, назначение на себя и смена статуса — с записью в журнал аудита. */
export async function adminTicketAction(
  adminId: string,
  id: string,
  action: { reply?: string; assignToMe?: boolean; status?: TicketStatus },
) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id } });
  if (!ticket) return { status: 'not_found' as const };
  const text = action.reply !== undefined ? check(action.reply, TEXT_MAX) : null;
  if (action.reply !== undefined && !text) return { status: 'invalid' as const };

  await prisma.supportTicket.update({
    where: { id },
    data: {
      ...(action.assignToMe ? { assigneeId: adminId } : {}),
      ...(action.status ? { status: action.status } : text ? { status: 'IN_PROGRESS' } : {}),
      ...(text ? { messages: { create: { text, fromAdmin: true } } } : {}),
    },
  });
  await writeAdminAudit(adminId, text ? 'ticket_replied' : 'ticket_updated', {
    entity: 'SupportTicket',
    entityId: id,
  });
  if (text) await notify(ticket.companyId, 'support_reply', { subject: ticket.subject });
  return { status: 'ok' as const };
}
