import { loadEnvFile } from 'node:process';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

try {
  loadEnvFile('.env');
} catch {
  // В CI переменные приходят из окружения.
}

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL не задан');

// Тесты всегда работают с отдельной базой, чтобы не затирать демо-данные.
process.env.DATABASE_URL = testDatabaseUrl;

export function createTestPrisma() {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) });
}

/** Чистит операционные данные; справочники (города, НДС, единицы, категории) остаются. */
export async function resetTransactionalData(prisma: PrismaClient) {
  await prisma.salesRepVisit.deleteMany();
  await prisma.salesRepStore.deleteMany();
  await prisma.supportMessage.deleteMany();
  await prisma.supportTicket.deleteMany();
  await prisma.chatComplaint.deleteMany();
  await prisma.chatBlock.deleteMany();
  await prisma.chatTemplate.deleteMany();
  await prisma.message.deleteMany();
  await prisma.chat.deleteMany();
  await prisma.rating.deleteMany();
  await prisma.loyaltyMovement.deleteMany();
  await prisma.receiptItem.deleteMany();
  await prisma.cashOperation.deleteMany();
  await prisma.receipt.deleteMany();
  await prisma.posShift.deleteMany();
  await prisma.loyaltyCustomer.deleteMany();
  await prisma.retailPrice.deleteMany();
  await prisma.markupRule.deleteMany();
  await prisma.stockBatch.deleteMany();
  await prisma.stockDocumentLine.deleteMany();
  await prisma.stockDocument.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.stockBalance.deleteMany();
  await prisma.attachmentBlob.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.documentVersion.deleteMany();
  await prisma.documentSignature.deleteMany();
  await prisma.document.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.orderStatusLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.order.deleteMany();
  await prisma.numberSequence.deleteMany();
  await prisma.idempotencyKey.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  await prisma.swipeAction.deleteMany();
  await prisma.supplierOffer.deleteMany();
  await prisma.product.deleteMany();
  await prisma.companyAccessRequest.deleteMany();
  await prisma.deliveryZone.deleteMany();
  await prisma.location.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.session.deleteMany();
  await prisma.companyLicense.deleteMany();
  await prisma.company.deleteMany();
  await prisma.otpCode.deleteMany();
  await prisma.user.deleteMany();

  await resetPlatformFlags(prisma);
}

/** Флаги платформы глобальные: тесты обязаны возвращать их в исходное состояние. */
export async function resetPlatformFlags(prisma: PrismaClient) {
  // Шаблоны печатных форм глобальные: чужой шаблон не должен влиять на другие тесты.
  await prisma.documentTemplate.deleteMany();
  await prisma.broadcast.deleteMany();
  await prisma.banner.deleteMany();
  await prisma.adminAuditLog.deleteMany();
  await prisma.impersonationLog.deleteMany();
  await prisma.adminSession.deleteMany();
  await prisma.platformSetting.upsert({
    where: { key: 'auto_verify_companies' },
    update: { value: 'true' },
    create: { key: 'auto_verify_companies', value: 'true' },
  });
  // По умолчанию тестовые компании видны: на них построены демо-сценарий и e2e.
  await prisma.platformSetting.upsert({
    where: { key: 'hide_demo_companies' },
    update: { value: 'false' },
    create: { key: 'hide_demo_companies', value: 'false' },
  });
}
