'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState, Page, PageHeader } from '@/components/ui/page';
import { cn } from '@/lib/utils';

type ChatSummary = {
  id: string;
  counterpartyName: string;
  orderNumber: string | null;
  lastMessage: string | null;
  unread: number;
};

type Message = { id: string; text: string; mine: boolean; read: boolean; createdAt: string };

export function ChatScreen({
  chats,
  initialChatId,
  initialMessages,
}: {
  chats: ChatSummary[];
  initialChatId: string | null;
  initialMessages: Message[];
}) {
  const t = useTranslations('chat');
  const [list, setList] = useState(chats);
  const [activeId, setActiveId] = useState(initialChatId);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const loadChat = useCallback(async (chatId: string) => {
    const response = await fetch(`/api/chats/${chatId}/messages`);
    if (!response.ok) return;
    const data = (await response.json()) as { messages: Message[] };
    setMessages(data.messages);

    // Статус «прочитано» проставляется при открытии переписки (раздел 3.7 ТЗ).
    await fetch(`/api/chats/${chatId}/read`, { method: 'POST' });
    setList((current) =>
      current.map((chat) => (chat.id === chatId ? { ...chat, unread: 0 } : chat)),
    );
  }, []);

  function openChat(chatId: string) {
    setActiveId(chatId);
    void loadChat(chatId);
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!activeId) return;

    setPending(true);
    setError(null);
    const response = await fetch(`/api/chats/${activeId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = (await response.json()) as { status?: string };
    setPending(false);

    if (data.status !== 'ok') {
      setError(data.status ?? 'unknown');
      return;
    }
    setText('');
    await loadChat(activeId);
  }

  const active = list.find((chat) => chat.id === activeId) ?? null;

  return (
    <Page width="lg">
      <PageHeader title={t('title')} description={t('subtitle')} />

      {list.length === 0 ? (
        <EmptyState>
          <span data-testid="chat-empty">{t('empty')}</span>
          <br />
          <span className="text-xs">{t('emptyHint')}</span>
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
          <Card className="p-0">
            <ul className="divide-border divide-y" data-testid="chat-list">
              {list.map((chat) => (
                <li key={chat.id}>
                  <button
                    type="button"
                    data-testid={`chat-item-${chat.id}`}
                    onClick={() => openChat(chat.id)}
                    className={cn(
                      'hover:bg-muted/60 w-full px-4 py-3 text-left transition-colors',
                      chat.id === activeId && 'bg-muted',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-medium">
                        {chat.counterpartyName}
                      </span>
                      {chat.unread > 0 ? (
                        <Badge tone="info" data-testid={`chat-unread-${chat.id}`}>
                          {chat.unread}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                      {chat.orderNumber ? t('byOrder', { number: chat.orderNumber }) : t('general')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="flex min-h-80 flex-col">
            {active ? (
              <>
                <p className="text-sm font-medium break-words">{active.counterpartyName}</p>
                <p className="text-muted-foreground text-xs">
                  {active.orderNumber ? t('byOrder', { number: active.orderNumber }) : t('general')}
                </p>

                <div className="mt-4 flex-1 space-y-2 overflow-y-auto" data-testid="chat-messages">
                  {messages.length === 0 ? (
                    <p className="text-muted-foreground text-sm">{t('noMessages')}</p>
                  ) : (
                    messages.map((message) => (
                      <div
                        key={message.id}
                        className={cn(
                          'max-w-[80%] rounded-xl px-3 py-2 text-sm break-words',
                          message.mine ? 'bg-primary text-primary-foreground ml-auto' : 'bg-muted',
                        )}
                        data-testid={message.mine ? 'chat-message-mine' : 'chat-message-theirs'}
                      >
                        {message.text}
                        {message.mine ? (
                          <span className="mt-0.5 block text-[0.65rem] opacity-70">
                            {message.read ? t('read') : t('delivered')}
                          </span>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>

                <form className="mt-3 flex gap-2" onSubmit={send}>
                  <Input
                    value={text}
                    placeholder={t('messagePlaceholder')}
                    data-testid="chat-input"
                    onChange={(event) => setText(event.target.value)}
                  />
                  <Button type="submit" disabled={pending} data-testid="chat-send">
                    {pending ? t('sending') : t('send')}
                  </Button>
                </form>

                {error ? (
                  <p className="mt-2 text-sm text-red-600" role="alert" data-testid="chat-error">
                    {t(`errors.${error}` as 'errors.unknown')}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-muted-foreground text-sm">{t('selectChat')}</p>
            )}
          </Card>
        </div>
      )}
    </Page>
  );
}
