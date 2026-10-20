'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { Camera, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Встроенный в браузер распознаватель (Chrome на Android, Edge, Samsung Internet). */
type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorClass = new (options: { formats: string[] }) => Detector;

const noop = () => () => {};

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'code_128', 'data_matrix', 'qr_code'];

function detectorClass(): DetectorClass | null {
  if (typeof window === 'undefined') return null;
  const value = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  return value && 'mediaDevices' in navigator ? value : null;
}

/**
 * Сканер камерой телефона (раздел 4.1 ТЗ) без новых зависимостей: браузерный BarcodeDetector.
 * Где браузер его не умеет (Safari на iPhone), кнопки нет — остаются USB/Bluetooth-сканеры
 * и ручной ввод. Для iPhone нужна библиотека распознавания — TODO(open-question).
 */
export function CameraScanButton({ onCode }: { onCode: (code: string) => void }) {
  const t = useTranslations('camera');
  // На сервере кнопки нет, в браузере — если он умеет распознавать коды.
  const supported = useSyncExternalStore(
    noop,
    () => detectorClass() !== null,
    () => false,
  );
  const [open, setOpen] = useState(false);
  const [denied, setDenied] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  // Обработчик держим в ref: новая функция при каждом рендере не должна перезапускать камеру.
  const handler = useRef(onCode);
  useEffect(() => {
    handler.current = onCode;
  }, [onCode]);

  useEffect(() => {
    if (!open) return;
    const Detector = detectorClass();
    if (!Detector) return;
    const detector = new Detector({ formats: FORMATS });
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let stopped = false;

    const stop = () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };

    const tick = async () => {
      if (stopped || !video.current) return;
      try {
        const found = await detector.detect(video.current);
        const code = found[0]?.rawValue;
        if (code) {
          stop();
          setOpen(false);
          handler.current(code);
          return;
        }
      } catch {
        // Кадр ещё не готов — пробуем следующий.
      }
      timer = window.setTimeout(() => void tick(), 250);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (media) => {
        if (stopped) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        if (video.current) {
          video.current.srcObject = media;
          await video.current.play();
        }
        void tick();
      })
      .catch(() => setDenied(true));

    return stop;
  }, [open]);

  if (!supported) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        aria-label={t('open')}
        title={t('open')}
        data-testid="camera-scan"
        onClick={() => {
          setDenied(false);
          setOpen(true);
        }}
      >
        <Camera aria-hidden />
      </Button>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('open')}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 p-4"
        >
          <video
            ref={video}
            className="aspect-square w-full max-w-sm rounded-xl object-cover"
            muted
            playsInline
          />
          <p className="text-center text-sm text-white">{denied ? t('denied') : t('hint')}</p>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            <X aria-hidden />
            {t('close')}
          </Button>
        </div>
      ) : null}
    </>
  );
}
