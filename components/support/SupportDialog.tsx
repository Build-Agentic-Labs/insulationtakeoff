"use client";

import { type ChangeEvent, type ClipboardEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Camera, ImagePlus, LifeBuoy, Loader2, Paperclip, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
const SUPPORT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

interface SupportDialogProps {
  collapsed?: boolean;
}

interface SupportAttachment {
  id: string;
  file: File;
  previewUrl: string;
}

function getProjectId(pathname: string) {
  const match = pathname.match(/^\/projects\/([^/]+)/);
  return match?.[1] ?? null;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateImageFile(file: File) {
  if (!SUPPORT_IMAGE_TYPES.includes(file.type)) {
    return 'Screenshots must be PNG, JPG, or WEBP images.';
  }

  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return 'Each screenshot must be 10MB or smaller.';
  }

  return null;
}

async function waitForVideoFrame(video: HTMLVideoElement) {
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
}

export function SupportDialog({ collapsed = false }: SupportDialogProps) {
  const pathname = usePathname();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<SupportAttachment[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [successTicketId, setSuccessTicketId] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      attachments.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
    };
  }, [attachments]);

  const addFiles = (files: File[]) => {
    setError(null);

    if (attachments.length + files.length > MAX_ATTACHMENTS) {
      setError(`Attach up to ${MAX_ATTACHMENTS} screenshots.`);
      return;
    }

    const nextAttachments: SupportAttachment[] = [];

    for (const file of files) {
      const validationError = validateImageFile(file);
      if (validationError) {
        setError(validationError);
        nextAttachments.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
        return;
      }

      nextAttachments.push({
        id: `${Date.now()}-${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }

    setAttachments((current) => [...current, ...nextAttachments]);
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => {
      const attachment = current.find((item) => item.id === id);
      if (attachment) URL.revokeObjectURL(attachment.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  };

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) addFiles(files);
    event.target.value = '';
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) return;

    event.preventDefault();
    addFiles(files);
  };

  const captureScreen = async () => {
    setError(null);

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('Screen capture is not available in this browser.');
      return;
    }

    setIsCapturing(true);
    let stream: MediaStream | null = null;

    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      await waitForVideoFrame(video);

      const width = video.videoWidth || window.innerWidth;
      const height = video.videoHeight || window.innerHeight;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Unable to capture screen image.');
      }

      context.drawImage(video, 0, 0, width, height);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => {
          if (result) resolve(result);
          else reject(new Error('Unable to save captured screenshot.'));
        }, 'image/png');
      });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      addFiles([
        new File([blob], `screen-capture-${timestamp}.png`, {
          type: 'image/png',
        }),
      ]);
    } catch (captureError) {
      const message = captureError instanceof DOMException && captureError.name === 'NotAllowedError'
        ? 'Screen capture was cancelled or blocked.'
        : captureError instanceof Error
          ? captureError.message
          : 'Screen capture failed.';
      setError(message);
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      setIsCapturing(false);
    }
  };

  const resetForm = () => {
    setSubject('');
    setMessage('');
    setAttachments((current) => {
      current.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
      return [];
    });
  };

  const submitTicket = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setSuccessTicketId(null);

    if (subject.trim().length < 3) {
      setError('Add a short subject before sending.');
      return;
    }

    if (message.trim().length < 5) {
      setError('Add the question or issue before sending.');
      return;
    }

    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.set('subject', subject.trim());
      formData.set('message', message.trim());
      formData.set('pageUrl', window.location.href);

      const projectId = getProjectId(pathname);
      if (projectId) formData.set('projectId', projectId);

      formData.set(
        'browserInfo',
        JSON.stringify({
          userAgent: navigator.userAgent,
          language: navigator.language,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          devicePixelRatio: window.devicePixelRatio,
        })
      );

      attachments.forEach((attachment) => {
        formData.append('attachments', attachment.file);
      });

      const response = await fetch('/api/support/tickets', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error ?? 'Failed to send support request.');
      }

      resetForm();
      setSuccessTicketId(data.ticket?.id ?? null);
      setSuccessMessage(
        data.notificationStatus === 'failed'
          ? 'Support request saved. Email notification is not configured yet.'
          : 'Support request sent.'
      );
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to send support request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (nextOpen) {
        setError(null);
        setSuccessMessage(null);
        setSuccessTicketId(null);
      }
    }}>
      <DialogTrigger asChild>
        <button
          className={cn(
            "mb-2 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[#b6c5b5] transition-all duration-200 hover:bg-[rgba(245,248,241,0.07)] hover:text-white",
            collapsed && "justify-center px-2"
          )}
        >
          <LifeBuoy className="h-5 w-5" />
          {!collapsed && <span>Support</span>}
        </button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto rounded-[18px] border-[var(--takeoff-line)] bg-[var(--takeoff-paper-strong)] p-0 text-[var(--takeoff-ink)] sm:max-w-2xl"
        onPaste={handlePaste}
      >
        <form onSubmit={submitTicket}>
          <DialogHeader className="border-b border-[var(--takeoff-line)] px-6 py-5">
            <DialogTitle className="text-xl font-semibold tracking-[-0.03em]">Contact support</DialogTitle>
            <DialogDescription className="text-[13px] text-[var(--takeoff-text-muted)]">
              Send a question with the current page and screenshots attached.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 px-6 py-5">
            {successMessage ? (
              <div className="rounded-[12px] border border-[rgba(110,139,94,0.24)] bg-[rgba(110,139,94,0.12)] px-4 py-3 text-sm text-[#48613d]">
                <div>{successMessage}</div>
                {successTicketId ? (
                  <Link
                    href={`/support/tickets?ticket=${encodeURIComponent(successTicketId)}`}
                    className="mt-2 inline-flex font-semibold text-[#34472d] underline-offset-4 hover:underline"
                    onClick={() => setOpen(false)}
                  >
                    View ticket
                  </Link>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <div className="rounded-[12px] border border-[rgba(215,25,33,0.24)] bg-[rgba(215,25,33,0.08)] px-4 py-3 text-sm text-[var(--takeoff-accent)]">
                {error}
              </div>
            ) : null}

            <div className="space-y-2">
              <label className="ev-label" htmlFor="support-subject">
                Subject
              </label>
              <Input
                id="support-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="What should we look at?"
                maxLength={140}
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <label className="ev-label" htmlFor="support-message">
                Question
              </label>
              <textarea
                id="support-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Describe the issue, what you expected, and anything you already tried."
                maxLength={5000}
                disabled={isSubmitting}
                className="min-h-32 w-full resize-y rounded-[14px] border border-[var(--takeoff-line)] bg-[rgba(255,255,255,0.82)] px-3 py-3 text-sm leading-6 text-[var(--takeoff-ink)] shadow-sm placeholder:text-[var(--takeoff-text-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--takeoff-ink)]/10 disabled:opacity-50"
              />
            </div>

            <div className="rounded-[14px] border border-dashed border-[var(--takeoff-line-strong)] bg-[var(--takeoff-paper)] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="ev-label">Screenshots</div>
                  <div className="mt-1 text-sm text-[var(--takeoff-text-muted)]">
                    Capture the screen, upload images, or paste from clipboard.
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={captureScreen}
                    disabled={isCapturing || isSubmitting || attachments.length >= MAX_ATTACHMENTS}
                  >
                    {isCapturing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                    Capture
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isSubmitting || attachments.length >= MAX_ATTACHMENTS}
                  >
                    <ImagePlus className="h-4 w-4" />
                    Upload
                  </Button>
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />

              {attachments.length > 0 ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {attachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="grid grid-cols-[72px_1fr_auto] items-center gap-3 rounded-[12px] border border-[var(--takeoff-line)] bg-white p-2"
                    >
                      <img
                        src={attachment.previewUrl}
                        alt=""
                        className="h-14 w-[72px] rounded-[8px] border border-[var(--takeoff-line)] object-cover"
                      />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[var(--takeoff-ink)]">
                          {attachment.file.name}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-[var(--takeoff-text-muted)]">
                          <Paperclip className="h-3 w-3" />
                          {formatFileSize(attachment.file.size)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeAttachment(attachment.id)}
                        className="rounded-full p-2 text-[var(--takeoff-text-muted)] hover:bg-[var(--takeoff-paper)] hover:text-[var(--takeoff-ink)]"
                        disabled={isSubmitting}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <DialogFooter className="border-t border-[var(--takeoff-line)] px-6 py-4">
            <Button type="submit" disabled={isSubmitting || isCapturing}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
