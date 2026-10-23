'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Ban,
  FileText,
  Flag,
  Mic,
  Package,
  Paperclip,
  Search,
  Send,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState, Page, PageHeader } from '@/components/ui/page';
import { cn } from '@/lib/utils';
import { money } from '@/lib/format';

type ChatSummary = {
  id: string;
  counterpartyName: string;
  orderNumber: string | null;
  lastMessage: string | null;
  unread: number;
};

type Message = {
  id: string;
  text: string;
  mine: boolean;
  read: boolean;
  createdAt: string;
  file: { id: string; image: boolean; voice: boolean; durationMs: number | null } | null;
  offer: { id: string; nameRu: string; nameKk: string; barcode: string; price: string } | null;
  document: { id: string; type: DocumentKind; number: string } | null;
};

type DocumentKind = 'WAYBILL' | 'INVOICE' | 'DISCREPANCY_ACT' | 'RETURN_WAYBILL' | 'SETTLEMENT_ACT';
type Shareables = {
  offers: { id: string; nameRu: string; nameKk: string; price: string }[];
  documents: { id: string; type: DocumentKind; number: string }[];
};

type Block = { blockedByMe: boolean; blockedMe: boolean } | null;
type Template = { id: string; text: string };
type Hit = {
  chatId: string;
  messageId: string;
  counterpartyName: string;
  text: string;
  createdAt: string;
};

const ERRORS = [
  'empty_message',
  'too_long',
  'not_found',
  'forbidden',
  'blocked',
  'unsupported_type',
  'too_large',
  'too_many',
  'reason_required',
  'already_sent',
  'empty',
  'mic_unavailable',
];

/** Голосовое — не длиннее двух минут (раздел 3.7 ТЗ): запись останавливается сама. */
const VOICE_MAX_MS = 120_000;
/** Пока потока событий нет, переписка обновляется прежним запросом. */
const FALLBACK_POLL_MS = 5_000;

/** Длительность записи «м:сс». */
function clock(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Формат, который умеет записывать браузер: webm в Chrome и Firefox, mp4 в Safari. */
function recorderMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

/**
 * Чат «магазин — поставщик» и чат заявки (раздел 3.7 ТЗ): статусы прочтения, поиск,
 * шаблоны быстрых ответов, фото и файлы, жалоба на сообщение и блокировка собеседника.
 */
export function ChatScreen({
  chats,
  initialChatId,
  initialMessages,
  initialBlock,
  templates: initialTemplates,
}: {
  chats: ChatSummary[];
  initialChatId: string | null;
  initialMessages: Message[];
  initialBlock: Block;
  templates: Template[];
}) {
  const t = useTranslations('chat');
  const tDoc = useTranslations('documents.types');
  const locale = useLocale();
  const [share, setShare] = useState<Shareables | null>(null);
  const [shareQuery, setShareQuery] = useState('');
  const [list, setList] = useState(chats);
  const [activeId, setActiveId] = useState(initialChatId);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [block, setBlock] = useState<Block>(initialBlock);
  const [templates, setTemplates] = useState(initialTemplates);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [complaint, setComplaint] = useState<{ messageId: string; reason: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [live, setLive] = useState(false);
  const [recordingMs, setRecordingMs] = useState<number | null>(null);
  const recorder = useRef<{ media: MediaRecorder; startedAt: number; timer: number } | null>(null);
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const fail = (code: string | undefined) =>
    setError(code && ERRORS.includes(code) ? code : 'unknown');

  const loadChat = useCallback(async (chatId: string) => {
    const response = await fetch(`/api/chats/${chatId}/messages`);
    if (!response.ok) return;
    const data = (await response.json()) as { messages: Message[]; block: Block };
    setMessages(data.messages);
    setBlock(data.block);

    // Статус «прочитано» проставляется при открытии переписки (раздел 3.7 ТЗ).
    await fetch(`/api/chats/${chatId}/read`, { method: 'POST' });
    setList((current) =>
      current.map((chat) => (chat.id === chatId ? { ...chat, unread: 0 } : chat)),
    );
  }, []);

  /** Счётчики непрочитанного в списке переписок. */
  const refreshList = useCallback(async () => {
    const response = await fetch('/api/chats');
    if (!response.ok) return;
    const data = (await response.json()) as { chats: ChatSummary[] };
    setList(
      data.chats.map((chat) => (chat.id === activeRef.current ? { ...chat, unread: 0 } : chat)),
    );
  }, []);

  // Реальное время (разделы 3.7 и 5.3 ТЗ): сервер присылает, какие переписки изменились.
  // Если поток оборвался, браузер переподключается сам, а пока его нет — опрос запросом.
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/chats/stream');
    source.addEventListener('ready', () => setLive(true));
    source.addEventListener('chats', (event) => {
      setLive(true);
      const { chatIds } = JSON.parse((event as MessageEvent<string>).data) as {
        chatIds: string[];
      };
      if (activeRef.current && chatIds.includes(activeRef.current)) {
        void loadChat(activeRef.current);
      }
      void refreshList();
    });
    source.onerror = () => setLive(false);
    return () => source.close();
  }, [loadChat, refreshList]);

  useEffect(() => {
    if (live) return;
    const timer = window.setInterval(() => {
      if (activeRef.current) void loadChat(activeRef.current);
      void refreshList();
    }, FALLBACK_POLL_MS);
    return () => window.clearInterval(timer);
  }, [live, loadChat, refreshList]);

  async function startRecording() {
    if (!activeId || recorder.current) return;
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('mic_unavailable');
      return;
    }
    const mimeType = recorderMimeType();
    const media = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    const chatId = activeId;
    media.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    media.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const durationMs = Math.min(Date.now() - startedAt, VOICE_MAX_MS);
      void sendVoice(chatId, new Blob(chunks, { type: media.mimeType }), durationMs);
    };
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setRecordingMs(elapsed);
      if (elapsed >= VOICE_MAX_MS) stopRecording();
    }, 250);
    recorder.current = { media, startedAt, timer };
    setRecordingMs(0);
    media.start();
  }

  function stopRecording() {
    const current = recorder.current;
    if (!current) return;
    recorder.current = null;
    window.clearInterval(current.timer);
    setRecordingMs(null);
    if (current.media.state !== 'inactive') current.media.stop();
  }

  async function sendVoice(chatId: string, blob: Blob, durationMs: number) {
    setPending(true);
    const form = new FormData();
    form.set('file', blob, 'voice');
    form.set('durationMs', String(durationMs));
    const response = await fetch(`/api/chats/${chatId}/voice`, { method: 'POST', body: form });
    const data = (await response.json().catch(() => ({}))) as { status?: string };
    setPending(false);
    if (data.status !== 'ok') {
      fail(data.status);
      return;
    }
    await loadChat(chatId);
  }

  function openChat(chatId: string) {
    setActiveId(chatId);
    setComplaint(null);
    setNotice(null);
    setError(null);
    void loadChat(chatId);
  }

  function search(value: string) {
    setQuery(value);
    clearTimeout(searchTimer.current);
    if (value.trim().length < 2) {
      setHits(null);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      const response = await fetch(`/api/chats/search?q=${encodeURIComponent(value)}`);
      if (response.ok) setHits(((await response.json()) as { hits: Hit[] }).hits);
    }, 250);
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
      fail(data.status);
      return;
    }
    setText('');
    await loadChat(activeId);
  }

  async function loadShareables(value: string) {
    if (!activeId) return;
    setShareQuery(value);
    const response = await fetch(
      `/api/chats/${activeId}/cards?q=${encodeURIComponent(value.trim())}`,
    );
    if (response.ok) setShare((await response.json()) as Shareables);
  }

  /** Карточка товара или документ в чат (раздел 3.7 ТЗ). */
  async function sendCard(card: { offerId: string } | { documentId: string }) {
    if (!activeId) return;
    setPending(true);
    setError(null);
    const response = await fetch(`/api/chats/${activeId}/cards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(card),
    });
    const data = (await response.json().catch(() => ({}))) as { status?: string };
    setPending(false);
    if (data.status !== 'ok') {
      fail(data.status);
      return;
    }
    setShare(null);
    await loadChat(activeId);
  }

  async function sendFile(file: File) {
    if (!activeId) return;
    setPending(true);
    setError(null);
    const form = new FormData();
    form.set('file', file);
    const response = await fetch(`/api/chats/${activeId}/files`, { method: 'POST', body: form });
    const data = (await response.json().catch(() => ({}))) as { status?: string };
    setPending(false);
    if (fileInput.current) fileInput.current.value = '';
    if (data.status !== 'ok') {
      fail(data.status);
      return;
    }
    await loadChat(activeId);
  }

  async function saveTemplate() {
    const response = await fetch('/api/chats/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = (await response.json()) as { status?: string; id?: string };
    if (data.status !== 'ok') {
      fail(data.status);
      return;
    }
    setTemplates((current) => [...current, { id: data.id!, text: text.trim() }]);
    setNotice('templateSaved');
  }

  async function removeTemplate(id: string) {
    await fetch(`/api/chats/templates/${id}`, { method: 'DELETE' });
    setTemplates((current) => current.filter((item) => item.id !== id));
  }

  async function toggleBlock() {
    if (!activeId || !block) return;
    const response = await fetch(`/api/chats/${activeId}/block`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blocked: !block.blockedByMe }),
    });
    if (response.ok) setBlock({ ...block, blockedByMe: !block.blockedByMe });
  }

  async function sendComplaint() {
    if (!complaint) return;
    const response = await fetch(`/api/chats/messages/${complaint.messageId}/complaint`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: complaint.reason }),
    });
    const data = (await response.json()) as { status?: string };
    if (data.status !== 'ok') {
      fail(data.status);
      return;
    }
    setComplaint(null);
    setNotice('complaintSent');
  }

  const active = list.find((chat) => chat.id === activeId) ?? null;
  const closed = Boolean(block?.blockedByMe || block?.blockedMe);

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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
          <Card className="p-0">
            <div className="border-border border-b p-3">
              <div className="relative">
                <Search
                  aria-hidden
                  className="text-muted-foreground absolute top-3 left-3 size-4"
                />
                <Input
                  className="h-10 pl-9"
                  value={query}
                  placeholder={t('search')}
                  data-testid="chat-search"
                  onChange={(event) => search(event.target.value)}
                />
              </div>
            </div>
            {hits ? (
              <ul className="divide-border divide-y" data-testid="chat-search-results">
                {hits.length === 0 ? (
                  <li className="text-muted-foreground px-4 py-3 text-sm">{t('nothingFound')}</li>
                ) : (
                  hits.map((hit) => (
                    <li key={hit.messageId}>
                      <button
                        type="button"
                        className="hover:bg-muted/60 w-full px-4 py-3 text-left"
                        onClick={() => openChat(hit.chatId)}
                      >
                        <span className="block truncate text-sm font-medium">
                          {hit.counterpartyName}
                        </span>
                        <span className="text-muted-foreground mt-0.5 line-clamp-2 block text-xs">
                          {hit.text}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : (
              <ul className="divide-border divide-y" data-testid="chat-list">
                {list.map((chat) => (
                  <li key={chat.id}>
                    <button
                      type="button"
                      data-testid={`chat-item-${chat.id}`}
                      onClick={() => openChat(chat.id)}
                      className={cn(
                        'hover:bg-muted/60 w-full px-4 py-3 text-left transition-colors',
                        chat.id === activeId && 'bg-primary-soft/60',
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
                        {chat.orderNumber
                          ? t('byOrder', { number: chat.orderNumber })
                          : t('general')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="flex min-h-96 flex-col">
            {active ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium break-words">{active.counterpartyName}</p>
                    <p className="text-muted-foreground text-xs font-semibold">
                      {active.orderNumber
                        ? t('byOrder', { number: active.orderNumber })
                        : t('general')}
                    </p>
                    <p
                      className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-[0.7rem]"
                      data-testid="chat-live"
                      data-live={live ? 'true' : 'false'}
                    >
                      <span
                        className={cn(
                          'size-1.5 rounded-full',
                          live ? 'bg-success' : 'bg-muted-foreground',
                        )}
                      />
                      {live ? t('live') : t('polling')}
                    </p>
                  </div>
                  {block ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid="chat-block"
                      onClick={() => void toggleBlock()}
                    >
                      <Ban aria-hidden />
                      {block.blockedByMe ? t('unblock') : t('block')}
                    </Button>
                  ) : null}
                </div>

                <div className="mt-4 flex-1 space-y-2 overflow-y-auto" data-testid="chat-messages">
                  {messages.length === 0 ? (
                    <p className="text-muted-foreground text-sm font-medium">{t('noMessages')}</p>
                  ) : (
                    messages.map((message) => (
                      <div
                        key={message.id}
                        className={cn(
                          'group flex max-w-[85%] flex-col',
                          message.mine ? 'ml-auto items-end' : 'items-start',
                        )}
                      >
                        <div
                          className={cn(
                            'rounded-2xl px-3 py-2 text-sm break-words',
                            message.mine
                              ? 'bg-primary text-primary-foreground rounded-br-md'
                              : 'bg-muted rounded-bl-md',
                          )}
                          data-testid={message.mine ? 'chat-message-mine' : 'chat-message-theirs'}
                        >
                          {message.file?.image ? (
                            <a
                              href={`/api/files/${message.file.id}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={`/api/files/${message.file.id}`}
                                alt={message.text}
                                className="mb-1 max-h-48 rounded-2xl"
                                data-testid="chat-image"
                              />
                            </a>
                          ) : null}
                          {message.file?.voice ? (
                            <span className="flex flex-col gap-1" data-testid="chat-voice">
                              <span className="flex items-center gap-1.5 text-xs opacity-80">
                                <Mic aria-hidden className="size-3.5" />
                                {t('voice')}
                                {message.file.durationMs
                                  ? ` · ${clock(message.file.durationMs)}`
                                  : ''}
                              </span>
                              <audio
                                controls
                                preload="none"
                                src={`/api/files/${message.file.id}`}
                                className="h-10 max-w-60"
                              />
                            </span>
                          ) : message.file && !message.file.image ? (
                            <a
                              href={`/api/files/${message.file.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1.5 underline"
                              data-testid="chat-file"
                            >
                              <Paperclip aria-hidden className="size-3.5" />
                              {message.text}
                            </a>
                          ) : message.file ? null : message.offer ? (
                            <span className="block" data-testid="chat-offer-card">
                              <span className="flex items-center gap-1.5 font-medium">
                                <Package aria-hidden className="size-3.5 shrink-0" />
                                {locale === 'kk' ? message.offer.nameKk : message.offer.nameRu}
                              </span>
                              <span className="mt-0.5 block text-xs opacity-80">
                                {message.offer.barcode} · {money(message.offer.price)} ₸
                              </span>
                            </span>
                          ) : message.document ? (
                            <a
                              href={`/api/documents/${message.document.id}/pdf?locale=${locale}`}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1.5 underline"
                              data-testid="chat-document-card"
                            >
                              <FileText aria-hidden className="size-3.5 shrink-0" />
                              {tDoc(message.document.type)} № {message.document.number}
                            </a>
                          ) : (
                            message.text
                          )}
                          {message.mine ? (
                            <span className="mt-0.5 block text-[0.65rem] opacity-70">
                              {message.read ? t('read') : t('delivered')}
                            </span>
                          ) : null}
                        </div>
                        {!message.mine ? (
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-danger mt-0.5 flex items-center gap-1 text-[0.7rem] opacity-70 group-hover:opacity-100"
                            data-testid="chat-complain"
                            onClick={() => setComplaint({ messageId: message.id, reason: '' })}
                          >
                            <Flag aria-hidden className="size-3" />
                            {t('complain')}
                          </button>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>

                {complaint ? (
                  <div className="border-border mt-3 flex flex-wrap items-center gap-2 rounded-2xl border-[1.5px] border-dashed p-2">
                    <Input
                      className="h-9 min-w-0 flex-1"
                      placeholder={t('complaintReason')}
                      value={complaint.reason}
                      data-testid="chat-complaint-reason"
                      onChange={(event) =>
                        setComplaint({ ...complaint, reason: event.target.value })
                      }
                    />
                    <Button
                      size="sm"
                      data-testid="chat-complaint-send"
                      onClick={() => void sendComplaint()}
                    >
                      {t('complaintSend')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setComplaint(null)}>
                      {t('cancel')}
                    </Button>
                  </div>
                ) : null}

                {closed ? (
                  <p
                    className="bg-danger-soft text-danger mt-3 rounded-2xl px-3 py-2 text-sm"
                    data-testid="chat-blocked"
                  >
                    {block?.blockedByMe ? t('blockedByMe') : t('blockedMe')}
                  </p>
                ) : (
                  <>
                    {templates.length > 0 ? (
                      <ul className="mt-3 flex flex-wrap gap-1.5" data-testid="chat-templates">
                        {templates.map((template) => (
                          <li
                            key={template.id}
                            className="bg-primary-soft text-primary flex items-center rounded-full text-xs"
                          >
                            <button
                              type="button"
                              className="max-w-56 truncate py-1 pl-3"
                              data-testid="chat-template"
                              onClick={() => setText(template.text)}
                            >
                              {template.text}
                            </button>
                            <button
                              type="button"
                              className="px-2 py-1 opacity-60 hover:opacity-100"
                              aria-label={t('removeTemplate')}
                              onClick={() => void removeTemplate(template.id)}
                            >
                              <X aria-hidden className="size-3" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {share ? (
                      <div
                        className="border-border mt-3 rounded-2xl border p-3"
                        data-testid="chat-share-panel"
                      >
                        <Input
                          className="h-9"
                          value={shareQuery}
                          placeholder={t('shareSearch')}
                          data-testid="chat-share-search"
                          onChange={(event) => void loadShareables(event.target.value)}
                        />
                        <p className="text-muted-foreground mt-2 text-xs">{t('shareOffers')}</p>
                        <ul className="mt-1 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                          {share.offers.map((offer) => (
                            <li key={offer.id}>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                data-testid="chat-share-offer"
                                onClick={() => void sendCard({ offerId: offer.id })}
                              >
                                {locale === 'kk' ? offer.nameKk : offer.nameRu}
                              </Button>
                            </li>
                          ))}
                        </ul>
                        {share.documents.length > 0 ? (
                          <>
                            <p className="text-muted-foreground mt-2 text-xs">
                              {t('shareDocuments')}
                            </p>
                            <ul className="mt-1 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                              {share.documents.map((document) => (
                                <li key={document.id}>
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    data-testid="chat-share-document"
                                    onClick={() => void sendCard({ documentId: document.id })}
                                  >
                                    {tDoc(document.type)} № {document.number}
                                  </Button>
                                </li>
                              ))}
                            </ul>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                    <form className="mt-3 flex gap-2" onSubmit={send}>
                      <input
                        ref={fileInput}
                        type="file"
                        className="hidden"
                        accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx"
                        data-testid="chat-file-input"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void sendFile(file);
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        aria-label={t('attach')}
                        disabled={pending}
                        onClick={() => fileInput.current?.click()}
                      >
                        <Paperclip aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        aria-label={t('shareCard')}
                        title={t('shareCard')}
                        disabled={pending}
                        data-testid="chat-share"
                        onClick={() => (share ? setShare(null) : void loadShareables(''))}
                      >
                        <Package aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant={recordingMs === null ? 'outline' : 'danger'}
                        size="icon"
                        className="shrink-0"
                        aria-label={recordingMs === null ? t('record') : t('stopRecording')}
                        title={recordingMs === null ? t('record') : t('stopRecording')}
                        disabled={pending}
                        data-testid="chat-record"
                        onClick={() =>
                          recordingMs === null ? void startRecording() : stopRecording()
                        }
                      >
                        {recordingMs === null ? <Mic aria-hidden /> : <Square aria-hidden />}
                      </Button>
                      <Input
                        value={text}
                        placeholder={t('messagePlaceholder')}
                        data-testid="chat-input"
                        onChange={(event) => setText(event.target.value)}
                      />
                      {text.trim() ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0"
                          aria-label={t('saveTemplate')}
                          title={t('saveTemplate')}
                          data-testid="chat-save-template"
                          onClick={() => void saveTemplate()}
                        >
                          <Sparkles aria-hidden />
                        </Button>
                      ) : null}
                      <Button type="submit" disabled={pending} data-testid="chat-send">
                        <Send aria-hidden />
                        <span className="hidden sm:inline">
                          {pending ? t('sending') : t('send')}
                        </span>
                      </Button>
                    </form>
                  </>
                )}

                {recordingMs !== null ? (
                  <p
                    className="text-danger mt-2 text-sm"
                    role="status"
                    data-testid="chat-recording"
                  >
                    {t('recording', { time: clock(recordingMs), max: clock(VOICE_MAX_MS) })}
                  </p>
                ) : null}
                {notice ? (
                  <p className="text-success mt-2 text-sm" data-testid="chat-notice">
                    {t(`notices.${notice}` as 'notices.templateSaved')}
                  </p>
                ) : null}
                {error ? (
                  <p className="text-danger mt-2 text-sm" role="alert" data-testid="chat-error">
                    {t(`errors.${error}` as 'errors.unknown')}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-muted-foreground text-sm font-medium">{t('selectChat')}</p>
            )}
          </Card>
        </div>
      )}
    </Page>
  );
}
