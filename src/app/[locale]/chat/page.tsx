import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getActiveCompany } from '@/lib/auth/active-company';
import { getMessages, listChats, markRead } from '@/lib/chat/chat';
import { blockState, listTemplates } from '@/lib/chat/extras';
import { ChatScreen } from './chat-screen';

export default async function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ chat?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const active = await getActiveCompany();
  if (!active) redirect({ href: '/login', locale });

  const companyId = active!.companyId;
  const [chats, query] = await Promise.all([listChats(companyId), searchParams]);
  const openId = query.chat ?? chats[0]?.id ?? null;

  const opened = openId ? await getMessages(openId, companyId) : null;
  // Открытие переписки помечает сообщения собеседника прочитанными (раздел 3.7 ТЗ).
  if (opened) await markRead(openId!, companyId);

  return (
    <ChatScreen
      chats={chats.map((chat) => ({
        ...chat,
        unread: chat.id === openId ? 0 : chat.unread,
      }))}
      initialChatId={openId}
      initialMessages={opened?.messages ?? []}
      initialBlock={opened ? await blockState(openId!, companyId) : null}
      templates={await listTemplates(companyId)}
    />
  );
}
